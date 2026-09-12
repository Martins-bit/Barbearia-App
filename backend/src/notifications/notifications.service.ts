import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import {
  StatusAgendamento,
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
  agendamentoId?: number;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(notification: any): NotificationResponse {
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
      ...(notification.agendamentoId !== null &&
      notification.agendamentoId !== undefined
        ? { agendamentoId: notification.agendamentoId }
        : {}),
    };
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
   * Motor de lembretes (ETAPA 6H). Seleciona agendamentos CONFIRMADO cujo
   * horaInicio está na janela (now, now + 1h] e cria UMA notificação
   * LEMBRETE por agendamento. Sem endpoint público e, nesta etapa, ainda SEM
   * scheduler automático (execução periódica será etapa posterior).
   *
   * Idempotência: seleção + criação ocorrem em UMA transação serializada pelo
   * advisory lock de lembretes; agendamentos que já possuem notificação
   * LEMBRETE ficam fora da seleção (`notificacoes.none`). A comparação de
   * horaInicio usa os instantes UTC persistidos; a timezone America/Sao_Paulo
   * permanece responsabilidade das convenções de gravação (tz.util).
   * Status CANCELADO/CONCLUIDO/NAO_COMPARECEU e horários após o início nunca
   * são selecionados.
   */
  async processAppointmentReminders(
    now: Date = new Date(),
  ): Promise<{ created: number }> {
    const windowEnd = new Date(
      now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000,
    );

    return this.prisma.$transaction(async (tx) => {
      await acquireReminderLock(tx);

      const appointments = await tx.agendamento.findMany({
        where: {
          status: StatusAgendamento.CONFIRMADO,
          horaInicio: { gt: now, lte: windowEnd },
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
      where: { usuarioId: userId },
      orderBy: [{ dataCriacao: 'desc' }, { id: 'desc' }],
    });
    return notifications.map((notification) => this.toResponse(notification));
  }

  async unreadCount(userId: number): Promise<{ count: number }> {
    const count = await this.prisma.notificacao.count({
      where: { usuarioId: userId, lida: false },
    });
    return { count };
  }

  async markAsRead(userId: number, notificationId: number): Promise<NotificationResponse> {
    await this.prisma.notificacao.updateMany({
      where: { id: notificationId, usuarioId: userId, lida: false },
      data: { lida: true, dataLeitura: new Date() },
    });

    const notification = await this.prisma.notificacao.findFirst({
      where: { id: notificationId, usuarioId: userId },
    });
    if (!notification) {
      throw new NotFoundException('Notificação não encontrada.');
    }
    return this.toResponse(notification);
  }

  async markAllAsRead(userId: number): Promise<{ updated: number }> {
    const result = await this.prisma.notificacao.updateMany({
      where: { usuarioId: userId, lida: false },
      data: { lida: true, dataLeitura: new Date() },
    });
    return { updated: result.count };
  }
}