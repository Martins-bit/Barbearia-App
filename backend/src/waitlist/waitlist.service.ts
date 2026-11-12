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
  OrigemWaitlistReoffer,
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
  isValidDateKey,
  localMinuteOfDay,
  prismaDateFilter,
  zonedWallTimeToUtc,
} from '../schedule/tz.util';
import type {
  EnqueueWaitlistReoffer,
  ProcessWaitlistReoffersResult,
  WaitlistReofferOutboxService,
} from './waitlist-reoffer-outbox.service';
import { WAITLIST_REOFFER_LEASE_MS } from './waitlist-reoffer.constants';

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

interface ActiveWaitlistClaimFilter {
  listaEsperaId?: number;
  barbeiroId?: number;
  servicoId?: number;
  dateKey?: string;
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

  private getReofferOutboxService(): WaitlistReofferOutboxService {
    const outboxService = this.moduleRef?.get<WaitlistReofferOutboxService>(
      'WAITLIST_REOFFER_OUTBOX_SERVICE',
      { strict: false },
    );
    if (!outboxService) {
      throw new Error('Serviço OUTBOX de reofertas não está disponível.');
    }
    return outboxService;
  }

  private async enqueueReleasedWindow(
    tx: WaitlistDbClient,
    event: EnqueueWaitlistReoffer,
  ): Promise<void> {
    await this.getReofferOutboxService().enqueue(tx, event);
  }

  private async hasUnexpiredActiveClaim(
    client: WaitlistDbClient,
    filter: ActiveWaitlistClaimFilter,
  ): Promise<boolean> {
    const conditions = [
      Prisma.sql`claim."status" = ${StatusWaitlistClaim.ATIVO}::"StatusWaitlistClaim"`,
      Prisma.sql`claim."expiraEm" > (clock_timestamp() AT TIME ZONE 'UTC')`,
    ];

    if (filter.listaEsperaId !== undefined) {
      conditions.push(
        Prisma.sql`claim."listaEsperaId" = ${filter.listaEsperaId}`,
      );
    }
    if (filter.barbeiroId !== undefined) {
      conditions.push(Prisma.sql`claim."barbeiroId" = ${filter.barbeiroId}`);
    }
    if (filter.servicoId !== undefined) {
      conditions.push(Prisma.sql`claim."servicoId" = ${filter.servicoId}`);
    }
    if (filter.dateKey !== undefined) {
      conditions.push(Prisma.sql`claim."data" = ${filter.dateKey}::date`);
    }
    if (filter.horaInicio !== undefined) {
      conditions.push(Prisma.sql`claim."horaInicio" = ${filter.horaInicio}`);
    }
    if (filter.horaFim !== undefined) {
      conditions.push(Prisma.sql`claim."horaFim" = ${filter.horaFim}`);
    }

    const rows = await client.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "WaitlistClaim" AS claim
        WHERE ${Prisma.join(conditions, ' AND ')}
      ) AS "exists"
    `;
    const result = rows[0];
    if (!result) {
      throw new Error('Consulta de claim ativo não retornou resultado.');
    }
    return result.exists;
  }

  async hasUnexpiredActiveClaimForEntry(listaEsperaId: number): Promise<boolean> {
    return this.hasUnexpiredActiveClaim(this.prisma, { listaEsperaId });
  }

  private async processPendingReoffers(): Promise<ProcessWaitlistReoffersResult> {
    const outboxService = this.moduleRef?.get<WaitlistReofferOutboxService>(
      'WAITLIST_REOFFER_OUTBOX_SERVICE',
      { strict: false },
    );
    if (!outboxService) {
      this.logger.error(
        'Serviço OUTBOX de reofertas indisponível; pendências persistidas aguardam o próximo ciclo.',
      );
      return {
        claimedCount: 0,
        completedCount: 0,
        retryCount: 0,
        permanentFailureCount: 0,
      };
    }

    try {
      return await outboxService.processPendingReoffers();
    } catch {
      this.logger.error(
        'Falha no processamento imediato do OUTBOX de reofertas.',
      );
      return {
        claimedCount: 0,
        completedCount: 0,
        retryCount: 0,
        permanentFailureCount: 0,
      };
    }
  }

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

    this.validateWindow(dto.horaInicio, dto.horaFim);
    await this.ensureBarberAndService(dto.barbeiroId, dto.servicoId);

    return this.prisma.$transaction(async (tx: WaitlistDbClient) => {
      await acquireWaitlistLock(tx, clienteId);

      const currentDay = await tx.$queryRaw<Array<{ todayKey: string }>>`
        SELECT to_char(
          (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
          'YYYY-MM-DD'
        ) AS "todayKey"
      `;
      if (!currentDay[0]) {
        throw new Error(
          'Consulta da data local do banco não retornou resultado.',
        );
      }
      if (dto.data < currentDay[0].todayKey) {
        throw new BadRequestException('Data inválida.');
      }

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

    const slotStartInstant = zonedWallTimeToUtc(dateKey, horaInicio);
    const startEligibility = await client.$queryRaw<Array<{ isFuture: boolean }>>`
      SELECT ${slotStartInstant}::timestamptz > clock_timestamp() AS "isFuture"
    `;
    if (!startEligibility[0]) {
      throw new Error(
        'Consulta de elegibilidade temporal não retornou resultado.',
      );
    }
    if (!startEligibility[0].isFuture) {
      return [];
    }

    const service = await client.servico.findFirst({
      where: { id: servicoId, barbeiroId, ativo: true },
      select: { id: true, duracaoMinutos: true },
    });
    if (!service) {
      return [];
    }
    if (service.duracaoMinutos !== slotEnd - slotStart) {
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

      const activeClaim = await this.hasUnexpiredActiveClaim(client, {
        listaEsperaId: entry.id,
        barbeiroId,
        servicoId,
        dateKey,
        horaInicio,
        horaFim,
      });
      if (activeClaim) {
        continue;
      }

      const refusedClaim = await client.waitlistClaim.findFirst({
        where: {
          listaEsperaId: entry.id,
          barbeiroId,
          servicoId,
          data: prismaDateFilter(dateKey),
          horaInicio,
          horaFim,
          status: StatusWaitlistClaim.RECUSADO,
        },
        select: { id: true },
      });
      if (refusedClaim) {
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
    reofertaOutboxId?: number,
    reofertaAttempt?: number,
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

      if (reofertaOutboxId !== undefined) {
        if (reofertaAttempt === undefined) {
          throw new BadRequestException(
            'Tentativa da reoferta não foi informada.',
          );
        }

        // A leitura não bloqueia a linha: o heartbeat pode renovar o lease
        // enquanto esta transação valida a agenda e cria o claim.
        const leaseOwnership = await tx.$queryRaw<
          Array<{ authorized: boolean }>
        >`
          SELECT EXISTS (
            SELECT 1
            FROM "WaitlistReofferOutbox"
            WHERE "id" = ${reofertaOutboxId}
              AND "status" = 'PROCESSANDO'::"StatusWaitlistReoffer"
              AND "tentativas" = ${reofertaAttempt}
              AND "leaseAte" > (clock_timestamp() AT TIME ZONE 'UTC')
          ) AS "authorized"
        `;
        if (leaseOwnership[0]?.authorized !== true) {
          throw new ConflictException(
            'Lease da reoferta expirou ou pertence a outra tentativa.',
          );
        }

        const existing = await tx.waitlistClaim.findUnique({
          where: { reofertaOutboxId },
        });
        if (existing) {
          return {
            id: existing.id,
            listaEsperaId: existing.listaEsperaId,
            barbeiroId: existing.barbeiroId,
            servicoId: existing.servicoId,
            data: dateKey,
            horaInicio: existing.horaInicio,
            horaFim: existing.horaFim,
            status: existing.status,
            expiraEm: existing.expiraEm,
            dataCriacao: existing.dataCriacao,
          };
        }
      }

      const startEligibility = await tx.$queryRaw<Array<{ isFuture: boolean }>>`
        SELECT ${slotStartInstant}::timestamptz > clock_timestamp() AS "isFuture"
      `;
      if (!startEligibility[0]) {
        throw new Error(
          'Consulta de elegibilidade temporal não retornou resultado.',
        );
      }
      if (!startEligibility[0].isFuture) {
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

      const activeClaim = await this.hasUnexpiredActiveClaim(tx, {
        barbeiroId,
        servicoId,
        dateKey,
        horaInicio,
        horaFim,
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

      const expiryRows = await tx.$queryRaw<Array<{ expiresAt: string }>>`
        SELECT to_char(
          (clock_timestamp() AT TIME ZONE 'UTC')
            + (${WAITLIST_CLAIM_TTL_MINUTES} * INTERVAL '1 minute'),
          'YYYY-MM-DD"T"HH24:MI:SS.MS'
        ) || 'Z' AS "expiresAt"
      `;
      const expiresAt = expiryRows[0]?.expiresAt;
      if (!expiresAt) {
        throw new Error('Consulta do prazo do claim não retornou resultado.');
      }
      const expiraEm = new Date(expiresAt);
      if (!Number.isFinite(expiraEm.getTime())) {
        throw new Error('Consulta do prazo do claim retornou data inválida.');
      }

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
          ...(reofertaOutboxId !== undefined ? { reofertaOutboxId } : {}),
        },
      });

      await this.notificationsService.createWaitlistOpportunity(
        tx,
        candidate.clienteId,
        created.id,
      );

      if (reofertaOutboxId !== undefined) {
        // O fencing final mantém o lock apenas até o commit e reverte a
        // transação inteira se o lease venceu ou outra tentativa assumiu.
        const leaseRenewed = await tx.$executeRaw`
          UPDATE "WaitlistReofferOutbox"
          SET
            "leaseAte" = (clock_timestamp() AT TIME ZONE 'UTC')
              + (${WAITLIST_REOFFER_LEASE_MS} * INTERVAL '1 millisecond'),
            "dataAtualizacao" = (clock_timestamp() AT TIME ZONE 'UTC')
          WHERE "id" = ${reofertaOutboxId}
            AND "status" = 'PROCESSANDO'::"StatusWaitlistReoffer"
            AND "tentativas" = ${reofertaAttempt}
            AND "leaseAte" > (clock_timestamp() AT TIME ZONE 'UTC')
        `;
        if (leaseRenewed !== 1) {
          throw new ConflictException(
            'A tentativa da reoferta perdeu autorização durante a criação do claim.',
          );
        }
      }

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

  private async transitionActiveClaimBeforeExpiry(
    client: WaitlistDbClient,
    claimId: number,
    status:
      | (typeof StatusWaitlistClaim)['ACEITO']
      | (typeof StatusWaitlistClaim)['RECUSADO'],
  ): Promise<number> {
    await client.$queryRaw<{ id: number }[]>`
      SELECT "id"
      FROM "WaitlistClaim"
      WHERE "id" = ${claimId}
      FOR UPDATE
    `;

    return client.$executeRaw`
      WITH transition_time AS (
        SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"
      )
      UPDATE "WaitlistClaim" AS claim
      SET
        "status" = ${status}::"StatusWaitlistClaim",
        "dataAtualizacao" = transition_time."now"
      FROM transition_time
      WHERE claim."id" = ${claimId}
        AND claim."status" = ${StatusWaitlistClaim.ATIVO}::"StatusWaitlistClaim"
        AND claim."expiraEm" > transition_time."now"
    `;
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
        if (current.status === StatusWaitlistClaim.EXPIRADO) {
          throw new ConflictException(
            'Outro cliente aceitou esse horário primeiro ou o prazo da oportunidade expirou.',
          );
        }
        if (current.status === StatusWaitlistClaim.RECUSADO) {
          throw new ConflictException(
            'Esta oportunidade de vaga foi recusada anteriormente.',
          );
        }
        throw new ConflictException(
          'Outro cliente aceitou esse horário primeiro. Você continua podendo receber novas oportunidades pela lista de espera.',
        );
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

      const accepted = await this.transitionActiveClaimBeforeExpiry(
        tx,
        claimId,
        StatusWaitlistClaim.ACEITO,
      );
      if (accepted !== 1) {
        throw new ConflictException('O prazo para aceitar esta vaga expirou.');
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

        const rejected = await this.transitionActiveClaimBeforeExpiry(
          tx,
          claimId,
          StatusWaitlistClaim.RECUSADO,
        );
        if (rejected !== 1) {
          throw new ConflictException('Claim expirado.');
        }

        await this.enqueueReleasedWindow(tx, {
          idempotencyKey: `claim-rejected:${claim.id}`,
          origin: OrigemWaitlistReoffer.CLAIM_RECUSADO,
          originId: claim.id,
          window: {
            barbeiroId: claim.barbeiroId,
            dateKey,
            horaInicio: claim.horaInicio,
            horaFim: claim.horaFim,
          },
        });

        return this.claimResponse({
          ...current,
          status: StatusWaitlistClaim.RECUSADO,
        });
      },
    );

    await this.processPendingReoffers();

    return result;
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

    const { updatedEntry, invalidatedClaims } = await this.prisma.$transaction(
      async (tx: WaitlistDbClient) => {
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

        const invalidatedClaims = await tx.$queryRaw<
          Array<{
            id: number;
            barbeiroId: number;
            data: Date;
            horaInicio: string;
            horaFim: string;
            status: StatusWaitlistClaim;
          }>
        >`
          WITH transition_time AS MATERIALIZED (
            SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"
          )
          UPDATE "WaitlistClaim" AS claim
          SET
            "status" = CASE
              WHEN claim."expiraEm" > transition_time."now"
                THEN ${StatusWaitlistClaim.RECUSADO}::"StatusWaitlistClaim"
              ELSE ${StatusWaitlistClaim.EXPIRADO}::"StatusWaitlistClaim"
            END,
            "dataAtualizacao" = transition_time."now"
          FROM transition_time
          WHERE claim."listaEsperaId" = ${waitlistId}
            AND claim."status" = ${StatusWaitlistClaim.ATIVO}::"StatusWaitlistClaim"
          RETURNING
            claim."id",
            claim."barbeiroId",
            claim."data",
            claim."horaInicio",
            claim."horaFim",
            claim."status"
        `;

        const queuedWindows = new Set<string>();
        for (const claim of invalidatedClaims) {
          const dateKey = claim.data.toISOString().slice(0, 10);
          const windowKey = [
            claim.barbeiroId,
            dateKey,
            claim.horaInicio,
            claim.horaFim,
          ].join(':');
          if (queuedWindows.has(windowKey)) {
            continue;
          }
          queuedWindows.add(windowKey);

          await this.enqueueReleasedWindow(tx, {
            idempotencyKey: `entry-cancelled:${waitlistId}:${windowKey}`,
            origin: OrigemWaitlistReoffer.ENTRADA_CANCELADA,
            originId: waitlistId,
            window: {
              barbeiroId: claim.barbeiroId,
              dateKey,
              horaInicio: claim.horaInicio,
              horaFim: claim.horaFim,
            },
          });
        }

        return {
          updatedEntry: freshEntry,
          invalidatedClaims,
        };
      },
    );

    // O OUTBOX foi persistido junto com o cancelamento. O processamento imediato
    // preserva o comportamento atual; uma falha deixa a pendência para o scheduler.
    if (invalidatedClaims && invalidatedClaims.length > 0) {
      await this.processPendingReoffers();
    }

    return this.toResponse(updatedEntry);
  }

  /**
   * Processamento periódico de claims expirados (ETAPA 5B).
   *
   * 1. Serializa instâncias concorrentes com WAITLIST_EXPIRATION_LOCK_NS (namespace 6).
   * 2. Localiza claims com status ATIVO e expiraEm <= agora.
   * 3. Atualiza os claims e registra as janelas liberadas na OUTBOX na mesma transação.
   * 4. Processa as pendências persistidas; falhas ficam disponíveis para retry.
   */
  async processExpiredClaims(): Promise<{
    expiredCount: number;
    reofferedWindows: number;
  }> {
    const expiredWindows = await this.prisma.$transaction(async (tx) => {
      await acquireWaitlistExpirationLock(tx);

      const expiredClaims = await tx.$queryRaw<
        Array<{
          id: number;
          barbeiroId: number;
          data: Date;
          horaInicio: string;
          horaFim: string;
        }>
      >`
        WITH transition_time AS MATERIALIZED (
          SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"
        )
        UPDATE "WaitlistClaim" AS claim
        SET
          "status" = ${StatusWaitlistClaim.EXPIRADO}::"StatusWaitlistClaim",
          "dataAtualizacao" = transition_time."now"
        FROM transition_time
        WHERE claim."status" = ${StatusWaitlistClaim.ATIVO}::"StatusWaitlistClaim"
          AND claim."expiraEm" <= transition_time."now"
        RETURNING
          claim."id",
          claim."barbeiroId",
          claim."data",
          claim."horaInicio",
          claim."horaFim"
      `;

      const windowMap = new Map<
        string,
        {
          barbeiroId: number;
          dateKey: string;
          horaInicio: string;
          horaFim: string;
          representativeClaimId: number;
        }
      >();

      for (const claim of expiredClaims) {
        const dateKey = claim.data.toISOString().slice(0, 10);
        const windowKey = `${claim.barbeiroId}:${dateKey}:${claim.horaInicio}:${claim.horaFim}`;
        const existing = windowMap.get(windowKey);
        if (!existing) {
          windowMap.set(windowKey, {
            barbeiroId: claim.barbeiroId,
            dateKey,
            horaInicio: claim.horaInicio,
            horaFim: claim.horaFim,
            representativeClaimId: claim.id,
          });
        } else {
          existing.representativeClaimId = Math.min(
            existing.representativeClaimId,
            claim.id,
          );
        }
      }

      const windows = Array.from(windowMap.values());
      for (const { representativeClaimId, ...window } of windows) {
        await this.enqueueReleasedWindow(tx, {
          idempotencyKey: `claim-expired:${representativeClaimId}`,
          origin: OrigemWaitlistReoffer.CLAIM_EXPIRADO,
          originId: representativeClaimId,
          window,
        });
      }

      return windows;
    });

    // O scheduler chama este método mesmo sem novas expirações, permitindo
    // recuperar pendências persistidas por execuções anteriores.
    const processed = await this.processPendingReoffers();

    return {
      expiredCount: expiredWindows.length,
      reofferedWindows: processed.completedCount,
    };
  }
}
