import { NotFoundException } from '@nestjs/common';
import {
  StatusAgendamento,
  StatusListaEspera,
  StatusWaitlistClaim,
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
    barbeiro: { findUnique: jest.fn() },
    agendamento: { findMany: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockImplementation((query: TemplateStringsArray) => {
      const sql = query.join('');
      return Promise.resolve(
        sql.includes('FROM reminder_time')
          ? [
              {
                now: new Date('2099-05-20T12:00:00.000Z'),
                windowEnd: new Date('2099-05-20T13:00:00.000Z'),
              },
            ]
          : [],
      );
    }),
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
    service = new NotificationsService(prisma);
  });

  it('lista somente as próprias notificações em ordem recente', async () => {
    prisma.notificacao.findMany.mockResolvedValue([notification]);

    const result = await service.findMine(10);

    expect(prisma.notificacao.findMany).toHaveBeenCalledWith({
      where: { usuarioId: 10, limpa: false },
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
    expect(result[0]).toEqual(expect.objectContaining({ id: 1, claimId: 20 }));
    expect(result[0]).not.toHaveProperty('usuarioId');
  });

  it('conta somente notificações não lidas do usuário', async () => {
    prisma.notificacao.count.mockResolvedValue(3);

    await expect(service.unreadCount(10)).resolves.toEqual({ count: 3 });
    expect(prisma.notificacao.count).toHaveBeenCalledWith({
      where: { usuarioId: 10, lida: false, limpa: false },
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
      where: { id: 1, usuarioId: 10, lida: false, limpa: false },
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
      where: { id: 1, usuarioId: 10, lida: false, limpa: false },
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
      where: { usuarioId: 10, lida: false, limpa: false },
      data: { lida: true, dataLeitura: expect.any(Date) },
    });
  });

  it('cria oportunidade para o usuário correto e referencia o claim', async () => {
    const tx = buildPrismaMock();
    tx.cliente.findUnique.mockResolvedValue({ usuarioId: 10 });
    tx.notificacao.create.mockResolvedValue(notification);

    const result = await service.createWaitlistOpportunity(tx, 7, 20);

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

    const result = await service.createAppointmentConfirmed(tx, 7, 77);

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

    const result = await service.createAppointmentCancelled(tx, 7, 77);

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

  it('cria confirmação para o barbeiro correto e referencia o agendamento', async () => {
    const tx = buildPrismaMock();
    tx.barbeiro.findUnique.mockResolvedValue({ usuarioId: 25 });
    tx.notificacao.create.mockResolvedValue({
      ...notification,
      id: 4,
      usuarioId: 25,
      claimId: null,
      agendamentoId: 88,
      tipo: TipoNotificacao.AGENDAMENTO,
      titulo: 'Novo agendamento',
      mensagem: 'Você tem um novo agendamento.',
    });

    const result = await service.createAppointmentConfirmedForBarber(tx, 5, 88);

    expect(tx.barbeiro.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { usuarioId: true },
    });
    expect(tx.notificacao.create).toHaveBeenCalledWith({
      data: {
        usuarioId: 25,
        agendamentoId: 88,
        tipo: TipoNotificacao.AGENDAMENTO,
        titulo: 'Novo agendamento',
        mensagem: 'Você tem um novo agendamento.',
        lida: false,
      },
    });
    expect(result.agendamentoId).toBe(88);
    expect(result).not.toHaveProperty('usuarioId');
  });

  it('cria cancelamento para o barbeiro correto e referencia o agendamento', async () => {
    const tx = buildPrismaMock();
    tx.barbeiro.findUnique.mockResolvedValue({ usuarioId: 25 });
    tx.notificacao.create.mockResolvedValue({
      ...notification,
      id: 5,
      usuarioId: 25,
      claimId: null,
      agendamentoId: 88,
      tipo: TipoNotificacao.CANCELAMENTO,
      titulo: 'Agendamento cancelado',
      mensagem: 'Um agendamento foi cancelado.',
    });

    const result = await service.createAppointmentCancelledForBarber(tx, 5, 88);

    expect(tx.barbeiro.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { usuarioId: true },
    });
    expect(tx.notificacao.create).toHaveBeenCalledWith({
      data: {
        usuarioId: 25,
        agendamentoId: 88,
        tipo: TipoNotificacao.CANCELAMENTO,
        titulo: 'Agendamento cancelado',
        mensagem: 'Um agendamento foi cancelado.',
        lida: false,
      },
    });
    expect(result.agendamentoId).toBe(88);
    expect(result).not.toHaveProperty('usuarioId');
  });

  it('lança 404 se o barbeiro não existir ao criar notificação para o barbeiro', async () => {
    const tx = buildPrismaMock();
    tx.barbeiro.findUnique.mockResolvedValue(null);

    await expect(
      service.createAppointmentConfirmedForBarber(tx, 999, 88),
    ).rejects.toThrow(new NotFoundException('Barbeiro não encontrado.'));
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

      await service.processAppointmentReminders();

      expect(prisma.$queryRaw.mock.calls[0][0].join(' ')).toContain(
        'clock_timestamp()',
      );

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

      const result = await service.processAppointmentReminders();

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

      const result = await service.processAppointmentReminders();

      expect(prisma.notificacao.create).not.toHaveBeenCalled();
      expect(result).toEqual({ created: 0 });
    });

    it('vários elegíveis cria um lembrete para cada', async () => {
      prisma.agendamento.findMany.mockResolvedValue([
        { id: 88, cliente: { usuarioId: 10 } },
        { id: 89, cliente: { usuarioId: 11 } },
      ]);

      const result = await service.processAppointmentReminders();

      expect(prisma.notificacao.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ created: 2 });
    });

    it('usa a referência temporal obtida do PostgreSQL', async () => {
      prisma.agendamento.findMany.mockResolvedValue([]);

      await service.processAppointmentReminders();

      const where = prisma.agendamento.findMany.mock.calls[0][0].where;
      expect(where.horaInicio).toEqual({ gt: base, lte: windowEnd });
    });

    it('mantém a janela do PostgreSQL mesmo com o relógio da aplicação adiantado ou atrasado', async () => {
      prisma.agendamento.findMany.mockResolvedValue([]);
      jest.useFakeTimers().setSystemTime(new Date('2100-01-01T00:00:00.000Z'));

      try {
        await service.processAppointmentReminders();
        jest.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
        await service.processAppointmentReminders();

        const windows = prisma.agendamento.findMany.mock.calls.map(
          (call: unknown[]) =>
            (call[0] as { where: { horaInicio: unknown } }).where.horaInicio,
        );
        expect(windows).toEqual([
          { gt: base, lte: windowEnd },
          { gt: base, lte: windowEnd },
        ]);
        expect(prisma.$queryRaw.mock.calls[0][0].join(' ')).toContain(
          'clock_timestamp()',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('falha na criação propaga erro -> transação é revertida (sem órfãs)', async () => {
      prisma.agendamento.findMany.mockResolvedValue([
        { id: 88, cliente: { usuarioId: 10 } },
      ]);
      prisma.notificacao.create.mockRejectedValue(
        new Error('falha no lembrete'),
      );

      await expect(service.processAppointmentReminders()).rejects.toThrow(
        'falha no lembrete',
      );
    });
  });

  describe('estado do claim nas notificações', () => {
    it('usa o status vigente no banco apesar do relógio adiantado da aplicação', async () => {
      const expiraEm = new Date('2099-01-02T00:10:00.000Z');
      const notifComClaim = {
        ...notification,
        claim: {
          id: 20,
          status: 'ATIVO',
          expiraEm,
        },
      };

      prisma.notificacao.findMany.mockResolvedValue([notifComClaim]);
      prisma.$queryRaw.mockResolvedValue([
        { id: 20, status: StatusWaitlistClaim.ATIVO },
      ]);

      jest.useFakeTimers().setSystemTime(new Date('2100-01-01T00:00:00.000Z'));
      try {
        const result = await service.findMine(10);

        expect(result[0].claimStatus).toBe(StatusWaitlistClaim.ATIVO);
        expect(result[0].claimExpiraEm).toEqual(expiraEm);
        expect(prisma.$queryRaw.mock.calls[0][0].join(' ')).toContain(
          'clock_timestamp() AT TIME ZONE',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('projeta claim expirado pelo relógio do banco apesar do relógio atrasado da aplicação', async () => {
      const expiraPassado = new Date(Date.now() - 5 * 60 * 1000); // 5 min atrás
      const notifComClaimVencido = {
        ...notification,
        claim: {
          id: 20,
          status: 'ATIVO',
          expiraEm: expiraPassado,
        },
      };

      prisma.notificacao.findMany.mockResolvedValue([notifComClaimVencido]);
      prisma.$queryRaw.mockResolvedValue([
        { id: 20, status: StatusWaitlistClaim.EXPIRADO },
      ]);

      jest.useFakeTimers().setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
      try {
        const result = await service.findMine(10);

        expect(result[0].claimStatus).toBe(StatusWaitlistClaim.EXPIRADO);
        expect(result[0].claimExpiraEm).toEqual(expiraPassado);
        const query = prisma.$queryRaw.mock.calls[0][0].join(' ');
        expect(query).toContain('"expiraEm" <=');
        expect(query).toContain('clock_timestamp() AT TIME ZONE');
      } finally {
        jest.useRealTimers();
      }
    });

    it('não inclui claimStatus nem claimExpiraEm se a notificação não possui claim relacionado', async () => {
      const notifSemClaim = {
        ...notification,
        claimId: null,
        claim: null,
      };

      prisma.notificacao.findMany.mockResolvedValue([notifSemClaim]);

      const result = await service.findMine(10);

      expect(result[0]).not.toHaveProperty('claimStatus');
      expect(result[0]).not.toHaveProperty('claimExpiraEm');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('limpar notificações (soft-delete)', () => {
    it('notificação comum limpa normalmente marcando limpa: true e lida: true via updateMany', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        { id: 1, tipo: TipoNotificacao.AGENDAMENTO, claimId: null, claim: null },
        { id: 2, tipo: TipoNotificacao.CANCELAMENTO, claimId: null, claim: null },
        { id: 3, tipo: TipoNotificacao.LEMBRETE, claimId: null, claim: null },
        { id: 4, tipo: TipoNotificacao.AVISO, claimId: null, claim: null },
      ]);
      prisma.notificacao.updateMany.mockResolvedValue({ count: 4 });

      const result = await service.clearAll(10);

      expect(result).toEqual({ cleared: 4 });
      expect(prisma.notificacao.findMany).toHaveBeenCalledWith({
        where: { usuarioId: 10, limpa: false },
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
      expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2, 3, 4] }, usuarioId: 10, limpa: false },
        data: { limpa: true, lida: true },
      });
    });

    it('oportunidade ATIVA é preservada (não é limpa)', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        {
          id: 11,
          claimId: 99,
          tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
          claim: {
            status: StatusWaitlistClaim.ATIVO,
            listaEspera: {
              status: StatusListaEspera.ATIVA,
              cliente: { usuarioId: 10 },
            },
          },
        },
      ]);

      const result = await service.clearAll(10);

      expect(result).toEqual({ cleared: 0 });
      expect(prisma.notificacao.updateMany).not.toHaveBeenCalled();
    });

    it('oportunidade ACEITA e lista ATENDIDA é limpa normalmente', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        {
          id: 12,
          claimId: 120,
          tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
          claim: {
            status: StatusWaitlistClaim.ACEITO,
            listaEspera: {
              status: StatusListaEspera.ATENDIDA,
              cliente: { usuarioId: 10 },
            },
          },
        },
        {
          id: 13,
          claimId: 121,
          tipo: TipoNotificacao.LISTA_ESPERA,
          claim: {
            status: StatusWaitlistClaim.ACEITO,
            listaEspera: {
              status: StatusListaEspera.ATENDIDA,
              cliente: { usuarioId: 10 },
            },
          },
        },
      ]);
      prisma.notificacao.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.clearAll(10);

      expect(result).toEqual({ cleared: 2 });
      expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [12, 13] }, usuarioId: 10, limpa: false },
        data: { limpa: true, lida: true },
      });
    });

    it('oportunidade RECUSADA é preservada', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        {
          id: 14,
          claimId: 140,
          tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
          claim: {
            status: StatusWaitlistClaim.RECUSADO,
            listaEspera: {
              status: StatusListaEspera.ATIVA,
              cliente: { usuarioId: 10 },
            },
          },
        },
      ]);

      const result = await service.clearAll(10);

      expect(result).toEqual({ cleared: 0 });
      expect(prisma.notificacao.updateMany).not.toHaveBeenCalled();
    });

    it('oportunidade EXPIRADA é preservada', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        {
          id: 15,
          claimId: 150,
          tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
          claim: {
            status: StatusWaitlistClaim.EXPIRADO,
            listaEspera: {
              status: StatusListaEspera.EXPIRADA,
              cliente: { usuarioId: 10 },
            },
          },
        },
      ]);

      const result = await service.clearAll(10);

      expect(result).toEqual({ cleared: 0 });
      expect(prisma.notificacao.updateMany).not.toHaveBeenCalled();
    });

    it('notificação de lista de espera sem claimId é preservada', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        {
          id: 16,
          claimId: null,
          tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
          claim: null,
        },
        {
          id: 17,
          claimId: null,
          tipo: TipoNotificacao.LISTA_ESPERA,
          claim: null,
        },
      ]);

      const result = await service.clearAll(10);

      expect(result).toEqual({ cleared: 0 });
      expect(prisma.notificacao.updateMany).not.toHaveBeenCalled();
    });

    it('limpeza mista: limpa comuns e atendidas, mas preserva oportunidades pendentes/recusadas/expiradas', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        { id: 101, claimId: null, tipo: TipoNotificacao.AGENDAMENTO, claim: null },
        {
          id: 102,
          claimId: 1020,
          tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
          claim: {
            status: StatusWaitlistClaim.ATIVO,
            listaEspera: {
              status: StatusListaEspera.ATIVA,
              cliente: { usuarioId: 10 },
            },
          },
        },
        {
          id: 103,
          claimId: 1030,
          tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
          claim: {
            status: StatusWaitlistClaim.ACEITO,
            listaEspera: {
              status: StatusListaEspera.ATENDIDA,
              cliente: { usuarioId: 10 },
            },
          },
        },
        {
          id: 104,
          claimId: 1040,
          tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
          claim: {
            status: StatusWaitlistClaim.RECUSADO,
            listaEspera: {
              status: StatusListaEspera.ATIVA,
              cliente: { usuarioId: 10 },
            },
          },
        },
      ]);
      prisma.notificacao.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.clearAll(10);

      expect(result).toEqual({ cleared: 2 });
      expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [101, 103] }, usuarioId: 10, limpa: false },
        data: { limpa: true, lida: true },
      });
    });

    it('não confunde lida com atendida (notificação WAITLIST_OPPORTUNITY lida mas com claim ATIVO permanece)', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        {
          id: 201,
          claimId: 2010,
          tipo: TipoNotificacao.WAITLIST_OPPORTUNITY,
          claim: {
            status: StatusWaitlistClaim.ATIVO,
            listaEspera: {
              status: StatusListaEspera.ATIVA,
              cliente: { usuarioId: 10 },
            },
          },
        },
      ]);

      const result = await service.clearAll(10);

      expect(result).toEqual({ cleared: 0 });
      expect(prisma.notificacao.updateMany).not.toHaveBeenCalled();
    });

    it('limpar notificações do cliente (usuarioId 10) não afeta as do barbeiro (isolamento entre usuários)', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        { id: 1, claimId: null, tipo: TipoNotificacao.AGENDAMENTO, claim: null },
      ]);
      prisma.notificacao.updateMany.mockResolvedValue({ count: 1 });

      await service.clearAll(10);

      expect(prisma.notificacao.findMany).toHaveBeenCalledWith({
        where: { usuarioId: 10, limpa: false },
        select: expect.any(Object),
      });
      expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] }, usuarioId: 10, limpa: false },
        data: { limpa: true, lida: true },
      });
    });

    it('limpar notificações do barbeiro (usuarioId 20) não afeta as do cliente (isolamento entre usuários)', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        { id: 2, claimId: null, tipo: TipoNotificacao.AGENDAMENTO, claim: null },
      ]);
      prisma.notificacao.updateMany.mockResolvedValue({ count: 1 });

      await service.clearAll(20);

      expect(prisma.notificacao.findMany).toHaveBeenCalledWith({
        where: { usuarioId: 20, limpa: false },
        select: expect.any(Object),
      });
      expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [2] }, usuarioId: 20, limpa: false },
        data: { limpa: true, lida: true },
      });
    });

    it('preserva os registros fisicamente no banco (não executa delete físico)', async () => {
      prisma.notificacao.findMany.mockResolvedValue([
        { id: 1, claimId: null, tipo: TipoNotificacao.AGENDAMENTO, claim: null },
      ]);
      prisma.notificacao.updateMany.mockResolvedValue({ count: 1 });
      const deleteMock = jest.fn();
      const deleteManyMock = jest.fn();
      prisma.notificacao.delete = deleteMock;
      prisma.notificacao.deleteMany = deleteManyMock;

      await service.clearAll(10);

      expect(deleteMock).not.toHaveBeenCalled();
      expect(deleteManyMock).not.toHaveBeenCalled();
    });

    it('findMine filtra notificações limpas garantindo que não reapareçam após atualizar', async () => {
      prisma.notificacao.findMany.mockResolvedValue([]);

      await service.findMine(10);

      expect(prisma.notificacao.findMany).toHaveBeenCalledWith({
        where: { usuarioId: 10, limpa: false },
        include: expect.any(Object),
        orderBy: expect.any(Array),
      });
    });

    it('unreadCount desconsidera notificações limpas garantindo contador correto', async () => {
      prisma.notificacao.count.mockResolvedValue(0);

      await service.unreadCount(10);

      expect(prisma.notificacao.count).toHaveBeenCalledWith({
        where: { usuarioId: 10, lida: false, limpa: false },
      });
    });

    it('motor de lembretes não gera duplicata mesmo se a notificação anterior foi limpa', async () => {
      const base = new Date('2099-05-20T12:00:00.000Z');
      const windowEnd = new Date(base.getTime() + 60 * 60 * 1000);
      prisma.agendamento.findMany.mockResolvedValue([]);

      await service.processAppointmentReminders();

      // A cláusula busca agendamentos com `notificacoes: { none: { tipo: LEMBRETE } }`.
      // Como o registro físico permanece no banco (com limpa: true), o agendamento não é selecionado de novo.
      expect(prisma.agendamento.findMany).toHaveBeenCalledWith({
        where: {
          status: StatusAgendamento.CONFIRMADO,
          horaInicio: { gt: base, lte: windowEnd },
          notificacoes: { none: { tipo: TipoNotificacao.LEMBRETE } },
        },
        select: expect.any(Object),
        orderBy: expect.any(Object),
      });
      expect(prisma.notificacao.create).not.toHaveBeenCalled();
    });
  });
});
