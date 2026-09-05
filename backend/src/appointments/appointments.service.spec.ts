import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatusAgendamento } from '../generated/prisma/enums';
import { ScheduleService } from '../schedule/schedule.service';
import { AppointmentsService } from './appointments.service';
import {
  getZonedParts,
  prismaDateFilter,
  zonedWallTimeToUtc,
} from '../schedule/tz.util';

const BARBER_ID = 21;
const CLIENT_ID = 31;
const SERVICE_ID = 41;
const DAY_MON = '2099-01-12'; // segunda-feira
const WINDOW_9_18 = [{ ini: 540, fim: 1080 }]; // 09:00–18:00

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildPrismaMock(): any {
  const prismaMock: any = {
    cliente: { findUnique: jest.fn() },
    barbeiro: { findFirst: jest.fn(), findUnique: jest.fn() },
    servico: { findFirst: jest.fn() },
    waitlistClaim: { findMany: jest.fn().mockResolvedValue([]) },
    agendamento: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
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

  describe('consultas de ownership (ETAPA 4A)', () => {
    it('cliente acessa apenas seu próprio agendamento', async () => {
      prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
      prisma.agendamento.findUnique.mockResolvedValue(buildFullRow(11));

      const result = await service.findByIdForUser(1, 11);

      expect(result.id).toBe(11);
      expect(prisma.agendamento.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 11 },
        }),
      );
    });

    it('cliente acessa agendamento de outro cliente recebe 404 genérico', async () => {
      prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
      prisma.agendamento.findUnique.mockResolvedValue(
        buildFullRow(11, { clienteId: CLIENT_ID + 1 }),
      );

      await expect(service.findByIdForUser(1, 11)).rejects.toThrow(
        new NotFoundException('Agendamento não encontrado.'),
      );
    });

    it('barbeiro acessa apenas agendamento do próprio perfil', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(buildFullRow(12));

      const result = await service.findByIdForUser(1, 12);

      expect(result.id).toBe(12);
      expect(prisma.agendamento.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 12 },
        }),
      );
    });

    it('barbeiro acessa agendamento de outro barbeiro recebe 404 genérico', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(
        buildFullRow(12, { barbeiroId: BARBER_ID + 1 }),
      );

      await expect(service.findByIdForUser(1, 12)).rejects.toThrow(
        new NotFoundException('Agendamento não encontrado.'),
      );
    });

    it('lista somente a agenda do barbeiro autenticado em ordem cronológica', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findMany.mockResolvedValue([
        buildFullRow(1, {
          data: prismaDateFilter('2099-01-12'),
          horaInicio: zonedWallTimeToUtc('2099-01-12', '10:00'),
          horaFim: zonedWallTimeToUtc('2099-01-12', '10:30'),
        }),
        buildFullRow(2, {
          data: prismaDateFilter('2099-01-13'),
          horaInicio: zonedWallTimeToUtc('2099-01-13', '11:00'),
          horaFim: zonedWallTimeToUtc('2099-01-13', '11:30'),
        }),
      ]);

      const result = await service.findByBarberUserId(1);

      expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { barbeiroId: BARBER_ID },
          orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
        }),
      );
      expect(result.map((appointment) => appointment.id)).toEqual([1, 2]);
    });
  });

  describe('transições de status (ETAPA 4B)', () => {
    it('CLIENTE cancela próprio CONFIRMADO antes do dia -> sucesso', async () => {
      const laterDate = '2099-01-13';
      const row = buildFullRow(51, {
        data: prismaDateFilter(laterDate),
        horaInicio: zonedWallTimeToUtc(laterDate, '10:00'),
        horaFim: zonedWallTimeToUtc(laterDate, '10:30'),
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
      prisma.agendamento.findUnique
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, status: StatusAgendamento.CANCELADO });
      prisma.agendamento.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.cancelAppointment(1, 51);

      expect(result.status).toBe(StatusAgendamento.CANCELADO);
      expect(prisma.agendamento.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 51,
            clienteId: CLIENT_ID,
            status: StatusAgendamento.CONFIRMADO,
          },
          data: { status: StatusAgendamento.CANCELADO },
        }),
      );
    });

    it('CLIENTE tenta cancelar no mesmo dia -> 400', async () => {
      const now = new Date();
      const { year, month, day } = getZonedParts(now);
      const todayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const row = buildFullRow(52, {
        data: prismaDateFilter(todayKey),
        horaInicio: zonedWallTimeToUtc(todayKey, '10:00'),
        horaFim: zonedWallTimeToUtc(todayKey, '10:30'),
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
      prisma.agendamento.findUnique.mockResolvedValue(row);

      await expect(service.cancelAppointment(1, 52)).rejects.toThrow(
        new BadRequestException(
          'Cliente só pode cancelar até o dia anterior ao agendamento.',
        ),
      );
    });

    it('CLIENTE tenta cancelar agendamento de outro cliente -> 404', async () => {
      prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
      prisma.agendamento.findUnique.mockResolvedValue(
        buildFullRow(53, { clienteId: CLIENT_ID + 1, status: StatusAgendamento.CONFIRMADO }),
      );

      await expect(service.cancelAppointment(1, 53)).rejects.toThrow(
        new NotFoundException('Agendamento não encontrado.'),
      );
    });

    it('BARBEIRO cancela agendamento da própria agenda -> sucesso', async () => {
      const laterDate = '2099-01-14';
      const row = buildFullRow(54, {
        data: prismaDateFilter(laterDate),
        horaInicio: zonedWallTimeToUtc(laterDate, '11:00'),
        horaFim: zonedWallTimeToUtc(laterDate, '11:30'),
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, status: StatusAgendamento.CANCELADO });
      prisma.agendamento.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.cancelAppointment(1, 54);

      expect(result.status).toBe(StatusAgendamento.CANCELADO);
      expect(prisma.agendamento.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 54,
            barbeiroId: BARBER_ID,
            status: StatusAgendamento.CONFIRMADO,
          },
          data: { status: StatusAgendamento.CANCELADO },
        }),
      );
    });

    it('BARBEIRO tenta cancelar agendamento de outro barbeiro -> 404', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(
        buildFullRow(55, { barbeiroId: BARBER_ID + 1, status: StatusAgendamento.CONFIRMADO }),
      );

      await expect(service.cancelAppointment(1, 55)).rejects.toThrow(
        new NotFoundException('Agendamento não encontrado.'),
      );
    });

    it('cancelamento com status terminal/incompatível -> 409', async () => {
      prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
      prisma.agendamento.findUnique.mockResolvedValue(
        buildFullRow(56, { status: StatusAgendamento.CANCELADO }),
      );

      await expect(service.cancelAppointment(1, 56)).rejects.toThrow(
        new ConflictException('Status incompatível para cancelamento.'),
      );
    });

    it('cancelamento concorrente count=0 -> 409', async () => {
      const laterDate = '2099-01-15';
      const row = buildFullRow(57, {
        data: prismaDateFilter(laterDate),
        horaInicio: zonedWallTimeToUtc(laterDate, '12:00'),
        horaFim: zonedWallTimeToUtc(laterDate, '12:30'),
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.cliente.findUnique.mockResolvedValue({ id: CLIENT_ID });
      prisma.agendamento.findUnique.mockResolvedValue(row);
      prisma.agendamento.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelAppointment(1, 57)).rejects.toThrow(
        new ConflictException('Agendamento não pode mais ser cancelado.'),
      );
    });

    it('BARBEIRO conclui próprio agendamento após horaFim -> sucesso', async () => {
      const finished = new Date(Date.now() - 60_000);
      const row = buildFullRow(61, {
        horaInicio: new Date(finished.getTime() - 60_000),
        horaFim: finished,
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, status: StatusAgendamento.CONCLUIDO });
      prisma.agendamento.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.completeAppointment(1, 61);

      expect(result.status).toBe(StatusAgendamento.CONCLUIDO);
    });

    it('conclusão antes de horaFim -> 400', async () => {
      const row = buildFullRow(62, {
        horaInicio: new Date(Date.now() - 60_000),
        horaFim: new Date(Date.now() + 60_000),
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(row);

      await expect(service.completeAppointment(1, 62)).rejects.toThrow(
        new BadRequestException('Só é possível concluir após o fim do agendamento.'),
      );
    });

    it('conclusão de outro barbeiro -> 404', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(
        buildFullRow(63, { barbeiroId: BARBER_ID + 1, status: StatusAgendamento.CONFIRMADO }),
      );

      await expect(service.completeAppointment(1, 63)).rejects.toThrow(
        new NotFoundException('Agendamento não encontrado.'),
      );
    });

    it('conclusão com status incompatível -> 409', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(
        buildFullRow(64, { status: StatusAgendamento.CANCELADO }),
      );

      await expect(service.completeAppointment(1, 64)).rejects.toThrow(
        new ConflictException('Status incompatível para conclusão.'),
      );
    });

    it('conclusão concorrente count=0 -> 409', async () => {
      const row = buildFullRow(65, {
        horaInicio: new Date(Date.now() - 120_000),
        horaFim: new Date(Date.now() - 30_000),
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(row);
      prisma.agendamento.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.completeAppointment(1, 65)).rejects.toThrow(
        new ConflictException('Agendamento foi atualizado por outra operação.'),
      );
    });

    it('BARBEIRO marca próprio falta após/início -> sucesso', async () => {
      const started = new Date(Date.now() - 15_000);
      const row = buildFullRow(71, {
        horaInicio: started,
        horaFim: new Date(started.getTime() + 30_000),
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, status: StatusAgendamento.NAO_COMPARECEU });
      prisma.agendamento.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.noShowAppointment(1, 71);

      expect(result.status).toBe(StatusAgendamento.NAO_COMPARECEU);
    });

    it('falta antes de horaInicio -> 400', async () => {
      const row = buildFullRow(72, {
        horaInicio: new Date(Date.now() + 60_000),
        horaFim: new Date(Date.now() + 120_000),
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(row);

      await expect(service.noShowAppointment(1, 72)).rejects.toThrow(
        new BadRequestException(
          'Só é possível marcar falta após o início do agendamento.',
        ),
      );
    });

    it('falta de outro barbeiro -> 404', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(
        buildFullRow(73, { barbeiroId: BARBER_ID + 1, status: StatusAgendamento.CONFIRMADO }),
      );

      await expect(service.noShowAppointment(1, 73)).rejects.toThrow(
        new NotFoundException('Agendamento não encontrado.'),
      );
    });

    it('falta com status incompatível -> 409', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(
        buildFullRow(74, { status: StatusAgendamento.CANCELADO }),
      );

      await expect(service.noShowAppointment(1, 74)).rejects.toThrow(
        new ConflictException('Status incompatível para falta.'),
      );
    });

    it('falta concorrente count=0 -> 409', async () => {
      const row = buildFullRow(75, {
        horaInicio: new Date(Date.now() - 60_000),
        horaFim: new Date(Date.now() + 30_000),
        status: StatusAgendamento.CONFIRMADO,
      });
      prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
      prisma.agendamento.findUnique.mockResolvedValue(row);
      prisma.agendamento.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.noShowAppointment(1, 75)).rejects.toThrow(
        new ConflictException('Agendamento foi atualizado por outra operação.'),
      );
    });
  });
});
