import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { TipoNotificacao } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationsDbClient = PrismaClient | Prisma.TransactionClient;

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