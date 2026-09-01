import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatusAgendamento } from '../generated/prisma/enums';
import { ScheduleService } from '../schedule/schedule.service';
import { AppointmentsService } from './appointments.service';
import { prismaDateFilter, zonedWallTimeToUtc } from '../schedule/tz.util';

const BARBER_ID = 21;
const CLIENT_ID = 31;
const SERVICE_ID = 41;
const DAY_MON = '2099-01-12'; // segunda-feira
const WINDOW_9_18 = [{ ini: 540, fim: 1080 }]; // 09:00–18:00

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildPrismaMock(): any {
  const prismaMock: any = {
    cliente: { findUnique: jest.fn() },
    barbeiro: { findFirst: jest.fn() },
    servico: { findFirst: jest.fn() },
    agendamento: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  prismaMock.$transaction = jest.fn(async (callback: any) =>
    callback(prismaMock),
  );
  return prismaMock;
}

function buildScheduleMock(): any {
  return {
    getDateSnapshot: jest.fn().mockResolvedValue({ windows: [], busy: [] }),
  };
}

function buildFullRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    clienteId: CLIENT_ID,
    barbeiroId: BARBER_ID,
    servicoId: SERVICE_ID,
    data: prismaDateFilter(DAY_MON),
    horaInicio: zonedWallTimeToUtc(DAY_MON, '10:00'),
    horaFim: zonedWallTimeToUtc(DAY_MON, '10:30'),
    status: 'CONFIRMADO',
    observacoes: null,
    servico: { id: SERVICE_ID, nome: 'Corte', preco: '30.00' },
    barbeiro: { id: BARBER_ID, usuario: { nome: 'Barbeiro A' } },
    cliente: { id: CLIENT_ID, usuario: { nome: 'Cliente A' } },
    ...overrides,
  };
}

describe('AppointmentsService', () => {
  let prisma: any;
  let schedule: any;
  let service: AppointmentsService;

  const validDto = {
    data: DAY_MON,
    horaInicio: '10:00',
    barbeiroId: BARBER_ID,
    servicoId: SERVICE_ID,
    observacoes: 'Chegar 5 minutos antes.',
  };

  function arrangeSuccess(
    options: {
      windows?: Array<{ ini: number; fim: number }>;
      busy?: Array<{ ini: number; fim: number; origem: string }>;
      clientAppointments?: Array<{ horaInicio: Date; horaFim: Date }>;
      servico?: any;
    } = {},
  ) {
    const {
      windows = WINDOW_9_18,
      busy = [],
      clientAppointments = [],
      servico = { id: SERVICE_ID, ativo: true, duracaoMinutos: 30 },
    } = options;

    prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
    prisma.barbeiro.findFirst.mockResolvedValue({ id: BARBER_ID });
    prisma.servico.findFirst.mockResolvedValue(servico);
    schedule.getDateSnapshot.mockResolvedValue({ windows, busy });
    prisma.agendamento.findMany.mockResolvedValue(clientAppointments);
    let createdData: Record<string, unknown> | null = null;
    prisma.agendamento.create.mockImplementation(({ data }: any) => {
      createdData = data;
      return Promise.resolve({ id: 77, ...data });
    });
    // findUnique devolve a linha PERSISTIDA (merge do que o create gravou).
    prisma.agendamento.findUnique.mockImplementation(() =>
      Promise.resolve({ ...buildFullRow(77), ...(createdData ?? {}) }),
    );
  }

  beforeEach(() => {
    prisma = buildPrismaMock();
    schedule = buildScheduleMock();
    service = new AppointmentsService(
      prisma as unknown as PrismaService,
      schedule as unknown as ScheduleService,
    );
  });

  describe('criação', () => {
    it('criação feliz retorna resposta completa (HH:mm local, preço informativo)', async () => {
      arrangeSuccess();

      const result = await service.create(1, validDto);

      expect(result).toEqual({
        id: 77,
        data: DAY_MON,
        horaInicio: '10:00',
        horaFim: '10:30',
        duracaoMinutos: 30,
        status: 'CONFIRMADO',
        observacoes: 'Chegar 5 minutos antes.',
        servico: { id: SERVICE_ID, nome: 'Corte', precoInformativo: '30.00' },
        barbeiro: { id: BARBER_ID, nome: 'Barbeiro A' },
        cliente: { id: CLIENT_ID, nome: 'Cliente A' },
      });
    });

    it('resolve o cliente pelo usuarioId autenticado', async () => {
      arrangeSuccess();

      await service.create(1, validDto);

      expect(prisma.cliente.findUnique).toHaveBeenCalledWith({
        where: { usuarioId: 1 },
        select: { id: true },
      });
    });

    it('create usa status CONFIRMADO e instantes reais coerentes com São Paulo', async () => {
      arrangeSuccess();

      await service.create(1, validDto);

      expect(prisma.agendamento.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clienteId: CLIENT_ID,
          barbeiroId: BARBER_ID,
          servicoId: SERVICE_ID,
          status: 'CONFIRMADO',
          observacoes: 'Chegar 5 minutos antes.',
          data: prismaDateFilter(DAY_MON),
          // 10:00–10:30 em São Paulo == 13:00Z–13:30Z (instantes reais).
          horaInicio: zonedWallTimeToUtc(DAY_MON, '10:00'),
          horaFim: zonedWallTimeToUtc(DAY_MON, '10:30'),
        }),
      });
    });

    it('cliente inexistente recebe 404 e nenhum lock é adquirido', async () => {
      prisma.cliente.findUnique.mockResolvedValue(null);

      await expect(service.create(1, validDto)).rejects.toThrow(
        new NotFoundException('Cliente não encontrado.'),
      );
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('barbeiro inexistente/inativo recebe 404', async () => {
      arrangeSuccess();
      prisma.barbeiro.findFirst.mockResolvedValue(null);

      await expect(service.create(1, validDto)).rejects.toThrow(
        new NotFoundException('Barbeiro não encontrado.'),
      );
      expect(prisma.barbeiro.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BARBER_ID, ativo: true },
        }),
      );
    });

    it('serviço inexistente/inativo/de outro barbeiro recebe 404', async () => {
      arrangeSuccess();
      prisma.servico.findFirst.mockResolvedValue(null);

      await expect(service.create(1, validDto)).rejects.toThrow(
        new NotFoundException('Serviço não encontrado.'),
      );
      expect(prisma.servico.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SERVICE_ID, barbeiroId: BARBER_ID },
        }),
      );
    });

    it('rejeita data de calendário inexistente', async () => {
      arrangeSuccess();

      await expect(
        service.create(1, { ...validDto, data: '2099-02-30' }),
      ).rejects.toThrow(new BadRequestException('Data inválida.'));
    });

    it('rejeita hora inválida', async () => {
      arrangeSuccess();

      await expect(
        service.create(1, { ...validDto, horaInicio: '25:00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita horaInicio fora da grade de 15 minutos', async () => {
      arrangeSuccess();

      await expect(
        service.create(1, { ...validDto, horaInicio: '10:07' }),
      ).rejects.toThrow(
        new BadRequestException(
          'horaInicio deve estar alinhada à grade de 15 minutos.',
        ),
      );
    });

    it('rejeita horário no passado', async () => {
      arrangeSuccess();

      await expect(
        service.create(1, { ...validDto, data: '2020-01-06' }),
      ).rejects.toThrow(
        new BadRequestException(
          'Não é possível agendar um horário que já passou.',
        ),
      );
    });

    it('rejeita fora do horário de funcionamento', async () => {
      arrangeSuccess();

      await expect(
        service.create(1, { ...validDto, horaInicio: '07:00' }),
      ).rejects.toThrow(
        new BadRequestException('Fora do horário de funcionamento.'),
      );
    });

    it('rejeita slot que atravessa o fim da janela', async () => {
      // Janela até 18:00; serviço de 30min iniciando 17:45 não cabe.
      arrangeSuccess();

      await expect(
        service.create(1, { ...validDto, horaInicio: '17:45' }),
      ).rejects.toThrow(
        new BadRequestException('Fora do horário de funcionamento.'),
      );
    });

    it('bloqueio ativo no período retorna 400', async () => {
      arrangeSuccess({
        busy: [{ ini: 600, fim: 645, origem: 'BLOQUEIO' }], // 10:00–10:45
      });

      await expect(service.create(1, validDto)).rejects.toThrow(
        new BadRequestException('Horário bloqueado.'),
      );
    });

    it('agendamento CONFIRMADO do barbeiro retorna 409', async () => {
      arrangeSuccess({
        busy: [{ ini: 600, fim: 630, origem: 'AGENDAMENTO' }], // 10:00–10:30
      });

      await expect(service.create(1, validDto)).rejects.toThrow(
        new ConflictException('Horário não está mais disponível.'),
      );
    });

    it('borda permitida: 09:00–09:30 existente e novo às 09:30', async () => {
      arrangeSuccess({
        busy: [{ ini: 540, fim: 570, origem: 'AGENDAMENTO' }], // 09:00–09:30
      });

      const result = await service.create(1, {
        ...validDto,
        horaInicio: '09:30',
        observacoes: undefined,
      });

      expect(result.status).toBe('CONFIRMADO');
      // [570,600) não intercepta [540,570): toque de borda é permitido.
      expect(prisma.agendamento.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          horaFim: zonedWallTimeToUtc(DAY_MON, '10:00'),
        }),
      });
    });

    it('conflito do PRÓPRIO CLIENTE em outro barbeiro retorna 409', async () => {
      arrangeSuccess({
        // 09:15–09:45 no barbeiro B (snapshot do barbeiro A está livre).
        clientAppointments: [
          {
            horaInicio: zonedWallTimeToUtc(DAY_MON, '09:15'),
            horaFim: zonedWallTimeToUtc(DAY_MON, '09:45'),
          },
        ],
      });

      await expect(
        service.create(1, { ...validDto, horaInicio: '09:30' }),
      ).rejects.toThrow(
        new ConflictException('Horário não está disponível para o cliente.'),
      );
    });

    it('conflito do cliente considera apenas CONFIRMADO (CANCELADO/CONCLUIDO/NAO_COMPARECEU não bloqueiam)', async () => {
      arrangeSuccess();

      await service.create(1, validDto);

      expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clienteId: CLIENT_ID,
            data: prismaDateFilter(DAY_MON),
            status: StatusAgendamento.CONFIRMADO,
          }),
        }),
      );
    });

    it('adquire locks na ordem determinística CLIENTE → BARBEIRO', async () => {
      const order: string[] = [];
      prisma.$executeRaw.mockImplementation(
        (_sql: any, namespace: number, id: number) => {
          order.push(
            namespace === 2 ? `CLIENTE:${id}` : `BARBEIRO:${namespace}:${id}`,
          );
          return Promise.resolve(1);
        },
      );
      arrangeSuccess();

      await service.create(1, validDto);

      expect(order).toEqual([
        `CLIENTE:${CLIENT_ID}`,
        `BARBEIRO:1:${BARBER_ID}`,
      ]);
    });

    it('todas as leituras e o INSERT ocorrem no TransactionClient', async () => {
      arrangeSuccess();

      await service.create(1, validDto);

      // O tx repassado pelo $transaction (o próprio mock) é usado em todas
      // as leituras decisivas, incluindo o snapshot do Schedule.
      expect(schedule.getDateSnapshot).toHaveBeenCalledWith(
        prisma,
        BARBER_ID,
        DAY_MON,
      );
      expect(prisma.barbeiro.findFirst).toHaveBeenCalled();
      expect(prisma.servico.findFirst).toHaveBeenCalled();
      expect(prisma.agendamento.findMany).toHaveBeenCalled();
      expect(prisma.agendamento.create).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('listagem do cliente (GET /appointments/my)', () => {
    const row10 = buildFullRow(1);
    const row1030 = buildFullRow(2, {
      horaInicio: zonedWallTimeToUtc(DAY_MON, '10:30'),
      horaFim: zonedWallTimeToUtc(DAY_MON, '11:00'),
    });

    it('resolve o cliente e retorna somente os próprios agendamentos ordenados', async () => {
      prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
      prisma.agendamento.findMany.mockResolvedValue([row10, row1030]);

      const result = await service.findMyAppointments(1);

      expect(prisma.cliente.findUnique).toHaveBeenCalledWith({
        where: { usuarioId: 1 },
        select: { id: true },
      });
      expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clienteId: CLIENT_ID },
          orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
        }),
      );
      expect(result.map((appointment) => appointment.id)).toEqual([1, 2]);
      expect(result[0]).toMatchObject({
        data: DAY_MON,
        horaInicio: '10:00',
        horaFim: '10:30',
        duracaoMinutos: 30,
        status: 'CONFIRMADO',
      });
    });

    it('cliente inexistente recebe 404', async () => {
      prisma.cliente.findUnique.mockResolvedValue(null);

      await expect(service.findMyAppointments(1)).rejects.toThrow(
        new NotFoundException('Cliente não encontrado.'),
      );
    });

    it('mapeia preço informativo com exatamente 2 casas decimais', async () => {
      prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
      prisma.agendamento.findMany.mockResolvedValue([
        buildFullRow(1, {
          servico: { id: SERVICE_ID, nome: 'Corte', preco: '45.5' },
        }),
      ]);

      const result = await service.findMyAppointments(1);

      expect(result[0].servico.precoInformativo).toBe('45.50');
    });
  });
});
