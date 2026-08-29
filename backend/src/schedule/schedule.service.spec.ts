import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ScheduleService, SLOT_GRANULARITY_MINUTES } from './schedule.service';
import { prismaDateFilter, zonedWallTimeToUtc } from './tz.util';

const BARBER_ID = 101;
const DAY_MON = '2099-01-12'; // segunda-feira

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildPrismaMock(): any {
  const prismaMock: any = {
    barbeiro: { findUnique: jest.fn() },
    // Advisory lock do calendário (acquireCalendarLock usa $executeRaw).
    $executeRaw: jest.fn().mockResolvedValue(1),
    horarioFuncionamento: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    bloqueioAgenda: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
    },
    agendamento: { findMany: jest.fn().mockResolvedValue([]) },
    servico: { findFirst: jest.fn() },
  };
  prismaMock.$transaction = jest.fn((callback: any) => callback(prismaMock));
  return prismaMock;
}

function buildUsersMock(): any {
  return { findAuthorizationStateById: jest.fn() };
}

describe('ScheduleService', () => {
  let prisma: any;
  let users: any;
  let service: ScheduleService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    users = buildUsersMock();
    prisma.barbeiro.findUnique.mockResolvedValue({ id: BARBER_ID });
    service = new ScheduleService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
    );
  });

  describe('identidade Usuario -> Barbeiro', () => {
    it('retorna NotFound quando o usuario nao possui registro de Barbeiro', async () => {
      prisma.barbeiro.findUnique.mockResolvedValue(null);

      await expect(
        service.replaceOwnBusinessHours(1, {
          horarios: [{ diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' }],
        }),
      ).rejects.toThrow(new NotFoundException('Barbeiro não encontrado.'));
    });
  });

  describe('horários de funcionamento', () => {
    it('lista somente os horarios proprios', async () => {
      prisma.horarioFuncionamento.findMany.mockResolvedValue([
        { id: 1, diaSemana: 1, horaInicio: '09:00', horaFim: '12:00', ativo: true },
        { id: 2, diaSemana: 1, horaInicio: '13:00', horaFim: '18:00', ativo: true },
      ]);

      const result = await service.findOwnBusinessHours(7);

      expect(prisma.horarioFuncionamento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { barbeiroId: BARBER_ID } }),
      );
      expect(result[0]).toEqual({
        id: 1,
        diaSemana: 1,
        horaInicio: '09:00',
        horaFim: '12:00',
        ativo: true,
      });
    });

    it('rejeita janela com horaFim menor ou igual a horaInicio', async () => {
      await expect(
        service.replaceOwnBusinessHours(7, {
          horarios: [{ diaSemana: 1, horaInicio: '12:00', horaFim: '09:00' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejeita janelas sobrepostas no mesmo dia', async () => {
      await expect(
        service.replaceOwnBusinessHours(7, {
          horarios: [
            { diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' },
            { diaSemana: 1, horaInicio: '11:00', horaFim: '13:00' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('permite janelas encostadas e aplica ativo padrao true', async () => {
      await service.replaceOwnBusinessHours(7, {
        horarios: [
          { diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' },
          { diaSemana: 1, horaInicio: '12:00', horaFim: '15:00' },
          { diaSemana: 3, horaInicio: '08:00', horaFim: '11:00', ativo: false },
        ],
      });

      expect(prisma.horarioFuncionamento.deleteMany).toHaveBeenCalledWith({
        where: { barbeiroId: BARBER_ID },
      });
      expect(prisma.horarioFuncionamento.createMany).toHaveBeenCalledWith({
        data: [
          { barbeiroId: BARBER_ID, diaSemana: 1, horaInicio: '09:00', horaFim: '12:00', ativo: true },
          { barbeiroId: BARBER_ID, diaSemana: 1, horaInicio: '12:00', horaFim: '15:00', ativo: true },
          { barbeiroId: BARBER_ID, diaSemana: 3, horaInicio: '08:00', horaFim: '11:00', ativo: false },
        ],
      });
    });

    it('PUT integral e idempotente: mesma entrada gera mesmo rebuild', async () => {
      const dto = {
        horarios: [{ diaSemana: 2, horaInicio: '10:00', horaFim: '16:00' }],
      };

      await service.replaceOwnBusinessHours(7, dto);
      await service.replaceOwnBusinessHours(7, dto);

      expect(prisma.horarioFuncionamento.deleteMany).toHaveBeenCalledTimes(2);
      expect(prisma.horarioFuncionamento.createMany).toHaveBeenCalledTimes(2);
      expect(prisma.horarioFuncionamento.createMany).toHaveBeenLastCalledWith({
        data: [
          { barbeiroId: BARBER_ID, diaSemana: 2, horaInicio: '10:00', horaFim: '16:00', ativo: true },
        ],
      });
    });
  });

  describe('bloqueios', () => {
    it('cria bloqueio persistindo instantes reais (nao UTC falso)', async () => {
      prisma.bloqueioAgenda.create.mockResolvedValue({
        id: 9,
        data: prismaDateFilter(DAY_MON),
        horaInicio: zonedWallTimeToUtc(DAY_MON, '10:00'),
        horaFim: zonedWallTimeToUtc(DAY_MON, '10:45'),
        motivo: 'Consulta',
        ativo: true,
      });

      const result = await service.createOwnBlock(7, {
        data: DAY_MON,
        horaInicio: '10:00',
        horaFim: '10:45',
        motivo: 'Consulta',
      });

      expect(prisma.bloqueioAgenda.create).toHaveBeenCalledWith({
        data: {
          barbeiroId: BARBER_ID,
          data: prismaDateFilter(DAY_MON),
          horaInicio: zonedWallTimeToUtc(DAY_MON, '10:00'),
          horaFim: zonedWallTimeToUtc(DAY_MON, '10:45'),
          motivo: 'Consulta',
        },
      });
      expect(result).toEqual({
        id: 9,
        data: DAY_MON,
        horaInicio: '10:00',
        horaFim: '10:45',
        motivo: 'Consulta',
        ativo: true,
      });
    });

    it('rejeita data de calendario inexistente', async () => {
      await expect(
        service.createOwnBlock(7, {
          data: '2099-02-30',
          horaInicio: '10:00',
          horaFim: '11:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita bloqueio com horaFim menor ou igual a horaInicio', async () => {
      await expect(
        service.createOwnBlock(7, {
          data: DAY_MON,
          horaInicio: '11:00',
          horaFim: '10:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita sobreposição parcial com bloqueio ativo existente', async () => {
      prisma.bloqueioAgenda.findMany.mockResolvedValue([
        {
          id: 1,
          horaInicio: zonedWallTimeToUtc(DAY_MON, '10:00'),
          horaFim: zonedWallTimeToUtc(DAY_MON, '10:45'),
        },
      ]);

      await expect(
        service.createOwnBlock(7, {
          data: DAY_MON,
          horaInicio: '10:15',
          horaFim: '11:00',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('permite bloqueio encostado no existente', async () => {
      prisma.bloqueioAgenda.findMany.mockResolvedValue([
        {
          id: 1,
          horaInicio: zonedWallTimeToUtc(DAY_MON, '10:00'),
          horaFim: zonedWallTimeToUtc(DAY_MON, '10:45'),
        },
      ]);
      prisma.bloqueioAgenda.create.mockResolvedValue({
        id: 2,
        data: prismaDateFilter(DAY_MON),
        horaInicio: zonedWallTimeToUtc(DAY_MON, '10:45'),
        horaFim: zonedWallTimeToUtc(DAY_MON, '11:30'),
        motivo: null,
        ativo: true,
      });

      await expect(
        service.createOwnBlock(7, {
          data: DAY_MON,
          horaInicio: '10:45',
          horaFim: '11:30',
        }),
      ).resolves.toBeDefined();
    });

    it('conflito com agendamento CONFIRMADO e filtro somente confirmados', async () => {
      prisma.agendamento.findMany.mockResolvedValue([
        {
          horaInicio: zonedWallTimeToUtc(DAY_MON, '11:00'),
          horaFim: zonedWallTimeToUtc(DAY_MON, '11:30'),
        },
      ]);
      prisma.bloqueioAgenda.create.mockResolvedValue({
        id: 3,
        data: prismaDateFilter(DAY_MON),
        horaInicio: zonedWallTimeToUtc(DAY_MON, '11:45'),
        horaFim: zonedWallTimeToUtc(DAY_MON, '12:30'),
        motivo: null,
        ativo: true,
      });

      await expect(
        service.createOwnBlock(7, {
          data: DAY_MON,
          horaInicio: '11:00',
          horaFim: '11:30',
        }),
      ).rejects.toThrow(ConflictException);

      // Nova tentativa em horário livre passa e o filtro usa só CONFIRMADO.
      await expect(
        service.createOwnBlock(7, {
          data: DAY_MON,
          horaInicio: '11:45',
          horaFim: '12:30',
        }),
      ).resolves.toBeDefined();

      expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            barbeiroId: BARBER_ID,
            status: { in: ['CONFIRMADO'] },
          }),
        }),
      );
    });

    it('lista bloqueios filtrando por periodo com datas civis', async () => {
      prisma.bloqueioAgenda.findMany.mockResolvedValue([]);

      await service.findOwnBlocks(7, DAY_MON, '2099-01-14');

      expect(prisma.bloqueioAgenda.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            barbeiroId: BARBER_ID,
            data: {
              gte: prismaDateFilter(DAY_MON),
              lte: prismaDateFilter('2099-01-14'),
            },
          },
        }),
      );
    });

    it('rejeita periodo de consulta invalido', async () => {
      await expect(service.findOwnBlocks(7, '2099-02-31')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('remove bloqueio proprio', async () => {
      prisma.bloqueioAgenda.findFirst.mockResolvedValue({ id: 33 });

      await expect(service.deleteOwnBlock(7, 33)).resolves.toBeUndefined();

      expect(prisma.bloqueioAgenda.delete).toHaveBeenCalledWith({
        where: { id: 33 },
      });
    });

    it('DELETE de bloqueio de outro barbeiro retorna 404 generico', async () => {
      prisma.bloqueioAgenda.findFirst.mockResolvedValue(null);

      await expect(service.deleteOwnBlock(7, 999)).rejects.toThrow(
        new NotFoundException('Bloqueio não encontrado.'),
      );
      expect(prisma.bloqueioAgenda.delete).not.toHaveBeenCalled();
    });
  });

  describe('disponibilidade', () => {
    function arrangeAvailability(options: {
      role?: 'CLIENTE' | 'BARBEIRO';
      barbeiroAtivo?: boolean;
      userAtivo?: boolean;
      service?: any;
      windows?: Array<{ diaSemana: number; horaInicio: string; horaFim: string }>;
      blocks?: Array<{ horaInicio: string; horaFim: string }>;
      appointments?: Array<{ horaInicio: string; horaFim: string }>;
    }) {
      const {
        role = 'CLIENTE',
        barbeiroAtivo = true,
        userAtivo = true,
        service = { id: 55, ativo: true, duracaoMinutos: 30 },
        windows = [],
        blocks = [],
        appointments = [],
      } = options;

      users.findAuthorizationStateById.mockResolvedValue({
        id: 7,
        ativo: userAtivo,
        tipoUsuario: role === 'CLIENTE' ? TipoUsuario.CLIENTE : TipoUsuario.BARBEIRO,
        barbeiro: role === 'BARBEIRO' ? { ativo: barbeiroAtivo } : null,
      });

      prisma.servico.findFirst.mockResolvedValue(service);
      prisma.horarioFuncionamento.findMany.mockResolvedValue(windows);
      prisma.bloqueioAgenda.findMany.mockResolvedValue(
        blocks.map((block, index) => ({
          id: index + 1,
          horaInicio: zonedWallTimeToUtc(DAY_MON, block.horaInicio),
          horaFim: zonedWallTimeToUtc(DAY_MON, block.horaFim),
        })),
      );
      prisma.agendamento.findMany.mockResolvedValue(
        appointments.map((appointment, index) => ({
          id: index + 1,
          horaInicio: zonedWallTimeToUtc(DAY_MON, appointment.horaInicio),
          horaFim: zonedWallTimeToUtc(DAY_MON, appointment.horaFim),
        })),
      );
    }

    it('exige barbeiroId quando o papel é CLIENTE', async () => {
      arrangeAvailability({ role: 'CLIENTE' });

      await expect(
        service.getAvailability(7, { data: DAY_MON, servicoId: 55 }),
      ).rejects.toThrow(new BadRequestException('Informe o barbeiroId.'));
    });

    it('usuario inativo com JWT recebe Unauthorized', async () => {
      arrangeAvailability({ role: 'CLIENTE', userAtivo: false });

      await expect(
        service.getAvailability(7, {
          data: DAY_MON,
          servicoId: 55,
          barbeiroId: BARBER_ID,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('barbeiro com registro inativo recebe Forbidden na propria agenda', async () => {
      arrangeAvailability({ role: 'BARBEIRO', barbeiroAtivo: false });

      await expect(
        service.getAvailability(7, { data: DAY_MON, servicoId: 55 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('barbeiro sem barbeiroId consulta a propria disponibilidade', async () => {
      arrangeAvailability({
        role: 'BARBEIRO',
        windows: [{ diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' }],
      });

      const result = await service.getAvailability(7, {
        data: DAY_MON,
        servicoId: 55,
      });

      expect(prisma.barbeiro.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { usuarioId: 7 } }),
      );
      expect(result.barbeiroId).toBe(BARBER_ID);
      // Janela 09:00–12:00, serviço 30min: inícios 09:00..11:30 na grade de 15min.
      expect(result.horariosLivres).toEqual([
        '09:00',
        '09:15',
        '09:30',
        '09:45',
        '10:00',
        '10:15',
        '10:30',
        '10:45',
        '11:00',
        '11:15',
        '11:30',
      ]);
    });

    it('serviço inexistente, inativo ou de outro barbeiro retorna 404 generico', async () => {
      arrangeAvailability({
        role: 'CLIENTE',
        service: { id: 55, ativo: false, duracaoMinutos: 30 },
      });

      await expect(
        service.getAvailability(7, {
          data: DAY_MON,
          servicoId: 55,
          barbeiroId: BARBER_ID,
        }),
      ).rejects.toThrow(new NotFoundException('Serviço não encontrado.'));

      prisma.servico.findFirst.mockResolvedValue(null);
      await expect(
        service.getAvailability(7, {
          data: DAY_MON,
          servicoId: 999,
          barbeiroId: BARBER_ID,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('data de calendario inexistente rejeita com 400', async () => {
      arrangeAvailability({ role: 'CLIENTE' });

      await expect(
        service.getAvailability(7, {
          data: '2099-02-30',
          servicoId: 55,
          barbeiroId: BARBER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('dia sem janelas cadastradas retorna lista vazia (200)', async () => {
      arrangeAvailability({ role: 'CLIENTE' });

      const result = await service.getAvailability(7, {
        data: DAY_MON,
        servicoId: 55,
        barbeiroId: BARBER_ID,
      });

      expect(result).toEqual({
        data: DAY_MON,
        barbeiroId: BARBER_ID,
        duracaoMinutos: 30,
        horariosLivres: [],
      });
    });

    it('grade fixa de 15 minutos e duracao integral do servico', async () => {
      arrangeAvailability({
        role: 'CLIENTE',
        windows: [{ diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' }],
        service: { id: 55, ativo: true, duracaoMinutos: 45 },
      });

      const result = await service.getAvailability(7, {
        data: DAY_MON,
        servicoId: 55,
        barbeiroId: BARBER_ID,
      });

      // Janela 180min com serviço de 45min: últimos inícios que comportam.
      expect(SLOT_GRANULARITY_MINUTES).toBe(15);
      expect(result.horariosLivres).toEqual([
        '09:00',
        '09:15',
        '09:30',
        '09:45',
        '10:00',
        '10:15',
        '10:30',
        '10:45',
        '11:00',
        '11:15',
      ]);
    });

    it('CASO OBRIGATÓRIO: serviço 30min + bloqueio 10:00–10:45', async () => {
      arrangeAvailability({
        role: 'CLIENTE',
        windows: [{ diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' }],
        blocks: [{ horaInicio: '10:00', horaFim: '10:45' }],
      });

      const result = await service.getAvailability(7, {
        data: DAY_MON,
        servicoId: 55,
        barbeiroId: BARBER_ID,
      });

      // Regra [início, fim): slotInício < ocupadoFim && ocupadoInício < slotFim
      // 09:30 termina exatamente 10:00 -> permitido; 10:45 começa no fim -> permitido.
      expect(result.horariosLivres).toEqual([
        '09:00',
        '09:15',
        '09:30',
        '10:45',
        '11:00',
        '11:15',
        '11:30',
      ]);
      expect(result.horariosLivres).not.toContain('09:45');
      expect(result.horariosLivres).not.toContain('10:00');
      expect(result.horariosLivres).not.toContain('10:15');
      expect(result.horariosLivres).not.toContain('10:30');
    });

    it('múltiplas janelas no mesmo dia respeitam intervalo de almoço', async () => {
      arrangeAvailability({
        role: 'CLIENTE',
        windows: [
          { diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' },
          { diaSemana: 1, horaInicio: '13:00', horaFim: '18:00' },
        ],
        service: { id: 55, ativo: true, duracaoMinutos: 60 },
      });

      const result = await service.getAvailability(7, {
        data: DAY_MON,
        servicoId: 55,
        barbeiroId: BARBER_ID,
      });

      expect(result.horariosLivres).toContain('09:00');
      expect(result.horariosLivres).toContain('11:00'); // último início da manhã
      expect(result.horariosLivres).toContain('13:00'); // primeiro da tarde
      expect(result.horariosLivres).toContain('17:00'); // 17:00+60 = 18:00
      expect(result.horariosLivres).not.toContain('11:15');
      expect(result.horariosLivres).not.toContain('12:00');
      expect(result.horariosLivres).not.toContain('12:45');
    });

    it('agendamento CONFIRMADO remove slots interceptantes (filtro só confirmados)', async () => {
      arrangeAvailability({
        role: 'CLIENTE',
        windows: [{ diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' }],
        appointments: [{ horaInicio: '11:00', horaFim: '11:30' }],
      });

      const result = await service.getAvailability(7, {
        data: DAY_MON,
        servicoId: 55,
        barbeiroId: BARBER_ID,
      });

      // Slots que interceptam [11:00, 11:30): 10:45, 11:00 e 11:15.
      expect(result.horariosLivres).toEqual([
        '09:00',
        '09:15',
        '09:30',
        '09:45',
        '10:00',
        '10:15',
        '10:30',
        '11:30',
      ]);

      expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['CONFIRMADO'] },
          }),
        }),
      );
    });
  });
});
