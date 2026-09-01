import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { StatusAgendamento } from '../generated/prisma/enums';
import {
  acquireCalendarLock,
  CALENDAR_LOCK_NS_CLIENTE,
  ScheduleDbClient,
  ScheduleService,
  SLOT_GRANULARITY_MINUTES,
} from '../schedule/schedule.service';
import {
  dateKeyFromUtcMidnight,
  formatLocalHHmm,
  isValidDateKey,
  localMinuteOfDay,
  prismaDateFilter,
  zonedWallTimeToUtc,
} from '../schedule/tz.util';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';

/**
 * Lock de CLIENTE (namespace 2 — ver schedule.service.ts). SEMPRE adquirido
 * ANTES do lock do BARBEIRO: ordem determinística, sem risco de deadlock.
 */
const CLIENT_LOCK_NS = CALENDAR_LOCK_NS_CLIENTE;

interface AppointmentRow {
  id: number;
  clienteId: number;
  barbeiroId: number;
  servicoId: number;
  data: Date;
  horaInicio: Date;
  horaFim: Date;
  status: StatusAgendamento;
  observacoes: string | null;
  servico: { id: number; nome: string; preco: Prisma.Decimal };
  barbeiro: { id: number; usuario: { nome: string } };
  cliente: { id: number; usuario: { nome: string } };
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
  ) {}

  /**
   * Identidade: Usuario.id -> Cliente.id (análogo ao padrão de Barbeiro).
   * clienteId NUNCA vem do frontend.
   */
  private async resolveClienteId(userId: number): Promise<number> {
    const cliente = await this.prisma.cliente.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    return cliente.id;
  }

  private async resolveBarbeiroId(userId: number): Promise<number> {
    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (!barbeiro) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    return barbeiro.id;
  }

  private parseHHmm(hhmm: string): number {
    const [hour, minute] = hhmm.split(':').map(Number);
    return hour * 60 + minute;
  }

  private minutesToHHmm(minutes: number): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }

  /**
   * Lock de CLIENTE (namespace 2 — distinto do namespace 1 do BARBEIRO).
   * Ordem determinística: CLIENTE → BARBEIRO (sem deadlock).
   */
  private async acquireClienteLock(
    client: ScheduleDbClient,
    clienteId: number,
  ): Promise<void> {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(
      ${CLIENT_LOCK_NS}::int,
      ${clienteId}::int
    )`;
  }

  /**
   * Criação de agendamento.
   *
   * TODA decisão ocorre dentro da MESMA transação, após adquirir os locks
   * (CLIENTE → BARBEIRO): grade de 15 minutos, horário passado,
   * funcionamento, bloqueios, conflitos do barbeiro e conflitos do próprio
   * cliente. Status é SEMPRE CONFIRMADO; duração SEMPRE vem do serviço;
   * clienteId/barbeiroId/status NUNCA são aceitos do frontend.
   */
  async create(
    userId: number,
    dto: CreateAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    // Identidade do cliente SEMPRE resolvida pelo token.
    const clienteId = await this.resolveClienteId(userId);

    // Validações puras de payload (sem banco).
    if (!isValidDateKey(dto.data)) {
      throw new BadRequestException('Data inválida.');
    }

    const startMinutes = this.parseHHmm(dto.horaInicio);
    if (startMinutes % SLOT_GRANULARITY_MINUTES !== 0) {
      throw new BadRequestException(
        `horaInicio deve estar alinhada à grade de ${SLOT_GRANULARITY_MINUTES} minutos.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Locks em ordem determinística: CLIENTE → BARBEIRO.
      await this.acquireClienteLock(tx, clienteId);
      await acquireCalendarLock(tx, dto.barbeiroId);

      // Agora capturado DEPOIS dos locks.
      const agora = new Date();

      // Barbeiro precisa existir e estar ativo.
      const barber = await tx.barbeiro.findFirst({
        where: { id: dto.barbeiroId, ativo: true },
        select: { id: true },
      });
      if (!barber) {
        throw new NotFoundException('Barbeiro não encontrado.');
      }

      // Serviço precisa existir, estar ativo e pertencer ao barbeiro.
      const service = await tx.servico.findFirst({
        where: { id: dto.servicoId, barbeiroId: dto.barbeiroId },
        select: { id: true, ativo: true, duracaoMinutos: true },
      });
      if (!service || !service.ativo) {
        throw new NotFoundException('Serviço não encontrado.');
      }

      const startInstant = zonedWallTimeToUtc(dto.data, dto.horaInicio);
      if (startInstant <= agora) {
        throw new BadRequestException(
          'Não é possível agendar um horário que já passou.',
        );
      }

      const endMinutes = startMinutes + service.duracaoMinutos;

      // Agenda do barbeiro lida NO MESMO tx (janelas + ocupações).
      const { windows, busy } = await this.scheduleService.getDateSnapshot(
        tx,
        dto.barbeiroId,
        dto.data,
      );

      // O slot deve caber integralmente em UMA janela de funcionamento.
      if (!windows.some((w) => startMinutes >= w.ini && endMinutes <= w.fim)) {
        throw new BadRequestException('Fora do horário de funcionamento.');
      }

      // Interseção meio-aberta [início, fim):
      //   novoInício < ocupadoFim && ocupadoInício < novoFim
      const overlaps = (interval: { ini: number; fim: number }): boolean =>
        startMinutes < interval.fim && interval.ini < endMinutes;

      // Bloqueio ativo → 400.
      if (busy.some((b) => b.origem === 'BLOQUEIO' && overlaps(b))) {
        throw new BadRequestException('Horário bloqueado.');
      }

      // Agendamento CONFIRMADO do barbeiro → 409.
      if (busy.some((b) => b.origem === 'AGENDAMENTO' && overlaps(b))) {
        throw new ConflictException('Horário não está mais disponível.');
      }

      // Conflito do PRÓPRIO CLIENTE (qualquer barbeiro, mesmo dia).
      // CANCELADO/CONCLUIDO/NAO_COMPARECEU não bloqueiam.
      const clientAppointments = await tx.agendamento.findMany({
        where: {
          clienteId,
          data: prismaDateFilter(dto.data),
          status: StatusAgendamento.CONFIRMADO,
        },
      });
      const clientConflict = clientAppointments.some((appointment) =>
        overlaps({
          ini: localMinuteOfDay(appointment.horaInicio),
          fim: localMinuteOfDay(appointment.horaFim),
        }),
      );
      if (clientConflict) {
        throw new ConflictException(
          'Horário não está disponível para o cliente.',
        );
      }

      // Criação — status SEMPRE CONFIRMADO; duração SEMPRE do serviço.
      const created = await tx.agendamento.create({
        data: {
          clienteId,
          barbeiroId: dto.barbeiroId,
          servicoId: dto.servicoId,
          data: prismaDateFilter(dto.data),
          horaInicio: startInstant,
          horaFim: zonedWallTimeToUtc(dto.data, this.minutesToHHmm(endMinutes)),
          status: StatusAgendamento.CONFIRMADO,
          observacoes: dto.observacoes ?? null,
        },
      });

      const row = await tx.agendamento.findUnique({
        where: { id: created.id },
        include: {
          servico: { select: { id: true, nome: true, preco: true } },
          barbeiro: {
            select: { id: true, usuario: { select: { nome: true } } },
          },
          cliente: {
            select: { id: true, usuario: { select: { nome: true } } },
          },
        },
      });

      if (!row) {
        throw new NotFoundException('Agendamento não encontrado.');
      }

      return this.toResponse(row);
    });
  }

  /**
   * Lista SOMENTE os agendamentos do cliente autenticado (API.md §9.2),
   * ordenados cronologicamente (mais próximos primeiro).
   */
  async findMyAppointments(userId: number): Promise<AppointmentResponseDto[]> {
    const clienteId = await this.resolveClienteId(userId);

    const rows = await this.prisma.agendamento.findMany({
      where: { clienteId },
      orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: { select: { id: true, usuario: { select: { nome: true } } } },
      },
    });

    return rows.map((row) => this.toResponse(row));
  }

  async findByIdForUser(
    userId: number,
    appointmentId: number,
  ): Promise<AppointmentResponseDto> {
    const row = await this.prisma.agendamento.findUnique({
      where: { id: appointmentId },
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: { select: { id: true, usuario: { select: { nome: true } } } },
      },
    });

    if (!row) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    const cliente = await this.prisma.cliente.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (cliente && row.clienteId === cliente.id) {
      return this.toResponse(row);
    }

    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (barbeiro && row.barbeiroId === barbeiro.id) {
      return this.toResponse(row);
    }

    throw new NotFoundException('Agendamento não encontrado.');
  }

  async findByBarberUserId(userId: number): Promise<AppointmentResponseDto[]> {
    const barbeiroId = await this.resolveBarbeiroId(userId);

    const rows = await this.prisma.agendamento.findMany({
      where: { barbeiroId },
      orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: { select: { id: true, usuario: { select: { nome: true } } } },
      },
    });

    return rows.map((row) => this.toResponse(row));
  }

  private toResponse(row: AppointmentRow): AppointmentResponseDto {
    // Duração calculada dos instantes persistidos (mesma base do Schedule).
    const duracaoMinutos =
      localMinuteOfDay(row.horaFim) - localMinuteOfDay(row.horaInicio);

    return {
      id: row.id,
      data: dateKeyFromUtcMidnight(row.data),
      horaInicio: formatLocalHHmm(row.horaInicio),
      horaFim: formatLocalHHmm(row.horaFim),
      duracaoMinutos,
      status: row.status,
      observacoes: row.observacoes,
      servico: {
        id: row.servico.id,
        nome: row.servico.nome,
        precoInformativo: new Prisma.Decimal(row.servico.preco).toFixed(2),
      },
      barbeiro: { id: row.barbeiroId, nome: row.barbeiro.usuario.nome },
      cliente: { id: row.clienteId, nome: row.cliente.usuario.nome },
    };
  }
}
