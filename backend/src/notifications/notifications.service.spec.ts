import { NotFoundException } from '@nestjs/common';
import { TipoNotificacao } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

function buildPrismaMock() {
  return {
    notificacao: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    cliente: { findUnique: jest.fn() },
  };
}

describe('NotificationsService', () => {
  let prisma: any;
  let service: NotificationsService;

  const notification = {
    id: 1,
    usuarioId: 10,
    claimId: 20,
    tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
    titulo: 'Novo horário disponível',
    mensagem: 'Um horário ficou disponível para o serviço solicitado.',
    lida: false,
    dataCriacao: new Date('2099-01-02T00:00:00.000Z'),
    dataLeitura: null,
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  it('lista somente as próprias notificações em ordem recente', async () => {
    prisma.notificacao.findMany.mockResolvedValue([notification]);

    const result = await service.findMine(10);

    expect(prisma.notificacao.findMany).toHaveBeenCalledWith({
      where: { usuarioId: 10 },
      orderBy: [{ dataCriacao: 'desc' }, { id: 'desc' }],
    });
    expect(result[0]).toEqual(expect.objectContaining({ id: 1, claimId: 20 }));
    expect(result[0]).not.toHaveProperty('usuarioId');
  });

  it('conta somente notificações não lidas do usuário', async () => {
    prisma.notificacao.count.mockResolvedValue(3);

    await expect(service.unreadCount(10)).resolves.toEqual({ count: 3 });
    expect(prisma.notificacao.count).toHaveBeenCalledWith({
      where: { usuarioId: 10, lida: false },
    });
  });

  it('marca a própria notificação como lida com data de leitura', async () => {
    prisma.notificacao.updateMany.mockResolvedValue({ count: 1 });
    prisma.notificacao.findFirst.mockResolvedValue({
      ...notification,
      lida: true,
      dataLeitura: new Date(),
    });

    const result = await service.markAsRead(10, 1);

    expect(result.lida).toBe(true);
    expect(result.dataLeitura).toBeInstanceOf(Date);
    expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
      where: { id: 1, usuarioId: 10, lida: false },
      data: { lida: true, dataLeitura: expect.any(Date) },
    });
  });

  it('retorna a leitura existente sem alterar dataLeitura', async () => {
    const firstReadAt = new Date('2099-01-03T10:00:00.000Z');
    prisma.notificacao.updateMany.mockResolvedValue({ count: 0 });
    prisma.notificacao.findFirst.mockResolvedValue({
      ...notification,
      lida: true,
      dataLeitura: firstReadAt,
    });

    const result = await service.markAsRead(10, 1);

    expect(result.lida).toBe(true);
    expect(result.dataLeitura).toBe(firstReadAt);
    expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
      where: { id: 1, usuarioId: 10, lida: false },
      data: { lida: true, dataLeitura: expect.any(Date) },
    });
  });

  it('retorna 404 para notificação inexistente ou de outro usuário', async () => {
    prisma.notificacao.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.markAsRead(10, 99)).rejects.toThrow(
      new NotFoundException('Notificação não encontrada.'),
    );
  });

  it('marca todas as próprias notificações não lidas', async () => {
    prisma.notificacao.updateMany.mockResolvedValue({ count: 2 });

    await expect(service.markAllAsRead(10)).resolves.toEqual({ updated: 2 });
    expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: 10, lida: false },
      data: { lida: true, dataLeitura: expect.any(Date) },
    });
  });

  it('cria oportunidade para o usuário correto e referencia o claim', async () => {
    const tx = buildPrismaMock();
    tx.cliente.findUnique.mockResolvedValue({ usuarioId: 10 });
    tx.notificacao.create.mockResolvedValue(notification);

    const result = await service.createWaitlistOpportunity(tx as any, 7, 20);

    expect(tx.notificacao.create).toHaveBeenCalledWith({
      data: {
        usuarioId: 10,
        claimId: 20,
        tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
        titulo: 'Novo horário disponível',
        mensagem: 'Um horário ficou disponível para o serviço solicitado.',
        lida: false,
      },
    });
    expect(result.claimId).toBe(20);
  });

  it('cria confirmação para o usuário correto e referencia o agendamento', async () => {
    const tx = buildPrismaMock();
    tx.cliente.findUnique.mockResolvedValue({ usuarioId: 10 });
    tx.notificacao.create.mockResolvedValue({
      ...notification,
      id: 2,
      claimId: null,
      agendamentoId: 77,
      tipo: TipoNotificacao.AGENDAMENTO,
      titulo: 'Agendamento confirmado',
      mensagem: 'Seu agendamento foi confirmado.',
    });

    const result = await service.createAppointmentConfirmed(tx as any, 7, 77);

    expect(tx.cliente.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { usuarioId: true },
    });
    expect(tx.notificacao.create).toHaveBeenCalledWith({
      data: {
        usuarioId: 10,
        agendamentoId: 77,
        tipo: TipoNotificacao.AGENDAMENTO,
        titulo: 'Agendamento confirmado',
        mensagem: 'Seu agendamento foi confirmado.',
        lida: false,
      },
    });
    expect(result.agendamentoId).toBe(77);
    expect(result).not.toHaveProperty('usuarioId');
    expect(result).not.toHaveProperty('claimId');
  });

  it('cria cancelamento para o usuário correto e referencia o agendamento', async () => {
    const tx = buildPrismaMock();
    tx.cliente.findUnique.mockResolvedValue({ usuarioId: 10 });
    tx.notificacao.create.mockResolvedValue({
      ...notification,
      id: 3,
      claimId: null,
      agendamentoId: 77,
      tipo: TipoNotificacao.CANCELAMENTO,
      titulo: 'Agendamento cancelado',
      mensagem: 'Seu agendamento foi cancelado.',
    });

    const result = await service.createAppointmentCancelled(tx as any, 7, 77);

    expect(tx.notificacao.create).toHaveBeenCalledWith({
      data: {
        usuarioId: 10,
        agendamentoId: 77,
        tipo: TipoNotificacao.CANCELAMENTO,
        titulo: 'Agendamento cancelado',
        mensagem: 'Seu agendamento foi cancelado.',
        lida: false,
      },
    });
    expect(result.agendamentoId).toBe(77);
    expect(result).not.toHaveProperty('usuarioId');
  });

  it('lista não expõe usuarioId nem agendamentoId quando não há vínculo', async () => {
    prisma.notificacao.findMany.mockResolvedValue([notification]);

    const result = await service.findMine(10);

    expect(result[0]).not.toHaveProperty('usuarioId');
    expect(result[0]).not.toHaveProperty('agendamentoId');
  });
});