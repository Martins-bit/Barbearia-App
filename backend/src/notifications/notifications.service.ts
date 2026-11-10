import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import {
  StatusAgendamento,
  StatusListaEspera,
  StatusWaitlistClaim,
  TipoNotificacao,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationsDbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Lock de LEMBRETES (namespace 5 — ver schedule.service.ts/waitlist.service.ts).
 * Serializa execuções concorrentes do motor de lembretes dentro da MESMA
 * transação, tornando o check-then-create imune a corrida sem nova constraint
 * de banco (a alternativa seria índice único parcial, não modelável no Prisma).
 */
export const REMINDER_LOCK_NS = 5;

/** Janela do lembrete: aproximadamente 1 hora antes do horaInicio. */
const REMINDER_WINDOW_MINUTES = 60;

export async function acquireReminderLock(
  client: NotificationsDbClient,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(
    ${REMINDER_LOCK_NS}::int,
    0::int
  )`;
}

export interface NotificationResponse {
  id: number;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  lida: boolean;
  dataCriacao: Date;
  dataLeitura: Date | null;
  claimId?: number;
  claimStatus?: StatusWaitlistClaim;
  claimExpiraEm?: Date;
  agendamentoId?: number;
}

interface NotificationProjection {
  id: number;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  lida: boolean;
  dataCriacao: Date;
  dataLeitura?: Date | null;
  claimId?: number | null;
  claim?: {
    id: number;
    status: StatusWaitlistClaim;
    expiraEm: Date;
  } | null;
  agendamentoId?: number | null;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(
    notification: NotificationProjection,
    currentClaimStatuses?: Map<number, StatusWaitlistClaim>,
  ): NotificationResponse {
    let claimStatus: StatusWaitlistClaim | undefined = undefined;
    let claimExpiraEm: Date | undefined = undefined;

    if (notification.claim) {
      claimExpiraEm = notification.claim.expiraEm;
      claimStatus =
        currentClaimStatuses?.get(notification.claim.id) ??
        notification.claim.status;
    }

    return {
      id: notification.id,
      tipo: notification.tipo,
      titulo: notification.titulo,
      mensagem: notification.mensagem,
      lida: notification.lida,
      dataCriacao: notification.dataCriacao,
      dataLeitura: notification.dataLeitura ?? null,
      ...(notification.claimId !== null && notification.claimId !== undefined
        ? { claimId: notification.claimId }
        : {}),
      ...(claimStatus ? { claimStatus } : {}),
      ...(claimExpiraEm ? { claimExpiraEm } : {}),
      ...(notification.agendamentoId !== null &&
      notification.agendamentoId !== undefined
        ? { agendamentoId: notification.agendamentoId }
        : {}),
    };
  }

  private async getCurrentClaimStatuses(
    client: NotificationsDbClient,
    notifications: NotificationProjection[],
  ): Promise<Map<number, StatusWaitlistClaim>> {
    const activeClaimIds = Array.from(
      new Set(
        notifications.flatMap((notification) =>
          notification.claim?.status === StatusWaitlistClaim.ATIVO
            ? [notification.claim.id]
            : [],
        ),
      ),
    );
    if (activeClaimIds.length === 0) {
      return new Map();
    }

    const rows = await client.$queryRaw<
      Array<{ id: number; status: StatusWaitlistClaim }>
    >`
      SELECT
        claim."id",
        CASE
          WHEN claim."status" = ${StatusWaitlistClaim.ATIVO}::"StatusWaitlistClaim"
            AND claim."expiraEm" <= (clock_timestamp() AT TIME ZONE 'UTC')
            THEN ${StatusWaitlistClaim.EXPIRADO}::"StatusWaitlistClaim"
          ELSE claim."status"
        END AS "status"
      FROM "WaitlistClaim" AS claim
      WHERE claim."id" IN (${Prisma.join(activeClaimIds)})
    `;
    return new Map(rows.map(({ id, status }) => [id, status]));
  }

  /**
   * usuarioId é SEMPRE derivado no backend a partir do Cliente — nunca aceito
   * do frontend.
   */
  private async resolveUsuarioId(
    client: NotificationsDbClient,
    clienteId: number,
  ): Promise<number> {
    const cliente = await client.cliente.findUnique({
      where: { id: clienteId },
      select: { usuarioId: true },
    });
    if (!cliente) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    return cliente.usuarioId;
  }

  async createWaitlistOpportunity(
    client: NotificationsDbClient,
    clienteId: number,
    claimId: number,
  ): Promise<NotificationResponse> {
    const usuarioId = await this.resolveUsuarioId(client, clienteId);

    const notification = await client.notificacao.create({
      data: {
        usuarioId,
        claimId,
        tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
        titulo: 'Novo horário disponível',
        mensagem: 'Um horário ficou disponível para o serviço solicitado.',
        lida: false,
      },
    });

    return this.toResponse(notification);
  }

  async createAppointmentConfirmed(
    client: NotificationsDbClient,
    clienteId: number,
    agendamentoId: number,
  ): Promise<NotificationResponse> {
    const usuarioId = await this.resolveUsuarioId(client, clienteId);

    const notification = await client.notificacao.create({
      data: {
        usuarioId,
        agendamentoId,
        tipo: TipoNotificacao.AGENDAMENTO,
        titulo: 'Agendamento confirmado',
        mensagem: 'Seu agendamento foi confirmado.',
        lida: false,
      },
    });

    return this.toResponse(notification);
  }

  async createAppointmentCancelled(
    client: NotificationsDbClient,
    clienteId: number,
    agendamentoId: number,
  ): Promise<NotificationResponse> {
    const usuarioId = await this.resolveUsuarioId(client, clienteId);

    const notification = await client.notificacao.create({
      data: {
        usuarioId,
        agendamentoId,
        tipo: TipoNotificacao.CANCELAMENTO,
        titulo: 'Agendamento cancelado',
        mensagem: 'Seu agendamento foi cancelado.',
        lida: false,
      },
    });

    return this.toResponse(notification);
  }

  /**
   * usuarioId é SEMPRE derivado no backend a partir do Barbeiro — nunca aceito
   * do frontend.
   */
  private async resolveBarbeiroUsuarioId(
    client: NotificationsDbClient,
    barbeiroId: number,
  ): Promise<number> {
    const barbeiro = await client.barbeiro.findUnique({
      where: { id: barbeiroId },
      select: { usuarioId: true },
    });
    if (!barbeiro) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    return barbeiro.usuarioId;
  }

  async createAppointmentConfirmedForBarber(
    client: NotificationsDbClient,
    barbeiroId: number,
    agendamentoId: number,
  ): Promise<NotificationResponse> {
    const usuarioId = await this.resolveBarbeiroUsuarioId(client, barbeiroId);

    const notification = await client.notificacao.create({
      data: {
        usuarioId,
        agendamentoId,
        tipo: TipoNotificacao.AGENDAMENTO,
        titulo: 'Novo agendamento',
        mensagem: 'Você tem um novo agendamento.',
        lida: false,
      },
    });

    return this.toResponse(notification);
  }

  async createAppointmentCancelledForBarber(
    client: NotificationsDbClient,
    barbeiroId: number,
    agendamentoId: number,
  ): Promise<NotificationResponse> {
    const usuarioId = await this.resolveBarbeiroUsuarioId(client, barbeiroId);

    const notification = await client.notificacao.create({
      data: {
        usuarioId,
        agendamentoId,
        tipo: TipoNotificacao.CANCELAMENTO,
        titulo: 'Agendamento cancelado',
        mensagem: 'Um agendamento foi cancelado.',
        lida: false,
      },
    });

    return this.toResponse(notification);
  }

  /**
   * Motor de lembretes (ETAPA 6H). Seleciona agendamentos CONFIRMADO cujo
   * horaInicio está na janela (now, now + 1h] e cria UMA notificação
   * LEMBRETE por agendamento. Sem endpoint público; o scheduler periódico
   * delega a execução ao motor, que usa a referência temporal do PostgreSQL.
   *
   * Idempotência: seleção + criação ocorrem em UMA transação serializada pelo
   * advisory lock de lembretes; agendamentos que já possuem notificação
   * LEMBRETE ficam fora da seleção (`notificacoes.none`). A comparação de
   * horaInicio usa os instantes UTC persistidos; a timezone America/Sao_Paulo
   * permanece responsabilidade das convenções de gravação (tz.util).
   * Status CANCELADO/CONCLUIDO/NAO_COMPARECEU e horários após o início nunca
   * são selecionados.
   */
  async processAppointmentReminders(): Promise<{ created: number }> {
    return this.prisma.$transaction(async (tx) => {
      await acquireReminderLock(tx);

      const timeRows = await tx.$queryRaw<
        Array<{ now: Date; windowEnd: Date }>
      >`
        WITH reminder_time AS (
          SELECT clock_timestamp() AS "now"
        )
        SELECT
          "now",
          "now" + (${REMINDER_WINDOW_MINUTES} * INTERVAL '1 minute') AS "windowEnd"
        FROM reminder_time
      `;
      if (
        !timeRows[0] ||
        !(timeRows[0].now instanceof Date) ||
        !(timeRows[0].windowEnd instanceof Date)
      ) {
        throw new Error(
          'Consulta temporal dos lembretes não retornou valores válidos.',
        );
      }

      const appointments = await tx.agendamento.findMany({
        where: {
          status: StatusAgendamento.CONFIRMADO,
          horaInicio: { gt: timeRows[0].now, lte: timeRows[0].windowEnd },
          notificacoes: { none: { tipo: TipoNotificacao.LEMBRETE } },
        },
        select: { id: true, cliente: { select: { usuarioId: true } } },
        orderBy: { horaInicio: 'asc' },
      });

      for (const appointment of appointments) {
        await tx.notificacao.create({
          data: {
            usuarioId: appointment.cliente.usuarioId,
            agendamentoId: appointment.id,
            tipo: TipoNotificacao.LEMBRETE,
            titulo: 'Lembrete de agendamento',
            mensagem: 'Seu agendamento começa em aproximadamente 1 hora.',
            lida: false,
          },
        });
      }

      return { created: appointments.length };
    });
  }

  async findMine(userId: number): Promise<NotificationResponse[]> {
    const notifications = await this.prisma.notificacao.findMany({
      where: { usuarioId: userId, limpa: false },
      include: {
        claim: {
          select: {
            id: true,
            status: true,
            expiraEm: true,
          },
        },
      },
      orderBy: [{ dataCriacao: 'desc' }, { id: 'desc' }],
    });
    const currentClaimStatuses = await this.getCurrentClaimStatuses(
      this.prisma,
      notifications,
    );
    return notifications.map((notification) =>
      this.toResponse(notification, currentClaimStatuses),
    );
  }

  async unreadCount(userId: number): Promise<{ count: number }> {
    const count = await this.prisma.notificacao.count({
      where: { usuarioId: userId, lida: false, limpa: false },
    });
    return { count };
  }

  async markAsRead(
    userId: number,
    notificationId: number,
  ): Promise<NotificationResponse> {
    await this.prisma.notificacao.updateMany({
      where: {
        id: notificationId,
        usuarioId: userId,
        lida: false,
        limpa: false,
      },
      data: { lida: true, dataLeitura: new Date() },
    });

    const notification = await this.prisma.notificacao.findFirst({
      where: { id: notificationId, usuarioId: userId, limpa: false },
      include: {
        claim: {
          select: {
            id: true,
            status: true,
            expiraEm: true,
          },
        },
      },
    });
    if (!notification) {
      throw new NotFoundException('Notificação não encontrada.');
    }
    const currentClaimStatuses = await this.getCurrentClaimStatuses(
      this.prisma,
      [notification],
    );
    return this.toResponse(notification, currentClaimStatuses);
  }

  async markAllAsRead(userId: number): Promise<{ updated: number }> {
    const result = await this.prisma.notificacao.updateMany({
      where: { usuarioId: userId, lida: false, limpa: false },
      data: { lida: true, dataLeitura: new Date() },
    });
    return { updated: result.count };
  }

  private isClearableWaitlistNotification(
    notification: {
      tipo: TipoNotificacao;
      claimId?: number | null;
      claim?: {
        status: StatusWaitlistClaim;
        listaEspera?: {
          status?: StatusListaEspera | null;
          cliente?: {
            usuarioId?: number | null;
          } | null;
        } | null;
      } | null;
    },
    userId: number,
  ): boolean {
    const isWaitlist =
      notification.tipo === TipoNotificacao.WAITLIST_OPPORTUNITY ||
      notification.tipo === TipoNotificacao.LISTA_ESPERA;

    if (!isWaitlist) {
      return true;
    }

    if (
      notification.claimId === null ||
      notification.claimId === undefined ||
      !notification.claim ||
      !notification.claim.listaEspera ||
      !notification.claim.listaEspera.cliente ||
      notification.claim.listaEspera.cliente.usuarioId !== userId
    ) {
      return false;
    }

    const isClaimAccepted =
      notification.claim.status === StatusWaitlistClaim.ACEITO;
    const isEntryAttended =
      notification.claim.listaEspera.status === StatusListaEspera.ATENDIDA;

    return isClaimAccepted && isEntryAttended;
  }

  async clearAll(userId: number): Promise<{ cleared: number }> {
    const activeNotifications = await this.prisma.notificacao.findMany({
      where: { usuarioId: userId, limpa: false },
      select: {
        id: true,
        tipo: true,
        claimId: true,
        claim: {
          select: {
            status: true,
            listaEspera: {
              select: {
                status: true,
                cliente: {
                  select: {
                    usuarioId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const eligibleIds = activeNotifications
      .filter((n) => this.isClearableWaitlistNotification(n, userId))
      .map((n) => n.id);

    if (eligibleIds.length === 0) {
      return { cleared: 0 };
    }

    const result = await this.prisma.notificacao.updateMany({
      where: {
        id: { in: eligibleIds },
        usuarioId: userId,
        limpa: false,
      },
      data: { limpa: true, lida: true },
    });

    return { cleared: result.count };
  }
}
