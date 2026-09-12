import { NotFoundException } from '@nestjs/common';
import {
  StatusAgendamento,
  TipoNotificacao,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

function buildPrismaMock() {
  const prismaMock: any = {
    notificacao: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    cliente: { findUnique: jest.fn() },
    agendamento: { findMany: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  prismaMock.$transaction = jest.fn(async (callback: any) =>
    callback(prismaMock),
  );
  return prismaMock;
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

  describe('motor de lembretes (ETAPA 6H)', () => {
    const base = new Date('2099-05-20T12:00:00.000Z');
    const windowEnd = new Date(base.getTime() + 60 * 60 * 1000);

    it('consulta somente CONFIRMADO na janela (now, now+1h] e sem LEMBRETE anterior', async () => {
      prisma.agendamento.findMany.mockResolvedValue([]);

      await service.processAppointmentReminders(base);

      // lock transacional de lembretes adquirido na transação
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(prisma.agendamento.findMany).toHaveBeenCalledWith({
        where: {
          status: StatusAgendamento.CONFIRMADO,
          horaInicio: { gt: base, lte: windowEnd },
          notificacoes: { none: { tipo: TipoNotificacao.LEMBRETE } },
        },
        select: { id: true, cliente: { select: { usuarioId: true } } },
        orderBy: { horaInicio: 'asc' },
      });
      expect(prisma.notificacao.create).not.toHaveBeenCalled();
    });

    it('CONFIRMADO dentro da janela cria 1 LEMBRETE com usuarioId e agendamentoId corretos', async () => {
      prisma.agendamento.findMany.mockResolvedValue([
        { id: 88, cliente: { usuarioId: 10 } },
      ]);

      const result = await service.processAppointmentReminders(base);

      expect(prisma.notificacao.create).toHaveBeenCalledTimes(1);
      expect(prisma.notificacao.create).toHaveBeenCalledWith({
        data: {
          usuarioId: 10,
          agendamentoId: 88,
          tipo: TipoNotificacao.LEMBRETE,
          titulo: 'Lembrete de agendamento',
          mensagem: 'Seu agendamento começa em aproximadamente 1 hora.',
          lida: false,
        },
      });
      expect(result).toEqual({ created: 1 });
    });

    it('sem elegíveis (fora da janela) não cria nada', async () => {
      prisma.agendamento.findMany.mockResolvedValue([]);

      const result = await service.processAppointmentReminders(base);

      expect(prisma.notificacao.create).not.toHaveBeenCalled();
      expect(result).toEqual({ created: 0 });
    });

    it('vários elegíveis cria um lembrete para cada', async () => {
      prisma.agendamento.findMany.mockResolvedValue([
        { id: 88, cliente: { usuarioId: 10 } },
        { id: 89, cliente: { usuarioId: 11 } },
      ]);

      const result = await service.processAppointmentReminders(base);

      expect(prisma.notificacao.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ created: 2 });
    });

    it('usa o instante atual quando now não é informado', async () => {
      prisma.agendamento.findMany.mockResolvedValue([]);
      const before = Date.now();

      await service.processAppointmentReminders();

      const where = prisma.agendamento.findMany.mock.calls[0][0].where;
      expect(where.horaInicio.gt.getTime()).toBeGreaterThanOrEqual(before);
      expect(where.horaInicio.lte.getTime()).toBeGreaterThan(before);
    });

    it('falha na criação propaga erro -> transação é revertida (sem órfãs)', async () => {
      prisma.agendamento.findMany.mockResolvedValue([
        { id: 88, cliente: { usuarioId: 10 } },
      ]);
      prisma.notificacao.create.mockRejectedValue(
        new Error('falha no lembrete'),
      );

      await expect(service.processAppointmentReminders(base)).rejects.toThrow(
        'falha no lembrete',
      );
    });
  });
});