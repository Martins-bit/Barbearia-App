import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  StatusAgendamento,
  StatusListaEspera,
  StatusWaitlistClaim,
} from '../generated/prisma/enums';
import { WaitlistService } from './waitlist.service';

function buildPrismaMock() {
  const listaEspera = {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const waitlistClaim = {
    findFirst: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  };
  const barbeiro = { findUnique: jest.fn() };
  const servico = { findFirst: jest.fn() };
  const agendamento = { findMany: jest.fn() };

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    listaEspera,
    waitlistClaim,
    barbeiro,
    servico,
    agendamento,
  };

  return {
    cliente: { findUnique: jest.fn() },
    barbeiro,
    servico,
    agendamento,
    listaEspera,
    waitlistClaim,
    $transaction: jest.fn(async (callback: any) => callback(tx)),
    $executeRaw: jest.fn().mockResolvedValue(undefined),
  };
}

describe('WaitlistService', () => {
  let prisma: any;
  let scheduleService: any;
  let appointmentsService: any;
  let service: WaitlistService;

  const validDto = {
    barbeiroId: 10,
    servicoId: 20,
    data: '2099-01-12',
    horaInicio: '10:00',
    horaFim: '10:30',
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    prisma.agendamento.findMany.mockResolvedValue([]);
    scheduleService = {
      getDateSnapshot: jest.fn().mockResolvedValue({
        windows: [{ ini: 0, fim: 24 * 60 }],
        busy: [],
      }),
    };
    appointmentsService = {
      createConfirmedForClient: jest.fn(),
    };
    service = new WaitlistService(
      prisma as unknown as PrismaService,
      scheduleService,
      appointmentsService,
    );
  });

  it('cria entrada ativa válida', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });
    prisma.listaEspera.findFirst.mockResolvedValue(null);
    prisma.listaEspera.create.mockResolvedValue({
      id: 7,
      clienteId: 99,
      barbeiroId: 10,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.create(1, validDto);

    expect(result.status).toBe(StatusListaEspera.ATIVA);
    expect(result.servicoId).toBe(20);
    expect(prisma.listaEspera.create).toHaveBeenCalled();
  });

  it('resolve cliente pelo usuario autenticado', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });
    prisma.listaEspera.findFirst.mockResolvedValue(null);
    prisma.listaEspera.create.mockResolvedValue({
      id: 8,
      clienteId: 99,
      barbeiroId: 10,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });

    await service.create(123, validDto);

    expect(prisma.cliente.findUnique).toHaveBeenCalledWith({
      where: { usuarioId: 123 },
      select: { id: true },
    });
  });

  it('rejeita barbeiro inexistente/inativo', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue(null);
    prisma.servico.findFirst.mockResolvedValue(null);

    await expect(service.create(1, validDto)).rejects.toThrow(
      new NotFoundException('Barbeiro não encontrado.'),
    );
  });

  it('rejeita serviço inexistente/inativo/de outro barbeiro', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: false,
      barbeiroId: 99,
      nome: 'Corte',
    });

    await expect(service.create(1, validDto)).rejects.toThrow(
      new NotFoundException('Serviço não encontrado.'),
    );
  });

  it('rejeita data no passado', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });

    await expect(
      service.create(1, { ...validDto, data: '2020-01-06' }),
    ).rejects.toThrow(new BadRequestException('Data inválida.'));
  });

  it('rejeita faixa inválida', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });

    await expect(
      service.create(1, { ...validDto, horaInicio: '10:30', horaFim: '10:00' }),
    ).rejects.toThrow(new BadRequestException('horaFim deve ser posterior a horaInicio.'));
  });

  it('rejeita duplicidade ativa do mesmo cliente, serviço e data', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });
    prisma.listaEspera.findFirst.mockResolvedValue({
      id: 1,
      clienteId: 99,
      barbeiroId: 10,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
    });

    await expect(service.create(1, validDto)).rejects.toThrow(
      new ConflictException('Já existe uma entrada ativa para este cliente, serviço e data.'),
    );
  });

  it('permite nova entrada após cancelamento', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });
    prisma.listaEspera.findFirst.mockResolvedValue(null);
    prisma.listaEspera.create.mockResolvedValue({
      id: 11,
      clienteId: 99,
      barbeiroId: 10,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.create(1, validDto);
    expect(result.status).toBe(StatusListaEspera.ATIVA);
  });

  it('lista somente as entradas do cliente autenticado', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.listaEspera.findMany.mockResolvedValue([
      {
        id: 1,
        clienteId: 99,
        servicoId: 20,
        dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
        status: StatusListaEspera.ATIVA,
        dataEntrada: new Date('2099-01-01T00:00:00.000Z'),
        dataAtualizacao: new Date('2099-01-02T00:00:00.000Z'),
        servico: { id: 20, nome: 'Corte', barbeiro: { id: 10, usuario: { nome: 'Barbeiro A' } } },
      },
    ]);

    const result = await service.findMyWaitlist(1);
    expect(result).toHaveLength(1);
    expect(result[0].clienteId).toBeUndefined();
  });

  describe('claimNextEligibleEntryForSlot', () => {
    const slot = {
      barbeiroId: 10,
      servicoId: 20,
      dateKey: '2099-01-12',
      horaInicio: '10:00',
      horaFim: '10:30',
    };

    beforeEach(() => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });
      prisma.agendamento.findMany.mockResolvedValue([]);
      prisma.waitlistClaim.findFirst.mockResolvedValue(null);
      scheduleService.getDateSnapshot.mockResolvedValue({
        windows: [{ ini: 0, fim: 24 * 60 }],
        busy: [],
      });
    });

    it('cria claim para o primeiro candidato FIFO e calcula TTL', async () => {
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 11,
          clienteId: 101,
          status: StatusListaEspera.ATIVA,
          dataEntrada: new Date('2098-01-01T00:00:00.000Z'),
          horaInicio: null,
          horaFim: null,
        },
        {
          id: 12,
          clienteId: 102,
          status: StatusListaEspera.ATIVA,
          dataEntrada: new Date('2098-01-02T00:00:00.000Z'),
          horaInicio: null,
          horaFim: null,
        },
      ]);
      const createdAt = new Date();
      prisma.waitlistClaim.create.mockResolvedValue({
        id: 50,
        listaEsperaId: 11,
        barbeiroId: 10,
        servicoId: 20,
        horaInicio: '10:00',
        horaFim: '10:30',
        status: StatusWaitlistClaim.ATIVO,
        expiraEm: new Date(createdAt.getTime() + 5 * 60 * 1000),
        dataCriacao: createdAt,
      });

      const result = await service.claimNextEligibleEntryForSlot(
        slot.barbeiroId,
        slot.servicoId,
        slot.dateKey,
        slot.horaInicio,
        slot.horaFim,
      );

      expect(result.listaEsperaId).toBe(11);
      expect(result.clienteId).toBeUndefined();
      expect(prisma.waitlistClaim.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            listaEsperaId: 11,
            status: StatusWaitlistClaim.ATIVO,
          }),
        }),
      );
      const expiresAt = prisma.waitlistClaim.create.mock.calls[0][0].data.expiraEm;
      expect(expiresAt.getTime() - createdAt.getTime()).toBeGreaterThanOrEqual(
        5 * 60 * 1000,
      );
      expect(expiresAt.getTime() - createdAt.getTime()).toBeLessThan(
        5 * 60 * 1000 + 1000,
      );
    });

    it('não cria claim quando não há candidato elegível', async () => {
      prisma.listaEspera.findMany.mockResolvedValue([]);

      await expect(
        service.claimNextEligibleEntryForSlot(
          slot.barbeiroId,
          slot.servicoId,
          slot.dateKey,
          slot.horaInicio,
          slot.horaFim,
        ),
      ).rejects.toThrow(new NotFoundException('Nenhuma entrada elegível para este slot.'));
      expect(prisma.waitlistClaim.create).not.toHaveBeenCalled();
    });

    it('claim válido bloqueia duplicação, mas claim expirado não bloqueia', async () => {
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 11,
          clienteId: 101,
          status: StatusListaEspera.ATIVA,
          dataEntrada: new Date('2098-01-01T00:00:00.000Z'),
          horaInicio: null,
          horaFim: null,
        },
      ]);
      prisma.waitlistClaim.findFirst.mockResolvedValueOnce({ id: 40 });

      await expect(
        service.claimNextEligibleEntryForSlot(
          slot.barbeiroId,
          slot.servicoId,
          slot.dateKey,
          slot.horaInicio,
          slot.horaFim,
        ),
      ).rejects.toThrow(new ConflictException('Já existe um claim ativo para este slot.'));

      prisma.waitlistClaim.findFirst.mockResolvedValueOnce(null);
      prisma.waitlistClaim.create.mockResolvedValue({
        id: 41,
        listaEsperaId: 11,
        barbeiroId: 10,
        servicoId: 20,
        horaInicio: '10:00',
        horaFim: '10:30',
        status: StatusWaitlistClaim.ATIVO,
        expiraEm: new Date(Date.now() + 5 * 60 * 1000),
        dataCriacao: new Date(),
      });

      await expect(
        service.claimNextEligibleEntryForSlot(
          slot.barbeiroId,
          slot.servicoId,
          slot.dateKey,
          slot.horaInicio,
          slot.horaFim,
        ),
      ).resolves.toEqual(expect.objectContaining({ id: 41 }));
    });

    it('não cria claim para slot bloqueado ou appointment confirmado', async () => {
      scheduleService.getDateSnapshot.mockResolvedValue({
        windows: [{ ini: 0, fim: 24 * 60 }],
        busy: [{ ini: 600, fim: 630, origem: 'BLOQUEIO' }],
      });

      await expect(
        service.claimNextEligibleEntryForSlot(
          slot.barbeiroId,
          slot.servicoId,
          slot.dateKey,
          slot.horaInicio,
          slot.horaFim,
        ),
      ).rejects.toThrow(new ConflictException('O slot não está mais disponível.'));
      expect(prisma.waitlistClaim.create).not.toHaveBeenCalled();
    });
  });

  describe('aceite e recusa de claim', () => {
    const claim = {
      id: 50,
      listaEsperaId: 11,
      barbeiroId: 10,
      servicoId: 20,
      data: new Date('2099-01-12T00:00:00.000Z'),
      horaInicio: '10:00',
      horaFim: '10:30',
      status: StatusWaitlistClaim.ATIVO,
      expiraEm: new Date('2099-01-12T09:00:00.000Z'),
      dataCriacao: new Date('2099-01-01T00:00:00.000Z'),
    };

    beforeEach(() => {
      prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
      prisma.waitlistClaim.findFirst.mockResolvedValue(claim);
      prisma.waitlistClaim.findUnique.mockResolvedValue({
        ...claim,
        listaEspera: { clienteId: 99, status: StatusListaEspera.ATIVA },
      });
      prisma.waitlistClaim.updateMany.mockResolvedValue({ count: 1 });
      prisma.listaEspera.updateMany.mockResolvedValue({ count: 1 });
      appointmentsService.createConfirmedForClient.mockResolvedValue({
        id: 700,
        status: StatusAgendamento.CONFIRMADO,
      });
    });

    it('aceita claim, cria appointment e conclui a entrada', async () => {
      const result = await service.acceptClaim(1, claim.id);

      expect(appointmentsService.createConfirmedForClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          clienteId: 99,
          barbeiroId: 10,
          servicoId: 20,
          data: '2099-01-12',
          horaInicio: '10:00',
          horaFim: '10:30',
        }),
      );
      expect(prisma.waitlistClaim.updateMany).toHaveBeenCalledWith({
        where: { id: claim.id, status: StatusWaitlistClaim.ATIVO },
        data: { status: StatusWaitlistClaim.ACEITO },
      });
      expect(prisma.listaEspera.updateMany).toHaveBeenCalledWith({
        where: { id: 11, status: StatusListaEspera.ATIVA },
        data: { status: StatusListaEspera.ATENDIDA },
      });
      expect(result.appointment.id).toBe(700);
    });

    it('recusa claim sem criar appointment e mantém a lista ativa', async () => {
      const result = await service.rejectClaim(1, claim.id);

      expect(result.status).toBe(StatusWaitlistClaim.RECUSADO);
      expect(appointmentsService.createConfirmedForClient).not.toHaveBeenCalled();
      expect(prisma.listaEspera.updateMany).not.toHaveBeenCalled();
      expect(prisma.waitlistClaim.updateMany).toHaveBeenCalledWith({
        where: { id: claim.id, status: StatusWaitlistClaim.ATIVO },
        data: { status: StatusWaitlistClaim.RECUSADO },
      });
    });

    it('rejeita claim expirado sem criar appointment', async () => {
      prisma.waitlistClaim.findUnique.mockResolvedValue({
        ...claim,
        expiraEm: new Date(Date.now() - 1000),
        listaEspera: { clienteId: 99, status: StatusListaEspera.ATIVA },
      });

      await expect(service.acceptClaim(1, claim.id)).rejects.toThrow(
        new ConflictException('Claim expirado.'),
      );
      expect(appointmentsService.createConfirmedForClient).not.toHaveBeenCalled();
      expect(prisma.waitlistClaim.updateMany).not.toHaveBeenCalled();
    });

    it.each([StatusWaitlistClaim.ACEITO, StatusWaitlistClaim.RECUSADO])(
      'rejeita claim terminal %s',
      async (status) => {
        prisma.waitlistClaim.findUnique.mockResolvedValue({
          ...claim,
          status,
          listaEspera: { clienteId: 99, status: StatusListaEspera.ATIVA },
        });

        await expect(service.acceptClaim(1, claim.id)).rejects.toThrow(
          new ConflictException('Claim não está ativo.'),
        );
        expect(appointmentsService.createConfirmedForClient).not.toHaveBeenCalled();
      },
    );

    it('retorna 404 genérico para claim de outro cliente', async () => {
      prisma.waitlistClaim.findFirst.mockResolvedValue(null);

      await expect(service.rejectClaim(1, claim.id)).rejects.toThrow(
        new NotFoundException('Claim não encontrado.'),
      );
    });

    it('propaga revalidação de slot bloqueado sem alterar claim', async () => {
      appointmentsService.createConfirmedForClient.mockRejectedValue(
        new ConflictException('O slot não está mais disponível.'),
      );

      await expect(service.acceptClaim(1, claim.id)).rejects.toThrow(
        new ConflictException('O slot não está mais disponível.'),
      );
      expect(prisma.waitlistClaim.updateMany).not.toHaveBeenCalled();
      expect(prisma.listaEspera.updateMany).not.toHaveBeenCalled();
    });
  });

  it('cancelamento do próprio cliente funciona e marca status CANCELADA', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.listaEspera.findUnique.mockResolvedValue({
      id: 3,
      clienteId: 99,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });
    prisma.listaEspera.update.mockResolvedValue({
      id: 3,
      clienteId: 99,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.CANCELADA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.cancel(1, 3);
    expect(result.status).toBe(StatusListaEspera.CANCELADA);
  });

  it('cancelar entrada de outro cliente retorna 404 genérico', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.listaEspera.findUnique.mockResolvedValue({
      id: 5,
      clienteId: 555,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
    });

    await expect(service.cancel(1, 5)).rejects.toThrow(
      new NotFoundException('Entrada de lista de espera não encontrada.'),
    );
  });

  it('cancelamento repetido retorna 409', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.listaEspera.findUnique.mockResolvedValue({
      id: 9,
      clienteId: 99,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.CANCELADA,
    });

    await expect(service.cancel(1, 9)).rejects.toThrow(
      new ConflictException('Esta entrada já está cancelada.'),
    );
  });

  describe('findEligibleEntriesForSlot', () => {
    it('retorna entrada ativa compatível', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 1,
          clienteId: 99,
          barbeiroId: 10,
          servicoId: 20,
          dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
          dataCriacao: new Date('2099-01-01T00:00:00.000Z'),
          status: StatusListaEspera.ATIVA,
          horaInicio: '09:00',
          horaFim: '18:00',
        },
      ]);
      prisma.agendamento.findMany.mockResolvedValue([]);

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '10:00',
        '10:30',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('rejeita entrada cancelada', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 2,
          clienteId: 77,
          barbeiroId: 10,
          servicoId: 20,
          dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
          dataEntrada: new Date('2099-01-01T00:00:00.000Z'),
          status: StatusListaEspera.CANCELADA,
          horaInicio: '10:00',
          horaFim: '18:00',
        },
      ]);
      prisma.agendamento.findMany.mockResolvedValue([]);

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '10:00',
        '10:30',
      );

      expect(result).toEqual([]);
    });

    it('rejeita quando o slot sai da faixa desejada', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 3,
          clienteId: 88,
          barbeiroId: 10,
          servicoId: 20,
          dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
          dataEntrada: new Date('2099-01-01T00:00:00.000Z'),
          status: StatusListaEspera.ATIVA,
          horaInicio: '14:00',
          horaFim: '18:00',
        },
      ]);
      prisma.agendamento.findMany.mockResolvedValue([]);

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '13:45',
        '14:15',
      );

      expect(result).toEqual([]);
    });

    it('rejeita cliente com Appointment confirmado conflitante', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 4,
          clienteId: 99,
          barbeiroId: 10,
          servicoId: 20,
          dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
          dataCriacao: new Date('2099-01-01T00:00:00.000Z'),
          status: StatusListaEspera.ATIVA,
          horaInicio: '09:00',
          horaFim: '18:00',
        },
      ]);
      prisma.agendamento.findMany.mockResolvedValue([
        {
          clienteId: 99,
          data: new Date('2099-01-12T00:00:00.000Z'),
          horaInicio: new Date('2099-01-12T13:00:00.000Z'),
          horaFim: new Date('2099-01-12T13:30:00.000Z'),
          status: 'CONFIRMADO',
        },
      ]);

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '10:00',
        '10:30',
      );

      expect(result).toEqual([]);
    });

    it('rejeita serviço inativo', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue(null);

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '10:00',
        '10:30',
      );

      expect(result).toEqual([]);
    });

    it('rejeita barbeiro inativo', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: false });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '10:00',
        '10:30',
      );

      expect(result).toEqual([]);
    });

    it('aceita slot válido quando a entrada não tem faixa desejada', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 7,
          clienteId: 44,
          barbeiroId: 10,
          servicoId: 20,
          dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
          dataEntrada: new Date('2099-01-01T00:00:00.000Z'),
          status: StatusListaEspera.ATIVA,
          horaInicio: null,
          horaFim: null,
        },
      ]);
      prisma.agendamento.findMany.mockResolvedValue([]);

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '10:00',
        '10:30',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(7);
    });

    it('não bloqueia Appointment cancelado do cliente', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 8,
          clienteId: 55,
          barbeiroId: 10,
          servicoId: 20,
          dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
          dataCriacao: new Date('2099-01-01T00:00:00.000Z'),
          status: StatusListaEspera.ATIVA,
          horaInicio: '09:00',
          horaFim: '18:00',
        },
      ]);
      prisma.agendamento.findMany.mockResolvedValue([
        {
          clienteId: 55,
          data: new Date('2099-01-12T00:00:00.000Z'),
          horaInicio: new Date('2099-01-12T10:00:00.000Z'),
          horaFim: new Date('2099-01-12T10:30:00.000Z'),
          status: 'CANCELADO',
        },
      ]);

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '10:00',
        '10:30',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(8);
    });

    it('bloqueia Appointment confirmado do cliente em outro barbeiro', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 9,
          clienteId: 66,
          barbeiroId: 10,
          servicoId: 20,
          dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
          dataCriacao: new Date('2099-01-01T00:00:00.000Z'),
          status: StatusListaEspera.ATIVA,
          horaInicio: '09:00',
          horaFim: '18:00',
        },
      ]);
      prisma.agendamento.findMany.mockResolvedValue([
        {
          clienteId: 66,
          barbeiroId: 99,
          data: new Date('2099-01-12T00:00:00.000Z'),
          horaInicio: new Date('2099-01-12T13:15:00.000Z'),
          horaFim: new Date('2099-01-12T13:45:00.000Z'),
          status: 'CONFIRMADO',
        },
      ]);

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '10:00',
        '10:30',
      );

      expect(result).toEqual([]);
    });

    it('ordena FIFO por dataCriacao e id', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
      prisma.servico.findFirst.mockResolvedValue({
        id: 20,
        barbeiroId: 10,
        ativo: true,
        duracaoMinutos: 30,
      });
      prisma.listaEspera.findMany.mockResolvedValue([
        {
          id: 6,
          clienteId: 21,
          barbeiroId: 10,
          servicoId: 20,
          dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
          dataEntrada: new Date('2099-01-04T00:00:00.000Z'),
          status: StatusListaEspera.ATIVA,
          horaInicio: '09:00',
          horaFim: '18:00',
        },
        {
          id: 5,
          clienteId: 20,
          barbeiroId: 10,
          servicoId: 20,
          dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
          dataEntrada: new Date('2099-01-01T00:00:00.000Z'),
          status: StatusListaEspera.ATIVA,
          horaInicio: '09:00',
          horaFim: '18:00',
        },
      ].sort((a, b) => new Date(a.dataEntrada).getTime() - new Date(b.dataEntrada).getTime()));
      prisma.agendamento.findMany.mockResolvedValue([]);

      const result = await service.findEligibleEntriesForSlot(
        10,
        20,
        '2099-01-12',
        '10:00',
        '10:30',
      );

      expect(result.map((entry) => entry.id)).toEqual([5, 6]);
    });
  });
});
