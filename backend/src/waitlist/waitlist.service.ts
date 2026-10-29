import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import {
  StatusAgendamento,
  StatusListaEspera,
  StatusWaitlistClaim,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  acquireClienteLock,
  AppointmentsService,
} from '../appointments/appointments.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  acquireCalendarLock,
  ScheduleService,
  ScheduleDbClient,
} from '../schedule/schedule.service';
import {
  getZonedParts,
  isValidDateKey,
  localMinuteOfDay,
  prismaDateFilter,
  zonedWallTimeToUtc,
} from '../schedule/tz.util';

export type WaitlistDbClient = PrismaClient | Prisma.TransactionClient;

export const WAITLIST_LOCK_NS = 3;
export const WAITLIST_CLAIM_LOCK_NS = 4;
export const WAITLIST_CLAIM_TTL_MINUTES = 5;
export const WAITLIST_EXPIRATION_LOCK_NS = 6;

export async function acquireWaitlistLock(
  client: WaitlistDbClient,
  clienteId: number,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(
    ${WAITLIST_LOCK_NS}::int,
    ${clienteId}::int
  )`;
}

export async function acquireWaitlistClaimLock(
  client: WaitlistDbClient,
  barbeiroId: number,
  servicoId: number,
  dateKey: string,
  horaInicio: string,
  horaFim: string,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(
    ${WAITLIST_CLAIM_LOCK_NS}::int,
    (hashtextextended(${`${barbeiroId}:${servicoId}:${dateKey}:${horaInicio}:${horaFim}`}, 0) % 2147483647)::int
  )`;
}

export async function acquireWaitlistExpirationLock(
  client: WaitlistDbClient,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(
    ${WAITLIST_EXPIRATION_LOCK_NS}::int,
    0::int
  )`;
}

export interface WaitlistCreateDto {
  barbeiroId: number;
  servicoId: number;
  data: string;
  horaInicio?: string;
  horaFim?: string;
}

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
    private readonly appointmentsService: AppointmentsService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private parseHHmm(hhmm: string): number {
    const [hour, minute] = hhmm.split(':').map(Number);
    return hour * 60 + minute;
  }

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

  private async ensureBarberAndService(
    barbeiroId: number,
    servicoId: number,
  ): Promise<void> {
    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { id: barbeiroId },
      select: { id: true, ativo: true },
    });

    if (!barbeiro || !barbeiro.ativo) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    const servico = await this.prisma.servico.findFirst({
      where: { id: servicoId, barbeiroId, ativo: true },
      select: { id: true, ativo: true },
    });

    if (!servico || !servico.ativo) {
      throw new NotFoundException('Serviço não encontrado.');
    }
  }

  private validateWindow(horaInicio?: string, horaFim?: string): void {
    if (horaInicio === undefined && horaFim === undefined) {
      return;
    }

    if (horaInicio === undefined || horaFim === undefined) {
      throw new BadRequestException(
        'Se informar horaInicio ou horaFim, deve informar ambos.',
      );
    }

    const hhmmPattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!hhmmPattern.test(horaInicio) || !hhmmPattern.test(horaFim)) {
      throw new BadRequestException('Horários devem estar no formato HH:mm.');
    }

    const start = this.parseHHmm(horaInicio);
    const end = this.parseHHmm(horaFim);
    if (end <= start) {
      throw new BadRequestException('horaFim deve ser posterior a horaInicio.');
    }
  }

  private toResponse(entry: any): any {
    const dataDesejada = entry.dataDesejada ?? entry.data ?? new Date();
    return {
      id: entry.id,
      barbeiroId: entry.barbeiroId ?? entry.barbeiro?.id ?? null,
      servicoId: entry.servicoId,
      status: entry.status,
      data: dataDesejada.toISOString().slice(0, 10),
      horaInicio: entry.horaInicio ?? null,
      horaFim: entry.horaFim ?? null,
      dataEntrada: entry.dataEntrada,
      dataAtualizacao: entry.dataAtualizacao,
      servico: entry.servico
        ? {
            id: entry.servico.id,
            nome: entry.servico.nome,
          }
        : undefined,
      barbeiro: entry.barbeiro
        ? {
            id: entry.barbeiro.id,
            nome: entry.barbeiro.usuario?.nome ?? '',
          }
        : undefined,
    };
  }

  private claimResponse(claim: any): any {
    return {
      id: claim.id,
      listaEsperaId: claim.listaEsperaId,
      barbeiroId: claim.barbeiroId,
      servicoId: claim.servicoId,
      data: claim.data.toISOString().slice(0, 10),
      horaInicio: claim.horaInicio,
      horaFim: claim.horaFim,
      status: claim.status,
      expiraEm: claim.expiraEm,
      dataCriacao: claim.dataCriacao,
    };
  }

  async create(userId: number, dto: WaitlistCreateDto): Promise<any> {
    const clienteId = await this.resolveClienteId(userId);

    if (!isValidDateKey(dto.data)) {
      throw new BadRequestException('Data inválida.');
    }

    const now = new Date();
    const todayParts = getZonedParts(now);
    const todayKey = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`;

    if (dto.data < todayKey) {
      throw new BadRequestException('Data inválida.');
    }

    this.validateWindow(dto.horaInicio, dto.horaFim);
    await this.ensureBarberAndService(dto.barbeiroId, dto.servicoId);

    return this.prisma.$transaction(async (tx: WaitlistDbClient) => {
      await acquireWaitlistLock(tx, clienteId);

      const active = await tx.listaEspera.findFirst({
        where: {
          clienteId,
          barbeiroId: dto.barbeiroId,
          servicoId: dto.servicoId,
          dataDesejada: prismaDateFilter(dto.data),
          status: StatusListaEspera.ATIVA,
        },
      });

      if (active) {
        throw new ConflictException(
          'Já existe uma entrada ativa para este cliente, serviço e data.',
        );
      }

      const created = await tx.listaEspera.create({
        data: {
          clienteId,
          barbeiroId: dto.barbeiroId,
          servicoId: dto.servicoId,
          dataDesejada: prismaDateFilter(dto.data),
          horaInicio: dto.horaInicio ?? null,
          horaFim: dto.horaFim ?? null,
          status: StatusListaEspera.ATIVA,
          dataEntrada: new Date(),
          dataAtualizacao: new Date(),
        },
      });

      return this.toResponse({
        ...created,
        horaInicio: dto.horaInicio ?? null,
        horaFim: dto.horaFim ?? null,
      });
    });
  }

  async findMyWaitlist(userId: number): Promise<any[]> {
    const clienteId = await this.resolveClienteId(userId);

    const entries = await this.prisma.listaEspera.findMany({
      where: { clienteId },
      orderBy: [{ dataDesejada: 'asc' }, { dataEntrada: 'asc' }],
      include: {
        servico: { select: { id: true, nome: true } },
        barbeiro: {
          select: { id: true, usuario: { select: { nome: true } } },
        },
      },
    });

    return entries.map((entry) => this.toResponse(entry));
  }

  private async resolveBarbeiroId(userId: number): Promise<number> {
    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { usuarioId: userId },
      select: { id: true, ativo: true },
    });

    if (!barbeiro || !barbeiro.ativo) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    return barbeiro.id;
  }

  /**
   * Lista de espera do BARBEIRO autenticado — GET /waitlist.
   *
   * Ordena por prioridade (data desejada e, dentro dela, ordem de chegada/FIFO),
   * espelhando a mesma regra usada na escolha de elegíveis para um slot. Inclui
   * cliente e serviço para que a tela do barbeiro exiba os dados da solicitação.
   */
  async findBarberWaitlist(userId: number): Promise<any[]> {
    const barbeiroId = await this.resolveBarbeiroId(userId);

    const entries = await this.prisma.listaEspera.findMany({
      where: { barbeiroId },
      orderBy: [{ dataDesejada: 'asc' }, { dataEntrada: 'asc' }, { id: 'asc' }],
      include: {
        servico: { select: { id: true, nome: true } },
        cliente: {
          select: { id: true, usuario: { select: { nome: true } } },
        },
      },
    });

    return entries.map((entry) => ({
      ...this.toResponse(entry),
      cliente: entry.cliente
        ? { id: entry.cliente.id, nome: entry.cliente.usuario?.nome ?? '' }
        : null,
    }));
  }

  async findEligibleEntriesForSlot(
    barbeiroId: number,
    servicoId: number,
    dateKey: string,
    horaInicio: string,
    horaFim: string,
    client: ScheduleDbClient = this.prisma,
  ): Promise<any[]> {
    if (!isValidDateKey(dateKey)) {
      throw new BadRequestException('Data inválida.');
    }

    const slotStart = this.parseHHmm(horaInicio);
    const slotEnd = this.parseHHmm(horaFim);
    if (slotEnd <= slotStart) {
      throw new BadRequestException('horaFim deve ser posterior a horaInicio.');
    }

    const todayParts = getZonedParts(new Date());
    const todayKey = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`;
    if (dateKey < todayKey) {
      return [];
    }

    const service = await client.servico.findFirst({
      where: { id: servicoId, barbeiroId, ativo: true },
      select: { id: true, duracaoMinutos: true },
    });
    if (!service) {
      return [];
    }

    const barber = await client.barbeiro.findUnique({
      where: { id: barbeiroId },
      select: { id: true, ativo: true },
    });
    if (!barber || !barber.ativo) {
      return [];
    }

    const { windows, busy } = await this.scheduleService.getDateSnapshot(
      client,
      barbeiroId,
      dateKey,
    );

    const slotFitsBusinessHours = windows.some(
      (window) => slotStart >= window.ini && slotEnd <= window.fim,
    );
    if (!slotFitsBusinessHours) {
      return [];
    }

    const overlapsBusy = busy.some(
      (interval) => slotStart < interval.fim && interval.ini < slotEnd,
    );
    if (overlapsBusy) {
      return [];
    }

    const entries = await client.listaEspera.findMany({
      where: {
        status: StatusListaEspera.ATIVA,
        barbeiroId,
        servicoId,
        dataDesejada: prismaDateFilter(dateKey),
      },
      orderBy: [{ dataEntrada: 'asc' }, { id: 'asc' }],
    });

    const orderedEntries = [...entries].sort((a, b) => {
      const timeDiff =
        new Date(a.dataEntrada).getTime() - new Date(b.dataEntrada).getTime();
      return timeDiff !== 0 ? timeDiff : (a.id ?? 0) - (b.id ?? 0);
    });

    const eligible: any[] = [];
    for (const entry of orderedEntries) {
      if (entry.status !== StatusListaEspera.ATIVA) {
        continue;
      }

      const entryStart = entry.horaInicio
        ? this.parseHHmm(entry.horaInicio)
        : null;
      const entryEnd = entry.horaFim ? this.parseHHmm(entry.horaFim) : null;

      if (entryStart !== null && entryEnd !== null) {
        const withinDesiredWindow =
          entryStart <= slotStart && slotEnd <= entryEnd;
        if (!withinDesiredWindow) {
          continue;
        }
      }

      const clientAppointments = await client.agendamento.findMany({
        where: {
          clienteId: entry.clienteId,
          data: prismaDateFilter(dateKey),
          status: StatusAgendamento.CONFIRMADO,
        },
      });

      const hasClientConflict = clientAppointments.some((appointment) => {
        const appointmentStart = localMinuteOfDay(appointment.horaInicio);
        const appointmentEnd = localMinuteOfDay(appointment.horaFim);
        return slotStart < appointmentEnd && appointmentStart < slotEnd;
      });

      if (hasClientConflict) {
        continue;
      }

      // Exclui a entrada se ela já possui claim registrado para este slot exato
      // com status RECUSADO, EXPIRADO ou ATIVO (evita loop de reoferta da mesma vaga para o mesmo cliente).
      const pastClaimForSlot = await client.waitlistClaim.findFirst({
        where: {
          listaEsperaId: entry.id,
          barbeiroId,
          servicoId,
          data: prismaDateFilter(dateKey),
          horaInicio,
          horaFim,
          status: {
            in: [
              StatusWaitlistClaim.RECUSADO,
              StatusWaitlistClaim.EXPIRADO,
              StatusWaitlistClaim.ATIVO,
            ],
          },
        },
        select: { id: true },
      });
      if (pastClaimForSlot) {
        continue;
      }

      eligible.push(entry);
    }

    return eligible;
  }

  async claimNextEligibleEntryForSlot(
    barbeiroId: number,
    servicoId: number,
    dateKey: string,
    horaInicio: string,
    horaFim: string,
  ): Promise<any> {
    if (!isValidDateKey(dateKey)) {
      throw new BadRequestException('Data inválida.');
    }

    this.validateWindow(horaInicio, horaFim);
    const slotStart = this.parseHHmm(horaInicio);
    const slotEnd = this.parseHHmm(horaFim);
    const slotStartInstant = zonedWallTimeToUtc(dateKey, horaInicio);

    return this.prisma.$transaction(async (tx: WaitlistDbClient) => {
      // O lock do barbeiro serializa este fluxo com appointments e bloqueios.
      await acquireCalendarLock(tx, barbeiroId);
      await acquireWaitlistClaimLock(
        tx,
        barbeiroId,
        servicoId,
        dateKey,
        horaInicio,
        horaFim,
      );

      const agora = new Date();
      if (slotStartInstant <= agora) {
        throw new BadRequestException(
          'Não é possível reivindicar um horário que já passou.',
        );
      }

      const service = await tx.servico.findFirst({
        where: { id: servicoId, barbeiroId, ativo: true },
        select: { id: true, duracaoMinutos: true },
      });
      if (!service) {
        throw new NotFoundException('Serviço não encontrado.');
      }

      if (service.duracaoMinutos !== slotEnd - slotStart) {
        throw new BadRequestException(
          'O slot não corresponde à duração do serviço.',
        );
      }

      const snapshot = await this.scheduleService.getDateSnapshot(
        tx,
        barbeiroId,
        dateKey,
      );
      const fitsBusinessHours = snapshot.windows.some(
        (window) => slotStart >= window.ini && slotEnd <= window.fim,
      );
      if (!fitsBusinessHours) {
        throw new BadRequestException('Fora do horário de funcionamento.');
      }

      const overlaps = (interval: { ini: number; fim: number }): boolean =>
        slotStart < interval.fim && interval.ini < slotEnd;
      if (snapshot.busy.some((interval) => overlaps(interval))) {
        throw new ConflictException('O slot não está mais disponível.');
      }

      const activeClaim = await tx.waitlistClaim.findFirst({
        where: {
          barbeiroId,
          servicoId,
          data: prismaDateFilter(dateKey),
          horaInicio,
          horaFim,
          status: StatusWaitlistClaim.ATIVO,
          expiraEm: { gt: agora },
        },
        orderBy: { dataCriacao: 'desc' },
      });
      if (activeClaim) {
        throw new ConflictException('Já existe um claim ativo para este slot.');
      }

      const eligible = await this.findEligibleEntriesForSlot(
        barbeiroId,
        servicoId,
        dateKey,
        horaInicio,
        horaFim,
        tx,
      );
      const candidate = eligible[0];
      if (!candidate) {
        throw new NotFoundException('Nenhuma entrada elegível para este slot.');
      }

      const expiraEm = new Date(
        agora.getTime() + WAITLIST_CLAIM_TTL_MINUTES * 60 * 1000,
      );
      const created = await tx.waitlistClaim.create({
        data: {
          listaEsperaId: candidate.id,
          barbeiroId,
          servicoId,
          data: prismaDateFilter(dateKey),
          horaInicio,
          horaFim,
          status: StatusWaitlistClaim.ATIVO,
          expiraEm,
        },
      });

      await this.notificationsService.createWaitlistOpportunity(
        tx,
        candidate.clienteId,
        created.id,
      );

      return {
        id: created.id,
        listaEsperaId: created.listaEsperaId,
        barbeiroId: created.barbeiroId,
        servicoId: created.servicoId,
        data: dateKey,
        horaInicio: created.horaInicio,
        horaFim: created.horaFim,
        status: created.status,
        expiraEm: created.expiraEm,
        dataCriacao: created.dataCriacao,
      };
    });
  }

  private async findOwnedClaim(userId: number, claimId: number): Promise<any> {
    const clienteId = await this.resolveClienteId(userId);
    const claim = await this.prisma.waitlistClaim.findFirst({
      where: {
        id: claimId,
        listaEspera: { clienteId },
      },
      select: {
        id: true,
        listaEsperaId: true,
        barbeiroId: true,
        servicoId: true,
        data: true,
        horaInicio: true,
        horaFim: true,
        status: true,
        expiraEm: true,
        dataCriacao: true,
      },
    });

    if (!claim) {
      throw new NotFoundException('Claim não encontrado.');
    }

    return { clienteId, claim };
  }

  async acceptClaim(userId: number, claimId: number): Promise<any> {
    const { clienteId, claim } = await this.findOwnedClaim(userId, claimId);
    const dateKey = claim.data.toISOString().slice(0, 10);

    return this.prisma.$transaction(async (tx: WaitlistDbClient) => {
      // Ordem 2 (cliente) -> 1 (barbeiro) -> 4 (claim), igual ao fluxo normal
      // de appointment e serializada com os fluxos de agenda/claim existentes.
      await acquireClienteLock(tx, clienteId);
      await acquireCalendarLock(tx, claim.barbeiroId);
      await acquireWaitlistClaimLock(
        tx,
        claim.barbeiroId,
        claim.servicoId,
        dateKey,
        claim.horaInicio,
        claim.horaFim,
      );

      const current = await tx.waitlistClaim.findUnique({
        where: { id: claimId },
        include: {
          listaEspera: { select: { clienteId: true, status: true } },
        },
      });
      if (!current || current.listaEspera.clienteId !== clienteId) {
        throw new NotFoundException('Claim não encontrado.');
      }
      if (current.status !== StatusWaitlistClaim.ATIVO) {
        throw new ConflictException('Claim não está ativo.');
      }

      const agora = new Date();
      if (current.expiraEm <= agora) {
        throw new ConflictException('Claim expirado.');
      }

      let appointment;
      try {
        appointment = await this.appointmentsService.createConfirmedForClient(
          tx,
          {
            clienteId,
            barbeiroId: current.barbeiroId,
            servicoId: current.servicoId,
            data: dateKey,
            horaInicio: current.horaInicio,
            horaFim: current.horaFim,
            claimId: current.id,
          },
        );
      } catch (error) {
        // M-4: a criação já valida barbeiro/serviço ativos. Se o barbeiro ou o
        // serviço foi desativado entre a emissão do claim e o aceite, o 404
        // genérico é confuso para o cliente. Traduzimos APENAS esse caso para
        // 409 dizendo que a oportunidade não está mais disponível — a regra de
        // negócio continua sendo uma só (a validação do createConfirmedForClient),
        // sem duplicar checagens aqui.
        if (error instanceof NotFoundException) {
          throw new ConflictException(
            'A oportunidade não está mais disponível.',
          );
        }
        throw error;
      }

      const accepted = await tx.waitlistClaim.updateMany({
        where: { id: claimId, status: StatusWaitlistClaim.ATIVO },
        data: { status: StatusWaitlistClaim.ACEITO },
      });
      if (accepted.count !== 1) {
        throw new ConflictException('Claim foi atualizado por outra operação.');
      }

      const attended = await tx.listaEspera.updateMany({
        where: { id: current.listaEsperaId, status: StatusListaEspera.ATIVA },
        data: { status: StatusListaEspera.ATENDIDA },
      });
      if (attended.count !== 1) {
        throw new ConflictException('Entrada da lista não está ativa.');
      }

      return {
        appointment,
        claim: this.claimResponse({
          ...current,
          status: StatusWaitlistClaim.ACEITO,
        }),
      };
    });
  }

  async rejectClaim(userId: number, claimId: number): Promise<any> {
    const { clienteId, claim } = await this.findOwnedClaim(userId, claimId);
    const dateKey = claim.data.toISOString().slice(0, 10);

    const result = await this.prisma.$transaction(
      async (tx: WaitlistDbClient) => {
        await acquireClienteLock(tx, clienteId);
        await acquireCalendarLock(tx, claim.barbeiroId);
        await acquireWaitlistClaimLock(
          tx,
          claim.barbeiroId,
          claim.servicoId,
          dateKey,
          claim.horaInicio,
          claim.horaFim,
        );

        const current = await tx.waitlistClaim.findUnique({
          where: { id: claimId },
          include: {
            listaEspera: { select: { clienteId: true, status: true } },
          },
        });
        if (!current || current.listaEspera.clienteId !== clienteId) {
          throw new NotFoundException('Claim não encontrado.');
        }
        if (current.status !== StatusWaitlistClaim.ATIVO) {
          throw new ConflictException('Claim não está ativo.');
        }

        if (current.expiraEm <= new Date()) {
          throw new ConflictException('Claim expirado.');
        }

        const rejected = await tx.waitlistClaim.updateMany({
          where: { id: claimId, status: StatusWaitlistClaim.ATIVO },
          data: { status: StatusWaitlistClaim.RECUSADO },
        });
        if (rejected.count !== 1) {
          throw new ConflictException(
            'Claim foi atualizado por outra operação.',
          );
        }

        return this.claimResponse({
          ...current,
          status: StatusWaitlistClaim.RECUSADO,
        });
      },
    );

    // Reoferta da vaga após a confirmação da recusa no banco de dados.
    // Executada fora da transação de recusa para não reter locks desnecessários
    // e com tratamento de erro resiliente: uma falha na reoferta não reverte a recusa.
    try {
      await this.triggerOpportunityForRejectedClaim({
        barbeiroId: claim.barbeiroId,
        dateKey,
        horaInicio: claim.horaInicio,
        horaFim: claim.horaFim,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao reofertar janela liberada por recusa de claim: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return result;
  }

  private async triggerOpportunityForRejectedClaim(window: {
    barbeiroId: number;
    dateKey: string;
    horaInicio: string;
    horaFim: string;
  }): Promise<void> {
    if (!this.moduleRef) {
      return;
    }

    const opportunityService = this.moduleRef.get<any>(
      'WAITLIST_OPPORTUNITY_SERVICE',
      { strict: false },
    );
    if (opportunityService) {
      await opportunityService.tryCreateForReleasedWindow(window);
    }
  }

  /**
   * Cancela uma entrada da lista de espera (dono: o próprio cliente).
   *
   * 1. Valida atomicamente em transação a propriedade e o status ATIVA da entrada.
   * 2. Invalida imediatamente qualquer claim ATIVO vinculado a essa entrada (mudando para RECUSADO).
   * 3. Se um claim ATIVO foi invalidado, reoferta a janela liberada para o próximo candidato
   *    fora da transação, com tratamento resiliente de erros.
   */
  async cancel(userId: number, waitlistId: number): Promise<any> {
    const clienteId = await this.resolveClienteId(userId);

    const { updatedEntry, invalidatedClaims } =
      await this.prisma.$transaction(async (tx: WaitlistDbClient) => {
        await acquireClienteLock(tx, clienteId);

        const updated = await tx.listaEspera.updateMany({
          where: {
            id: waitlistId,
            clienteId,
            status: StatusListaEspera.ATIVA,
          },
          data: {
            status: StatusListaEspera.CANCELADA,
            dataAtualizacao: new Date(),
          },
        });

        if (updated.count !== 1) {
          // Não distingue "não existe", "de outro cliente" ou "já não está ATIVA"
          // (ex.: NOTIFICADA/ATENDIDA/CANCELADA/EXPIRADA) para não revelar
          // existência nem permitir sobrescrever um estado válido. Mesmo padrão de
          // 404 genérico usado no restante do projeto para recurso não acessível.
          throw new NotFoundException(
            'Entrada de lista de espera não encontrada.',
          );
        }

        const freshEntry = await tx.listaEspera.findUnique({
          where: { id: waitlistId },
          include: {
            servico: { select: { id: true, nome: true } },
            barbeiro: {
              select: { id: true, usuario: { select: { nome: true } } },
            },
          },
        });

        if (!freshEntry) {
          throw new NotFoundException(
            'Entrada de lista de espera não encontrada.',
          );
        }

        if (freshEntry.barbeiroId) {
          await acquireCalendarLock(tx, freshEntry.barbeiroId);
        }

        // Localiza claims ATIVO vinculados a esta entrada para invalidá-los
        const activeClaims =
          (await tx.waitlistClaim.findMany({
            where: {
              listaEsperaId: waitlistId,
              status: StatusWaitlistClaim.ATIVO,
            },
          })) ?? [];

        if (activeClaims.length > 0) {
          await tx.waitlistClaim.updateMany({
            where: {
              listaEsperaId: waitlistId,
              status: StatusWaitlistClaim.ATIVO,
            },
            data: {
              status: StatusWaitlistClaim.RECUSADO,
              dataAtualizacao: new Date(),
            },
          });
        }

        return {
          updatedEntry: freshEntry,
          invalidatedClaims: activeClaims,
        };
      });

    // Reoferta da vaga somente se algum claim ATIVO foi invalidado pelo cancelamento.
    // Executada fora da transação para não reter locks e com erro resiliente:
    // uma falha na reoferta não desfaz o cancelamento já confirmado no banco.
    if (invalidatedClaims && invalidatedClaims.length > 0) {
      for (const claim of invalidatedClaims) {
        const dateKey = claim.data.toISOString().slice(0, 10);
        try {
          await this.triggerOpportunityForRejectedClaim({
            barbeiroId: claim.barbeiroId,
            dateKey,
            horaInicio: claim.horaInicio,
            horaFim: claim.horaFim,
          });
        } catch (error) {
          this.logger.error(
            `Falha ao reofertar janela liberada por cancelamento de entrada: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    }

    return this.toResponse(updatedEntry);
  }

  /**
   * Processamento periódico de claims expirados (ETAPA 5B).
   *
   * 1. Serializa instâncias concorrentes com WAITLIST_EXPIRATION_LOCK_NS (namespace 6).
   * 2. Localiza claims com status ATIVO e expiraEm <= agora.
   * 3. Atualiza os claims para status EXPIRADO de forma atômica no banco de dados.
   * 4. Para cada janela única afetada, aciona a reoferta via tryCreateForReleasedWindow.
   *    Cada janela é processada individualmente com try/catch: falha em uma janela
   *    não interrompe o processamento das demais.
   */
  async processExpiredClaims(
    now: Date = new Date(),
  ): Promise<{ expiredCount: number; reofferedWindows: number }> {
    const expiredWindows = await this.prisma.$transaction(async (tx) => {
      await acquireWaitlistExpirationLock(tx);

      // Busca claims com status ATIVO cujo horário limite já passou
      const expiredClaims = await tx.waitlistClaim.findMany({
        where: {
          status: StatusWaitlistClaim.ATIVO,
          expiraEm: { lte: now },
        },
        select: {
          id: true,
          barbeiroId: true,
          data: true,
          horaInicio: true,
          horaFim: true,
        },
        orderBy: { expiraEm: 'asc' },
      });

      if (expiredClaims.length === 0) {
        return [];
      }

      const claimIds = expiredClaims.map((c) => c.id);

      // Atualiza atomicamente os claims para o status EXPIRADO
      await tx.waitlistClaim.updateMany({
        where: {
          id: { in: claimIds },
          status: StatusWaitlistClaim.ATIVO,
        },
        data: {
          status: StatusWaitlistClaim.EXPIRADO,
          dataAtualizacao: new Date(),
        },
      });

      // Consolida janelas únicas para reoferta (evita reofertar a mesma janela múltiplas vezes no mesmo ciclo)
      const windowMap = new Map<
        string,
        {
          barbeiroId: number;
          dateKey: string;
          horaInicio: string;
          horaFim: string;
        }
      >();

      for (const claim of expiredClaims) {
        const dateKey = claim.data.toISOString().slice(0, 10);
        const windowKey = `${claim.barbeiroId}:${dateKey}:${claim.horaInicio}:${claim.horaFim}`;
        if (!windowMap.has(windowKey)) {
          windowMap.set(windowKey, {
            barbeiroId: claim.barbeiroId,
            dateKey,
            horaInicio: claim.horaInicio,
            horaFim: claim.horaFim,
          });
        }
      }

      return Array.from(windowMap.values());
    });

    if (expiredWindows.length === 0) {
      return { expiredCount: 0, reofferedWindows: 0 };
    }

    let reofferedWindows = 0;

    // A reoferta é executada fora da transação de marcação de expirados
    // para liberar os locks de banco e permitir que cada janela adquira
    // seus próprios locks determinísticos de calendário e claim sem risco de deadlock.
    for (const window of expiredWindows) {
      try {
        await this.triggerOpportunityForRejectedClaim(window);
        reofferedWindows++;
      } catch (error) {
        this.logger.error(
          `Falha ao reofertar janela expirada [Barbeiro ${window.barbeiroId}, ${window.dateKey} ${window.horaInicio}-${window.horaFim}]: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return {
      expiredCount: expiredWindows.length,
      reofferedWindows,
    };
  }
}
