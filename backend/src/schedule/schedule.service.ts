import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatusAgendamento, TipoUsuario } from '../generated/prisma/enums';
import { UsersService } from '../users/users.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { AvailabilityResponseDto } from './dto/availability-response.dto';
import { BusinessHourResponseDto } from './dto/business-hour-response.dto';
import { CreateScheduleBlockDto } from './dto/create-schedule-block.dto';
import { ReplaceBusinessHoursDto } from './dto/replace-business-hours.dto';
import { ScheduleBlockResponseDto } from './dto/schedule-block-response.dto';
import {
  dateKeyFromUtcMidnight,
  formatLocalHHmm,
  isValidDateKey,
  localMinuteOfDay,
  prismaDateFilter,
  weekdayFromDateKey,
  zonedWallTimeToUtc,
} from './tz.util';

/**
 * Grade FIXA de horários iniciais da disponibilidade (decisão de projeto):
 * os candidatos são múltiplos de 15 minutos; um slot só é retornado se o
 * serviço INTEIRO couber na janela e não interceptar bloqueios/agendamentos.
 */
export const SLOT_GRANULARITY_MINUTES = 15;

interface MinuteInterval {
  ini: number;
  fim: number;
}

interface BlockRow {
  id: number;
  data: Date;
  horaInicio: Date;
  horaFim: Date;
  motivo: string | null;
  ativo: boolean;
}

@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  // ---------------------------------------------------------------------
  // Identidade: Usuario.id -> Barbeiro.id (padrão do módulo Services).
  // Operações administrativas NUNCA confiam em barbeiroId vindo do cliente.
  // ---------------------------------------------------------------------
  private async resolveBarberId(userId: number): Promise<number> {
    const barber = await this.prisma.barbeiro.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (!barber) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    return barber.id;
  }

  private parseHHmm(hhmm: string): number {
    const [hour, minute] = hhmm.split(':').map(Number);
    return hour * 60 + minute;
  }

  // ---------------------------------------------------------------------
  // Horários de funcionamento (API.md §14)
  // ---------------------------------------------------------------------
  async findOwnBusinessHours(
    userId: number,
  ): Promise<BusinessHourResponseDto[]> {
    const barberId = await this.resolveBarberId(userId);

    const rows = await this.prisma.horarioFuncionamento.findMany({
      where: { barbeiroId: barberId },
      orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      diaSemana: row.diaSemana,
      horaInicio: row.horaInicio,
      horaFim: row.horaFim,
      ativo: row.ativo,
    }));
  }

  /**
   * Substitui INTEGRALMENTE a semana do barbeiro autenticado.
   * Múltiplas janelas por dia são permitidas (sem sobreposição no mesmo dia).
   * Dias omitidos não permanecem da configuração anterior. A operação é
   * atômica: reset + rebuild dentro de uma transação (idempotente, sem risco
   * de linhas antigas órfãs/duplicadas).
   */
  async replaceOwnBusinessHours(
    userId: number,
    dto: ReplaceBusinessHoursDto,
  ): Promise<BusinessHourResponseDto[]> {
    const barberId = await this.resolveBarberId(userId);

    this.validateWindowsPayload(dto.horarios);

    await this.prisma.$transaction(async (tx) => {
      await tx.horarioFuncionamento.deleteMany({
        where: { barbeiroId: barberId },
      });
      await tx.horarioFuncionamento.createMany({
        data: dto.horarios.map((window) => ({
          barbeiroId: barberId,
          diaSemana: window.diaSemana,
          horaInicio: window.horaInicio,
          horaFim: window.horaFim,
          ativo: window.ativo ?? true,
        })),
      });
    });

    return this.findOwnBusinessHours(userId);
  }

  /**
   * Regras por janela: intervalo válido e intra-dia; por dia: janelas podem
   * se encostar (fim == início da próxima) mas NÃO se sobrepor.
   */
  private validateWindowsPayload(
    windows: ReplaceBusinessHoursDto['horarios'],
  ): void {
    const byDay = new Map<number, MinuteInterval[]>();

    for (const window of windows) {
      const ini = this.parseHHmm(window.horaInicio);
      const fim = this.parseHHmm(window.horaFim);

      if (ini >= fim) {
        throw new BadRequestException(
          'A janela deve ter horaInicio menor que horaFim.',
        );
      }

      const dayWindows = byDay.get(window.diaSemana) ?? [];
      dayWindows.push({ ini, fim });
      byDay.set(window.diaSemana, dayWindows);
    }

    for (const dayWindows of byDay.values()) {
      dayWindows.sort((a, b) => a.ini - b.ini);
      for (let i = 1; i < dayWindows.length; i += 1) {
        if (dayWindows[i].ini < dayWindows[i - 1].fim) {
          throw new BadRequestException(
            'Janelas do mesmo dia não podem se sobrepor.',
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Bloqueios de agenda (API.md §15)
  // ---------------------------------------------------------------------
  private toBlockResponse(row: BlockRow): ScheduleBlockResponseDto {
    return {
      id: row.id,
      data: dateKeyFromUtcMidnight(row.data),
      horaInicio: formatLocalHHmm(row.horaInicio),
      horaFim: formatLocalHHmm(row.horaFim),
      motivo: row.motivo,
      ativo: row.ativo,
    };
  }

  async createOwnBlock(
    userId: number,
    dto: CreateScheduleBlockDto,
  ): Promise<ScheduleBlockResponseDto> {
    const barberId = await this.resolveBarberId(userId);

    if (!isValidDateKey(dto.data)) {
      throw new BadRequestException('Data inválida.');
    }

    const startMinutes = this.parseHHmm(dto.horaInicio);
    const endMinutes = this.parseHHmm(dto.horaFim);
    if (startMinutes >= endMinutes) {
      throw new BadRequestException(
        'O bloqueio deve ter horaInicio menor que horaFim.',
      );
    }

    // Bloqueio é intra-dia: os instantes pertencem ao calendário local da
    // própria `data` informada.
    const inicioUtc = zonedWallTimeToUtc(dto.data, dto.horaInicio);
    const fimUtc = zonedWallTimeToUtc(dto.data, dto.horaFim);

    const dayFilter = prismaDateFilter(dto.data);

    const existingBlocks = await this.prisma.bloqueioAgenda.findMany({
      where: { barbeiroId: barberId, data: dayFilter, ativo: true },
    });
    for (const block of existingBlocks) {
      const busyIni = localMinuteOfDay(block.horaInicio);
      const busyFim = localMinuteOfDay(block.horaFim);
      if (startMinutes < busyFim && busyIni < endMinutes) {
        throw new ConflictException('Já existe um bloqueio para esse período.');
      }
    }

    // API.md §15.1: verificar conflitos com agendamentos existentes.
    const appointments = await this.prisma.agendamento.findMany({
      where: {
        barbeiroId: barberId,
        data: dayFilter,
        status: { in: [StatusAgendamento.CONFIRMADO] },
      },
    });
    for (const appointment of appointments) {
      const busyIni = localMinuteOfDay(appointment.horaInicio);
      const busyFim = localMinuteOfDay(appointment.horaFim);
      if (startMinutes < busyFim && busyIni < endMinutes) {
        throw new ConflictException(
          'Existe um agendamento confirmado nesse período.',
        );
      }
    }

    const created = await this.prisma.bloqueioAgenda.create({
      data: {
        barbeiroId: barberId,
        data: dayFilter,
        horaInicio: inicioUtc,
        horaFim: fimUtc,
        motivo: dto.motivo ?? null,
      },
    });

    return this.toBlockResponse(created);
  }

  async findOwnBlocks(
    userId: number,
    dataInicio?: string,
    dataFim?: string,
  ): Promise<ScheduleBlockResponseDto[]> {
    const barberId = await this.resolveBarberId(userId);

    const period: { gte?: Date; lte?: Date } = {};
    const hasPeriod = Boolean(dataInicio) || Boolean(dataFim);

    if (hasPeriod) {
      if (dataInicio !== undefined && dataInicio !== '') {
        if (!isValidDateKey(dataInicio)) {
          throw new BadRequestException('Período de consulta inválido.');
        }
        period.gte = prismaDateFilter(dataInicio);
      }
      if (dataFim !== undefined && dataFim !== '') {
        if (!isValidDateKey(dataFim)) {
          throw new BadRequestException('Período de consulta inválido.');
        }
        period.lte = prismaDateFilter(dataFim);
      }
    }

    const rows = await this.prisma.bloqueioAgenda.findMany({
      where: {
        barbeiroId: barberId,
        ...(period.gte || period.lte ? { data: period } : {}),
      },
      orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
    });

    return rows.map((row) => this.toBlockResponse(row));
  }

  /** DELETE com ownership: recurso de outro barbeiro → 404 genérico. */
  async deleteOwnBlock(userId: number, blockId: number): Promise<void> {
    const barberId = await this.resolveBarberId(userId);

    const block = await this.prisma.bloqueioAgenda.findFirst({
      where: { id: blockId, barbeiroId: barberId },
    });

    if (!block) {
      throw new NotFoundException('Bloqueio não encontrado.');
    }

    await this.prisma.bloqueioAgenda.delete({ where: { id: block.id } });
  }

  // ---------------------------------------------------------------------
  // Disponibilidade (API.md §8)
  // ---------------------------------------------------------------------
  async getAvailability(
    userId: number,
    query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    const authState =
      await this.usersService.findAuthorizationStateById(userId);
    if (!authState || !authState.ativo) {
      throw new UnauthorizedException();
    }

    let targetBarberId: number;
    if (query.barbeiroId !== undefined) {
      // Consulta EXPLÍCITA (fluxo do CLIENTE). Somente leitura — não é
      // operação administrativa, portanto não há risco de ownership.
      targetBarberId = query.barbeiroId;
    } else if (authState.tipoUsuario === TipoUsuario.BARBEIRO) {
      // BARBEIRO consulta a própria agenda sem informar barbeiroId.
      if (!authState.barbeiro || !authState.barbeiro.ativo) {
        throw new ForbiddenException();
      }
      targetBarberId = await this.resolveBarberId(userId);
    } else {
      // CLIENTE sem barbeiroId: nunca escolher barbeiro arbitrariamente.
      throw new BadRequestException('Informe o barbeiroId.');
    }

    if (!isValidDateKey(query.data)) {
      throw new BadRequestException('Data inválida.');
    }

    const service = await this.prisma.servico.findFirst({
      where: { id: query.servicoId, barbeiroId: targetBarberId },
      select: { id: true, ativo: true, duracaoMinutos: true },
    });
    if (!service || !service.ativo) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    const duration = service.duracaoMinutos;

    const dayWindows: MinuteInterval[] = (
      await this.prisma.horarioFuncionamento.findMany({
        where: {
          barbeiroId: targetBarberId,
          diaSemana: weekdayFromDateKey(query.data),
          ativo: true,
        },
      })
    )
      .map((window) => ({
        ini: this.parseHHmm(window.horaInicio),
        fim: this.parseHHmm(window.horaFim),
      }))
      .filter((window) => window.ini < window.fim)
      .sort((a, b) => a.ini - b.ini);

    const buildEmpty = (): AvailabilityResponseDto => ({
      data: query.data,
      barbeiroId: targetBarberId,
      duracaoMinutos: duration,
      horariosLivres: [],
    });

    if (dayWindows.length === 0) {
      return buildEmpty();
    }

    // Ocupações do dia convertidas para minutos locais (America/Sao_Paulo).
    const busy: MinuteInterval[] = [
      ...(
        await this.prisma.bloqueioAgenda.findMany({
          where: {
            barbeiroId: targetBarberId,
            data: prismaDateFilter(query.data),
            ativo: true,
          },
        })
      ).map((block) => ({
        ini: localMinuteOfDay(block.horaInicio),
        fim: localMinuteOfDay(block.horaFim),
      })),
      ...(
        await this.prisma.agendamento.findMany({
          where: {
            barbeiroId: targetBarberId,
            data: prismaDateFilter(query.data),
            status: { in: [StatusAgendamento.CONFIRMADO] },
          },
        })
      ).map((appointment) => ({
        ini: localMinuteOfDay(appointment.horaInicio),
        fim: localMinuteOfDay(appointment.horaFim),
      })),
    ];

    const freeSlots = new Set<number>();
    for (const window of dayWindows) {
      let slotStart =
        Math.ceil(window.ini / SLOT_GRANULARITY_MINUTES) *
        SLOT_GRANULARITY_MINUTES;

      while (slotStart + duration <= window.fim) {
        // Interseção de intervalos meio-abertos [início, fim):
        //   slotInício < ocupadoFim && ocupadoInício < slotFim
        const conflicts = busy.some(
          (interval) =>
            slotStart < interval.fim && interval.ini < slotStart + duration,
        );
        if (!conflicts) {
          freeSlots.add(slotStart);
        }
        slotStart += SLOT_GRANULARITY_MINUTES;
      }
    }

    const pad = (value: number): string => String(value).padStart(2, '0');
    const horariosLivres = [...freeSlots]
      .sort((a, b) => a - b)
      .map(
        (minutes) =>
          `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
      );

    return {
      data: query.data,
      barbeiroId: targetBarberId,
      duracaoMinutos: duration,
      horariosLivres,
    };
  }
}

