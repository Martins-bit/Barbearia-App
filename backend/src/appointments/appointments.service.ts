import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  OrigemWaitlistReoffer,
  StatusAgendamento,
  StatusWaitlistClaim,
} from '../generated/prisma/enums';
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
import { NotificationsService } from '../notifications/notifications.service';
import type {
  EnqueueWaitlistReoffer,
  WaitlistReofferOutboxService,
} from '../waitlist/waitlist-reoffer-outbox.service';

/**
 * Lock de CLIENTE (namespace 2 — ver schedule.service.ts). SEMPRE adquirido
 * ANTES do lock do BARBEIRO: ordem determinística, sem risco de deadlock.
 */
const CLIENT_LOCK_NS = CALENDAR_LOCK_NS_CLIENTE;

export interface ConfirmedAppointmentInput {
  clienteId: number;
  barbeiroId: number;
  servicoId: number;
  data: string;
  horaInicio: string;
  horaFim?: string;
  observacoes?: string | null;
  claimId?: number;
}

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
  cliente: { id: number; usuarioId?: number; usuario: { nome: string } };
}

export async function acquireClienteLock(
  client: ScheduleDbClient,
  clienteId: number,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(
    ${CLIENT_LOCK_NS}::int,
    ${clienteId}::int
  )`;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
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

  private async enqueueWaitlistOpportunity(
    tx: Prisma.TransactionClient,
    row: {
      barbeiroId: number;
      data: Date;
      horaInicio: Date;
      horaFim: Date;
    },
    appointmentId: number,
  ): Promise<void> {
    const event: EnqueueWaitlistReoffer = {
      idempotencyKey: `appointment-cancelled:${appointmentId}`,
      origin: OrigemWaitlistReoffer.AGENDAMENTO_CANCELADO,
      originId: appointmentId,
      window: {
        barbeiroId: row.barbeiroId,
        dateKey: dateKeyFromUtcMidnight(row.data),
        horaInicio: formatLocalHHmm(row.horaInicio),
        horaFim: formatLocalHHmm(row.horaFim),
      },
    };
    await this.getReofferOutboxService().enqueue(tx, event);
  }

  private async dispatchWaitlistOpportunities(): Promise<void> {
    const outboxService = this.moduleRef?.get<WaitlistReofferOutboxService>(
      'WAITLIST_REOFFER_OUTBOX_SERVICE',
      { strict: false },
    );
    if (!outboxService) {
      this.logger.error(
        'Serviço OUTBOX de reofertas indisponível; pendências aguardam o scheduler.',
      );
      return;
    }

    try {
      await outboxService.processPendingReoffers();
    } catch {
      this.logger.error(
        'Falha no processamento imediato do OUTBOX de reofertas.',
      );
    }
  }

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
  async createConfirmedForClient(
    tx: ScheduleDbClient,
    input: ConfirmedAppointmentInput,
  ): Promise<AppointmentResponseDto> {
    const barber = await tx.barbeiro.findFirst({
      where: { id: input.barbeiroId, ativo: true },
      select: { id: true },
    });
    if (!barber) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    const service = await tx.servico.findFirst({
      where: { id: input.servicoId, barbeiroId: input.barbeiroId },
      select: { id: true, ativo: true, duracaoMinutos: true },
    });
    if (!service || !service.ativo) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    const startMinutes = this.parseHHmm(input.horaInicio);
    const startInstant = zonedWallTimeToUtc(input.data, input.horaInicio);
    const startEligibility = await tx.$queryRaw<Array<{ isFuture: boolean }>>`
      SELECT ${startInstant}::timestamptz > clock_timestamp() AS "isFuture"
    `;
    if (!startEligibility[0]) {
      throw new Error(
        'Consulta temporal do agendamento não retornou resultado.',
      );
    }
    if (!startEligibility[0].isFuture) {
      throw new BadRequestException(
        'Não é possível agendar um horário que já passou.',
      );
    }

    const endMinutes = startMinutes + service.duracaoMinutos;
    if (
      input.horaFim !== undefined &&
      input.horaFim !== this.minutesToHHmm(endMinutes)
    ) {
      throw new BadRequestException(
        'O horário final não corresponde à duração do serviço.',
      );
    }

    const { windows, busy } = await this.scheduleService.getDateSnapshot(
      tx,
      input.barbeiroId,
      input.data,
    );
    if (!windows.some((w) => startMinutes >= w.ini && endMinutes <= w.fim)) {
      throw new BadRequestException('Fora do horário de funcionamento.');
    }

    const overlaps = (interval: { ini: number; fim: number }): boolean =>
      startMinutes < interval.fim && interval.ini < endMinutes;
    if (busy.some((b) => b.origem === 'BLOQUEIO' && overlaps(b))) {
      throw new BadRequestException('Horário bloqueado.');
    }
    if (busy.some((b) => b.origem === 'AGENDAMENTO' && overlaps(b))) {
      throw new ConflictException('Horário não está mais disponível.');
    }

    const activeClaims = await tx.$queryRaw<
      Array<{ horaInicio: string; horaFim: string }>
    >`
        SELECT claim."horaInicio", claim."horaFim"
        FROM "WaitlistClaim" AS claim
        WHERE claim."barbeiroId" = ${input.barbeiroId}
          AND claim."data" = ${input.data}::date
          AND claim."status" = ${StatusWaitlistClaim.ATIVO}::"StatusWaitlistClaim"
          AND claim."expiraEm" > (clock_timestamp() AT TIME ZONE 'UTC')
          AND claim."id" IS DISTINCT FROM ${input.claimId ?? null}::int
      `;
    if (
      activeClaims.some((claim) =>
        overlaps({
          ini: localMinuteOfDay(
            zonedWallTimeToUtc(input.data, claim.horaInicio),
          ),
          fim: localMinuteOfDay(zonedWallTimeToUtc(input.data, claim.horaFim)),
        }),
      )
    ) {
      throw new ConflictException('Horário possui uma oportunidade ativa.');
    }

    const clientAppointments = await tx.agendamento.findMany({
      where: {
        clienteId: input.clienteId,
        data: prismaDateFilter(input.data),
        status: StatusAgendamento.CONFIRMADO,
      },
    });
    if (
      clientAppointments.some((appointment) =>
        overlaps({
          ini: localMinuteOfDay(appointment.horaInicio),
          fim: localMinuteOfDay(appointment.horaFim),
        }),
      )
    ) {
      throw new ConflictException(
        'Horário não está disponível para o cliente.',
      );
    }

    const created = await tx.agendamento.create({
      data: {
        clienteId: input.clienteId,
        barbeiroId: input.barbeiroId,
        servicoId: input.servicoId,
        data: prismaDateFilter(input.data),
        horaInicio: startInstant,
        horaFim: zonedWallTimeToUtc(input.data, this.minutesToHHmm(endMinutes)),
        status: StatusAgendamento.CONFIRMADO,
        observacoes: input.observacoes ?? null,
      },
    });

    // Notificação interna de confirmação na MESMA transação do agendamento
    // (appointment + notificação OU nenhum dos dois). Como este é o núcleo
    // compartilhado pela criação normal e pelo aceite de claim, exatamente
    // UMA notificação é gerada para o cliente e UMA para o barbeiro por
    // appointment CONFIRMADO criado.
    await this.notificationsService.createAppointmentConfirmed(
      tx,
      input.clienteId,
      created.id,
    );

    await this.notificationsService.createAppointmentConfirmedForBarber(
      tx,
      input.barbeiroId,
      created.id,
    );

    const row = await tx.agendamento.findUnique({
      where: { id: created.id },
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    return this.toResponse(row);
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
      await acquireClienteLock(tx, clienteId);
      await acquireCalendarLock(tx, dto.barbeiroId);
      return this.createConfirmedForClient(tx, {
        clienteId,
        barbeiroId: dto.barbeiroId,
        servicoId: dto.servicoId,
        data: dto.data,
        horaInicio: dto.horaInicio,
        observacoes: dto.observacoes,
      });
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
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
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
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
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
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
      },
    });

    return rows.map((row) => this.toResponse(row));
  }

  async cancelAppointment(
    userId: number,
    appointmentId: number,
  ): Promise<AppointmentResponseDto> {
    const cliente = await this.prisma.cliente.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (cliente) {
      const row = await this.prisma.agendamento.findUnique({
        where: { id: appointmentId },
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

      if (!row || row.clienteId !== cliente.id) {
        throw new NotFoundException('Agendamento não encontrado.');
      }

      if (row.status !== StatusAgendamento.CONFIRMADO) {
        throw new ConflictException('Status incompatível para cancelamento.');
      }

      // REGRA DO CLIENTE (decisão de projeto): só é permitido cancelar até o
      // dia CALENDÁRIO ANTERIOR ao agendamento, no fuso America/Sao_Paulo.
      //
      //   agendamento 20/08 → cancelar em 18/08 ou 19/08: permitido
      //   agendamento 20/08 → cancelar em 20/08 (ou depois): BLOQUEADO
      //
      // A data do agendamento é derivada do INSTANTE persistido (horaInicio),
      // nunca da coluna `data`, garantindo a comparação no fuso da barbearia.
      // BARBEIRO não passa por esta checagem (pode cancelar no mesmo dia).
      // Transição + notificação na MESMA transação (sem nested transaction):
      // ou ambas ocorrem, ou nenhuma. O update condicional por status garante
      // que nova tentativa/corrida de cancelamento não gere notificação
      // duplicada (count === 0 → conflito, sem notificação).
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.$executeRaw`
          UPDATE "Agendamento"
          SET
            "status" = ${StatusAgendamento.CANCELADO}::"StatusAgendamento",
            "dataAtualizacao" = (clock_timestamp() AT TIME ZONE 'UTC')
          WHERE "id" = ${appointmentId}
            AND "clienteId" = ${cliente.id}
            AND "status" = ${StatusAgendamento.CONFIRMADO}::"StatusAgendamento"
            AND (
              "horaInicio" AT TIME ZONE 'UTC'
                AT TIME ZONE 'America/Sao_Paulo'
            )::date > (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date
        `;

        if (updated === 0) {
          const currentDay = await tx.$queryRaw<
            Array<{
              hojeKey: string;
              dataAgendamentoKey: string;
              status: StatusAgendamento;
              clienteId: number;
            }>
          >`
            SELECT to_char(
              (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
              'YYYY-MM-DD'
            ) AS "hojeKey",
            to_char(
              (
                "horaInicio" AT TIME ZONE 'UTC'
                  AT TIME ZONE 'America/Sao_Paulo'
              )::date,
              'YYYY-MM-DD'
            ) AS "dataAgendamentoKey",
            "status",
            "clienteId"
            FROM "Agendamento"
            WHERE "id" = ${appointmentId}
          `;
          if (!currentDay[0]) {
            throw new Error(
              'Consulta da data local do banco não retornou resultado.',
            );
          }
          if (
            currentDay[0].status === StatusAgendamento.CONFIRMADO &&
            currentDay[0].clienteId === cliente.id &&
            currentDay[0].dataAgendamentoKey <= currentDay[0].hojeKey
          ) {
            throw new BadRequestException(
              'Cliente só pode cancelar até o dia anterior ao agendamento.',
            );
          }
          throw new ConflictException(
            'Agendamento não pode mais ser cancelado.',
          );
        }

        await this.notificationsService.createAppointmentCancelled(
          tx,
          cliente.id,
          appointmentId,
        );

        await this.notificationsService.createAppointmentCancelledForBarber(
          tx,
          row.barbeiroId,
          appointmentId,
        );
        await this.enqueueWaitlistOpportunity(tx, row, appointmentId);
      });

      const refreshed = await this.prisma.agendamento.findUnique({
        where: { id: appointmentId },
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

      if (!refreshed) {
        throw new NotFoundException('Agendamento não encontrado.');
      }

      await this.dispatchWaitlistOpportunities();

      return this.toResponse(refreshed);
    }

    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (!barbeiro) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    const row = await this.prisma.agendamento.findUnique({
      where: { id: appointmentId },
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
      },
    });

    if (!row || row.barbeiroId !== barbeiro.id) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    if (row.status !== StatusAgendamento.CONFIRMADO) {
      throw new ConflictException('Status incompatível para cancelamento.');
    }

    // Mesma atomicidade do caminho do cliente: transição para CANCELADO +
    // notificação na mesma transação, sem duplicação em corrida.
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.agendamento.updateMany({
        where: {
          id: appointmentId,
          barbeiroId: barbeiro.id,
          status: StatusAgendamento.CONFIRMADO,
        },
        data: { status: StatusAgendamento.CANCELADO },
      });

      if (updated.count === 0) {
        throw new ConflictException('Agendamento não pode mais ser cancelado.');
      }

      await this.notificationsService.createAppointmentCancelled(
        tx,
        row.clienteId,
        appointmentId,
      );
      await this.enqueueWaitlistOpportunity(tx, row, appointmentId);
    });

    const refreshed = await this.prisma.agendamento.findUnique({
      where: { id: appointmentId },
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
      },
    });

    if (!refreshed) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    await this.dispatchWaitlistOpportunities();

    return this.toResponse(refreshed);
  }

  async completeAppointment(
    userId: number,
    appointmentId: number,
  ): Promise<AppointmentResponseDto> {
    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (!barbeiro) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    const row = await this.prisma.agendamento.findUnique({
      where: { id: appointmentId },
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
      },
    });

    if (!row || row.barbeiroId !== barbeiro.id) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    if (row.status !== StatusAgendamento.CONFIRMADO) {
      throw new ConflictException('Status incompatível para conclusão.');
    }

    const completionEligibility = await this.prisma.$queryRaw<
      Array<{ allowed: boolean }>
    >`
      SELECT ${row.horaFim}::timestamptz <= clock_timestamp() AS "allowed"
    `;
    if (!completionEligibility[0]) {
      throw new Error('Consulta temporal da conclusão não retornou resultado.');
    }
    if (!completionEligibility[0].allowed) {
      throw new BadRequestException(
        'Só é possível concluir após o fim do agendamento.',
      );
    }

    const updated = await this.prisma.agendamento.updateMany({
      where: {
        id: appointmentId,
        barbeiroId: barbeiro.id,
        status: StatusAgendamento.CONFIRMADO,
      },
      data: { status: StatusAgendamento.CONCLUIDO },
    });

    if (updated.count === 0) {
      throw new ConflictException(
        'Agendamento foi atualizado por outra operação.',
      );
    }

    const refreshed = await this.prisma.agendamento.findUnique({
      where: { id: appointmentId },
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
      },
    });

    if (!refreshed) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    return this.toResponse(refreshed);
  }

  async noShowAppointment(
    userId: number,
    appointmentId: number,
  ): Promise<AppointmentResponseDto> {
    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (!barbeiro) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    const row = await this.prisma.agendamento.findUnique({
      where: { id: appointmentId },
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
      },
    });

    if (!row || row.barbeiroId !== barbeiro.id) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    if (row.status !== StatusAgendamento.CONFIRMADO) {
      throw new ConflictException('Status incompatível para falta.');
    }

    const noShowEligibility = await this.prisma.$queryRaw<
      Array<{ allowed: boolean }>
    >`
      SELECT ${row.horaInicio}::timestamptz <= clock_timestamp() AS "allowed"
    `;
    if (!noShowEligibility[0]) {
      throw new Error('Consulta temporal da falta não retornou resultado.');
    }
    if (!noShowEligibility[0].allowed) {
      throw new BadRequestException(
        'Só é possível marcar falta após o início do agendamento.',
      );
    }

    const updated = await this.prisma.agendamento.updateMany({
      where: {
        id: appointmentId,
        barbeiroId: barbeiro.id,
        status: StatusAgendamento.CONFIRMADO,
      },
      data: { status: StatusAgendamento.NAO_COMPARECEU },
    });

    if (updated.count === 0) {
      throw new ConflictException(
        'Agendamento foi atualizado por outra operação.',
      );
    }

    const refreshed = await this.prisma.agendamento.findUnique({
      where: { id: appointmentId },
      include: {
        servico: { select: { id: true, nome: true, preco: true } },
        barbeiro: { select: { id: true, usuario: { select: { nome: true } } } },
        cliente: {
          select: {
            id: true,
            usuarioId: true,
            usuario: { select: { nome: true } },
          },
        },
      },
    });

    if (!refreshed) {
      throw new NotFoundException('Agendamento não encontrado.');
    }

    return this.toResponse(refreshed);
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
      cliente: {
        id: row.clienteId,
        ...(row.cliente.usuarioId !== undefined
          ? { usuarioId: row.cliente.usuarioId }
          : {}),
        nome: row.cliente.usuario.nome,
      },
    };
  }
}
