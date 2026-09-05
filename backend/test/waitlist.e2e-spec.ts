import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import {
  StatusListaEspera,
  StatusWaitlistClaim,
  TipoUsuario,
} from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { WaitlistService } from '../src/waitlist/waitlist.service';

describe('Waitlist (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let waitlistService: WaitlistService;

  let clientAToken: string;
  let clientBToken: string;
  let barberAToken: string;
  let barberBToken: string;

  let clientAId: number;
  let clientBId: number;
  let barberAId: number;
  let barberBId: number;
  let serviceAId: number;
  let serviceBId: number;

  const userIds: number[] = [];
  const clientIds: number[] = [];
  const barberIds: number[] = [];
  const waitlistIds: number[] = [];
  const claimIds: number[] = [];
  const serviceIds: number[] = [];

  const password = 'waitlist-e2e-password';
  const prefix = `waitlist-e2e-${Date.now()}`;
  const phoneBase = String(Date.now()).slice(-8);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    waitlistService = app.get(WaitlistService);
    const senhaHash = await hashPassword(password);

    const createClient = async (nome: string, telefone: string) => {
      const usuario = await prisma.usuario.create({
        data: {
          nome,
          telefone,
          senhaHash,
          tipoUsuario: TipoUsuario.CLIENTE,
          cliente: { create: {} },
        },
      });
      userIds.push(usuario.id);
      const cliente = await prisma.cliente.findUnique({
        where: { usuarioId: usuario.id },
      });
      clientIds.push(cliente!.id);
      return { telefone, clienteId: cliente!.id };
    };

    const createBarber = async (nome: string, telefone: string) => {
      const usuario = await prisma.usuario.create({
        data: {
          nome,
          telefone,
          senhaHash,
          tipoUsuario: TipoUsuario.BARBEIRO,
          barbeiro: { create: {} },
        },
        include: { barbeiro: true },
      });
      userIds.push(usuario.id);
      barberIds.push(usuario.barbeiro!.id);
      return { telefone, barbeiroId: usuario.barbeiro!.id };
    };

    const clientA = await createClient('Cliente A Waitlist', `${phoneBase}11`);
    const clientB = await createClient('Cliente B Waitlist', `${phoneBase}12`);
    const barberA = await createBarber('Barbeiro A Waitlist', `${phoneBase}21`);
    const barberB = await createBarber('Barbeiro B Waitlist', `${phoneBase}22`);

    clientAId = clientA.clienteId;
    clientBId = clientB.clienteId;
    barberAId = barberA.barbeiroId;
    barberBId = barberB.barbeiroId;

    const createService = async (barbeiroId: number, nome: string) => {
      const service = await prisma.servico.create({
        data: {
          barbeiroId,
          nome,
          descricao: 'Serviço da lista de espera',
          duracaoMinutos: 30,
          preco: '30.00',
          ativo: true,
        },
      });
      serviceIds.push(service.id);
      return service;
    };

    serviceAId = (await createService(barberAId, `${prefix}-corte`)).id;
    serviceBId = (await createService(barberBId, `${prefix}-barba`)).id;

    const login = async (telefone: string): Promise<string> => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ telefone, senha: password })
        .expect(200);
      return response.body.token as string;
    };

    clientAToken = await login(clientA.telefone);
    clientBToken = await login(clientB.telefone);
    barberAToken = await login(barberA.telefone);
    barberBToken = await login(barberB.telefone);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.waitlistClaim.deleteMany({ where: { id: { in: claimIds } } });
      await prisma.listaEspera.deleteMany({
        where: {
          OR: [
            { id: { in: waitlistIds } },
            { servicoId: { in: serviceIds } },
            { barbeiroId: { in: barberIds } },
            { clienteId: { in: clientIds } },
          ],
        },
      });
      await prisma.agendamento.deleteMany({
        where: { OR: [{ barbeiroId: { in: barberIds } }, { clienteId: { in: clientIds } }] },
      });
      await prisma.servico.deleteMany({ where: { id: { in: serviceIds } } });
      await prisma.horarioFuncionamento.deleteMany({ where: { barbeiroId: { in: barberIds } } });
      await prisma.barbeiro.deleteMany({ where: { id: { in: barberIds } } });
      await prisma.cliente.deleteMany({ where: { usuarioId: { in: userIds } } });
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
    }

    if (app) {
      await app.close();
    }
  });

  const postWaitlist = (token: string, payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/waitlist')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

  const ensureBusinessHours = async (dateKey: string) => {
    await prisma.horarioFuncionamento.create({
      data: {
        barbeiroId: barberAId,
        diaSemana: new Date(`${dateKey}T00:00:00.000Z`).getUTCDay(),
        horaInicio: '08:00',
        horaFim: '18:00',
        ativo: true,
      },
    });
  };

  const createClaimFixture = async (
    dateKey: string,
    clienteId = clientAId,
    horaInicio = '10:00',
    horaFim = '10:30',
  ) => {
    await ensureBusinessHours(dateKey);
    const entry = await prisma.listaEspera.create({
      data: {
        clienteId,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        dataDesejada: new Date(`${dateKey}T00:00:00.000Z`),
        horaInicio: '08:00',
        horaFim: '18:00',
      },
    });
    waitlistIds.push(entry.id);
    const claim = await prisma.waitlistClaim.create({
      data: {
        listaEsperaId: entry.id,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        data: new Date(`${dateKey}T00:00:00.000Z`),
        horaInicio,
        horaFim,
        status: StatusWaitlistClaim.ATIVO,
        expiraEm: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    claimIds.push(claim.id);
    return { entry, claim };
  };

  it('requer autenticação para entrar na lista', async () => {
    await request(app.getHttpServer())
      .post('/waitlist')
      .send({
        barbeiroId: barberAId,
        servicoId: serviceAId,
        data: '2099-01-12',
      })
      .expect(401);
  });

  it('rejeita role incorreta', async () => {
    await postWaitlist(barberAToken, {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2099-01-12',
    }).expect(403);
  });

  it('cria entrada ativa de cliente válido', async () => {
    const response = await postWaitlist(clientAToken, {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2099-01-12',
      horaInicio: '10:00',
      horaFim: '10:30',
    }).expect(201);

    expect(response.body.status).toBe(StatusListaEspera.ATIVA);
    waitlistIds.push(response.body.id);
  });

  it('rejeita data inválida', async () => {
    await postWaitlist(clientAToken, {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2099-02-30',
    }).expect(400);
  });

  it('rejeita data passada', async () => {
    await postWaitlist(clientAToken, {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2020-01-06',
    }).expect(400);
  });

  it('rejeita faixa inválida', async () => {
    await postWaitlist(clientAToken, {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2099-01-13',
      horaInicio: '10:30',
      horaFim: '10:00',
    }).expect(400);
  });

  it('aceita claim e cria appointment confirmado atomicamente', async () => {
    const { entry, claim } = await createClaimFixture('2099-04-01');

    const response = await request(app.getHttpServer())
      .post(`/waitlist/claims/${claim.id}/accept`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(201);

    expect(response.body.appointment.status).toBe('CONFIRMADO');
    expect(response.body.claim.status).toBe(StatusWaitlistClaim.ACEITO);
    expect(response.body.appointment.clienteId).toBeUndefined();

    const storedClaim = await prisma.waitlistClaim.findUnique({ where: { id: claim.id } });
    const storedEntry = await prisma.listaEspera.findUnique({ where: { id: entry.id } });
    const appointment = await prisma.agendamento.findFirst({
      where: { clienteId: clientAId, barbeiroId: barberAId, data: new Date('2099-04-01T00:00:00.000Z') },
    });
    expect(storedClaim?.status).toBe(StatusWaitlistClaim.ACEITO);
    expect(storedEntry?.status).toBe(StatusListaEspera.ATENDIDA);
    expect(appointment?.status).toBe('CONFIRMADO');
  });

  it('recusa claim sem criar appointment e mantém a lista ativa', async () => {
    const { entry, claim } = await createClaimFixture('2099-04-02');

    await request(app.getHttpServer())
      .post(`/waitlist/claims/${claim.id}/reject`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(201);

    const storedClaim = await prisma.waitlistClaim.findUnique({ where: { id: claim.id } });
    const storedEntry = await prisma.listaEspera.findUnique({ where: { id: entry.id } });
    const appointments = await prisma.agendamento.count({
      where: { clienteId: clientAId, barbeiroId: barberAId, data: new Date('2099-04-02T00:00:00.000Z') },
    });
    expect(storedClaim?.status).toBe(StatusWaitlistClaim.RECUSADO);
    expect(storedEntry?.status).toBe(StatusListaEspera.ATIVA);
    expect(appointments).toBe(0);
  });

  it('rejeita aceite de claim expirado sem alterações indevidas', async () => {
    const { entry, claim } = await createClaimFixture('2099-04-03');
    await prisma.waitlistClaim.update({
      where: { id: claim.id },
      data: { expiraEm: new Date(Date.now() - 60_000) },
    });

    await request(app.getHttpServer())
      .post(`/waitlist/claims/${claim.id}/accept`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(409);

    const storedClaim = await prisma.waitlistClaim.findUnique({ where: { id: claim.id } });
    const storedEntry = await prisma.listaEspera.findUnique({ where: { id: entry.id } });
    expect(storedClaim?.status).toBe(StatusWaitlistClaim.ATIVO);
    expect(storedEntry?.status).toBe(StatusListaEspera.ATIVA);
  });

  it('não permite que outro cliente aceite ou recuse o claim', async () => {
    const { claim } = await createClaimFixture('2099-04-04');

    await request(app.getHttpServer())
      .post(`/waitlist/claims/${claim.id}/accept`)
      .set('Authorization', `Bearer ${clientBToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/waitlist/claims/${claim.id}/reject`)
      .set('Authorization', `Bearer ${clientBToken}`)
      .expect(404);
  });

  it('dois aceites concorrentes criam exatamente um appointment', async () => {
    const { claim } = await createClaimFixture('2099-04-05');
    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/waitlist/claims/${claim.id}/accept`)
        .set('Authorization', `Bearer ${clientAToken}`),
      request(app.getHttpServer())
        .post(`/waitlist/claims/${claim.id}/accept`)
        .set('Authorization', `Bearer ${clientAToken}`),
    ]);

    const statusCodes = results.map((result) =>
      result.status === 'fulfilled' ? result.value.status : 0,
    );
    expect(statusCodes.filter((status) => status === 201)).toHaveLength(1);
    expect(statusCodes.filter((status) => status === 409)).toHaveLength(1);
    expect(
      await prisma.agendamento.count({
        where: { clienteId: clientAId, barbeiroId: barberAId, data: new Date('2099-04-05T00:00:00.000Z') },
      }),
    ).toBe(1);
  });

  it('aceite e recusa concorrentes deixam apenas uma transição terminal consistente', async () => {
    const { entry, claim } = await createClaimFixture('2099-04-06');
    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/waitlist/claims/${claim.id}/accept`)
        .set('Authorization', `Bearer ${clientAToken}`),
      request(app.getHttpServer())
        .post(`/waitlist/claims/${claim.id}/reject`)
        .set('Authorization', `Bearer ${clientAToken}`),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const statuses = results.map((result) =>
      result.status === 'fulfilled' ? result.value.status : result.reason?.status,
    );
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);

    const storedClaim = await prisma.waitlistClaim.findUnique({ where: { id: claim.id } });
    const storedEntry = await prisma.listaEspera.findUnique({ where: { id: entry.id } });
    const appointmentCount = await prisma.agendamento.count({
      where: { clienteId: clientAId, barbeiroId: barberAId, data: new Date('2099-04-06T00:00:00.000Z') },
    });
    expect([StatusWaitlistClaim.ACEITO, StatusWaitlistClaim.RECUSADO]).toContain(storedClaim?.status);
    if (storedClaim?.status === StatusWaitlistClaim.ACEITO) {
      expect(storedEntry?.status).toBe(StatusListaEspera.ATENDIDA);
      expect(appointmentCount).toBe(1);
    } else {
      expect(storedEntry?.status).toBe(StatusListaEspera.ATIVA);
      expect(appointmentCount).toBe(0);
    }
  });

  it('aceite concorrente com appointment normal deixa apenas um confirmado', async () => {
    const { claim } = await createClaimFixture('2099-04-07');
    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/waitlist/claims/${claim.id}/accept`)
        .set('Authorization', `Bearer ${clientAToken}`),
      request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${clientBToken}`)
        .send({
          barbeiroId: barberAId,
          servicoId: serviceAId,
          data: '2099-04-07',
          horaInicio: '10:00',
        }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const statuses = results.map((result) =>
      result.status === 'fulfilled' ? result.value.status : result.reason?.status,
    );
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => [400, 409].includes(status))).toHaveLength(1);
    expect(
      await prisma.agendamento.count({
        where: {
          barbeiroId: barberAId,
          data: new Date('2099-04-07T00:00:00.000Z'),
          status: 'CONFIRMADO',
        },
      }),
    ).toBe(1);
  });

  it('rejeita serviço de outro barbeiro', async () => {
    await postWaitlist(clientAToken, {
      barbeiroId: barberAId,
      servicoId: serviceBId,
      data: '2099-01-14',
    }).expect(404);
  });

  it('concorrência real: duas POST equivalentes geram exatamente uma entrada ativa', async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const dateKey = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(future);

    const payload = {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: dateKey,
      horaInicio: '11:00',
      horaFim: '11:30',
    };

    const results = await Promise.allSettled([
      postWaitlist(clientAToken, payload),
      postWaitlist(clientAToken, payload),
    ]);

    const httpStatus = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => (result as PromiseFulfilledResult<any>).value.status);

    expect(httpStatus.filter((status) => status === 201)).toHaveLength(1);
    expect(httpStatus.filter((status) => status === 409)).toHaveLength(1);

    const createdResponse = results.find(
      (result) => result.status === 'fulfilled' && result.value.status === 201,
    ) as PromiseFulfilledResult<any> | undefined;

    if (createdResponse) {
      waitlistIds.push(createdResponse.value.body.id);
    }

    const activeEntries = await prisma.listaEspera.findMany({
      where: {
        clienteId: clientAId,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        dataDesejada: new Date(`${dateKey}T00:00:00.000Z`),
        status: StatusListaEspera.ATIVA,
      },
    });

    expect(activeEntries).toHaveLength(1);
  });

  it('lista somente a minha lista de espera', async () => {
    const created = await postWaitlist(clientAToken, {
      barbeiroId: barberBId,
      servicoId: serviceBId,
      data: '2099-01-15',
    }).expect(201);
    waitlistIds.push(created.body.id);

    const own = await request(app.getHttpServer())
      .get('/waitlist/my')
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);

    expect(own.body.length).toBeGreaterThanOrEqual(2);

    const other = await request(app.getHttpServer())
      .get('/waitlist/my')
      .set('Authorization', `Bearer ${clientBToken}`)
      .expect(200);

    expect(other.body.length).toBeGreaterThanOrEqual(0);
  });

  it('cancela própria entrada e impede cancelamento repetido', async () => {
    const created = await postWaitlist(clientAToken, {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2099-01-16',
    }).expect(201);
    waitlistIds.push(created.body.id);

    const cancelled = await request(app.getHttpServer())
      .patch(`/waitlist/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);

    expect(cancelled.body.status).toBe(StatusListaEspera.CANCELADA);

    await request(app.getHttpServer())
      .patch(`/waitlist/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(409);
  });

  it('não permite cancelar entrada de outro cliente', async () => {
    const created = await postWaitlist(clientAToken, {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2099-01-17',
    }).expect(201);
    waitlistIds.push(created.body.id);

    await request(app.getHttpServer())
      .patch(`/waitlist/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${clientBToken}`)
      .expect(404);
  });

  it('claim real concorrente cria exatamente um claim ativo válido', async () => {
    const dateKey = '2099-03-10';
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    const diaSemana = date.getUTCDay();
    await prisma.horarioFuncionamento.create({
      data: {
        barbeiroId: barberAId,
        diaSemana,
        horaInicio: '08:00',
        horaFim: '18:00',
        ativo: true,
      },
    });

    const older = await prisma.listaEspera.create({
      data: {
        clienteId: clientAId,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        dataDesejada: date,
        horaInicio: '09:00',
        horaFim: '18:00',
        dataEntrada: new Date('2098-01-01T00:00:00.000Z'),
      },
    });
    const newer = await prisma.listaEspera.create({
      data: {
        clienteId: clientBId,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        dataDesejada: date,
        horaInicio: '09:00',
        horaFim: '18:00',
        dataEntrada: new Date('2098-01-02T00:00:00.000Z'),
      },
    });
    waitlistIds.push(older.id, newer.id);

    const results = await Promise.allSettled([
      waitlistService.claimNextEligibleEntryForSlot(barberAId, serviceAId, dateKey, '10:00', '10:30'),
      waitlistService.claimNextEligibleEntryForSlot(barberAId, serviceAId, dateKey, '10:00', '10:30'),
    ]);

    if (results.every((result) => result.status === 'rejected')) {
      throw new Error(
        results
          .map((result) => (result.status === 'rejected' ? result.reason?.message : 'ok'))
          .join(' | '),
      );
    }
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const claims = await prisma.waitlistClaim.findMany({
      where: {
        barbeiroId: barberAId,
        servicoId: serviceAId,
        data: date,
        horaInicio: '10:00',
        horaFim: '10:30',
        status: StatusWaitlistClaim.ATIVO,
        expiraEm: { gt: new Date() },
      },
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].listaEsperaId).toBe(older.id);
    claimIds.push(claims[0].id);
  });

  it('claim expirado real não impede novo claim', async () => {
    const dateKey = '2099-03-11';
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    await prisma.horarioFuncionamento.create({
      data: {
        barbeiroId: barberAId,
        diaSemana: date.getUTCDay(),
        horaInicio: '08:00',
        horaFim: '18:00',
        ativo: true,
      },
    });
    const entry = await prisma.listaEspera.create({
      data: {
        clienteId: clientAId,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        dataDesejada: date,
        horaInicio: '09:00',
        horaFim: '18:00',
      },
    });
    waitlistIds.push(entry.id);
    const expired = await prisma.waitlistClaim.create({
      data: {
        listaEsperaId: entry.id,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        data: date,
        horaInicio: '10:00',
        horaFim: '10:30',
        status: StatusWaitlistClaim.ATIVO,
        expiraEm: new Date(Date.now() - 60_000),
      },
    });
    claimIds.push(expired.id);

    const result = await waitlistService.claimNextEligibleEntryForSlot(
      barberAId,
      serviceAId,
      dateKey,
      '10:00',
      '10:30',
    );

    expect(result.listaEsperaId).toBe(entry.id);
    expect(result.status).toBe(StatusWaitlistClaim.ATIVO);
    claimIds.push(result.id);
  });

  it('detecta duplicidade ativa em concorrência real', async () => {
    const payload = {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2099-01-18',
      horaInicio: '09:00',
      horaFim: '09:30',
    };

    const results = await Promise.allSettled([
      postWaitlist(clientAToken, payload),
      postWaitlist(clientAToken, payload),
    ]);

    const statusCodes = results.map((result) =>
      result.status === 'fulfilled'
        ? result.value.status
        : result.reason?.response?.status ?? 0,
    );

    expect(statusCodes.filter((code) => code === 201)).toHaveLength(1);
    expect(statusCodes.filter((code) => code === 409)).toHaveLength(1);

    const activeEntries = await prisma.listaEspera.count({
      where: {
        clienteId: clientAId,
        servicoId: serviceAId,
        dataDesejada: new Date('2099-01-18T00:00:00.000Z'),
        status: StatusListaEspera.ATIVA,
      },
    });

    expect(activeEntries).toBe(1);
  });

  it('seleciona apenas candidatos elegíveis da waitlist em FIFO real no PostgreSQL', async () => {
    const dateKey = '2099-02-10';
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    const senhaHash = await hashPassword(password);

    await prisma.horarioFuncionamento.createMany({
      data: [
        {
          barbeiroId: barberAId,
          diaSemana: new Date(`${dateKey}T00:00:00.000Z`).getUTCDay(),
          horaInicio: '08:00',
          horaFim: '18:00',
          ativo: true,
        },
      ],
    });

    const clientC = await prisma.usuario.create({
      data: {
        nome: 'Cliente C Waitlist',
        telefone: `${phoneBase}31`,
        senhaHash,
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
      include: { cliente: true },
    });
    const clientD = await prisma.usuario.create({
      data: {
        nome: 'Cliente D Waitlist',
        telefone: `${phoneBase}32`,
        senhaHash,
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
      include: { cliente: true },
    });

    const olderEntry = await prisma.listaEspera.create({
      data: {
        clienteId: clientAId,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        dataDesejada: date,
        horaInicio: '09:00',
        horaFim: '18:00',
        status: StatusListaEspera.ATIVA,
      },
    });

    const newerEntry = await prisma.listaEspera.create({
      data: {
        clienteId: clientBId,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        dataDesejada: date,
        horaInicio: '09:00',
        horaFim: '18:00',
        status: StatusListaEspera.ATIVA,
      },
    });

    await prisma.listaEspera.create({
      data: {
        clienteId: clientC.cliente!.id,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        dataDesejada: date,
        horaInicio: '14:00',
        horaFim: '18:00',
        status: StatusListaEspera.ATIVA,
      },
    });

    const conflictingClientEntry = await prisma.listaEspera.create({
      data: {
        clienteId: clientD.cliente!.id,
        barbeiroId: barberAId,
        servicoId: serviceAId,
        dataDesejada: date,
        horaInicio: '09:00',
        horaFim: '18:00',
        status: StatusListaEspera.ATIVA,
      },
    });

    await prisma.agendamento.create({
      data: {
        clienteId: clientD.cliente!.id,
        barbeiroId: barberBId,
        servicoId: serviceBId,
        data: date,
        horaInicio: new Date('2099-02-10T10:15:00.000-03:00'),
        horaFim: new Date('2099-02-10T10:45:00.000-03:00'),
        status: 'CONFIRMADO',
      },
    });

    const eligible = await waitlistService.findEligibleEntriesForSlot(
      barberAId,
      serviceAId,
      dateKey,
      '10:00',
      '10:30',
    );

    expect(eligible.map((entry) => entry.id)).toEqual([olderEntry.id, newerEntry.id]);
    expect(eligible.some(({ id }) => id === conflictingClientEntry.id)).toBe(false);
    expect(eligible.some(({ id }) => id === olderEntry.id)).toBe(true);
    expect(eligible.some(({ id }) => id === newerEntry.id)).toBe(true);

    await prisma.waitlistClaim.deleteMany({
      where: { barbeiroId: barberAId },
    });
    await prisma.listaEspera.deleteMany({
      where: {
        OR: [
          { id: { in: [olderEntry.id, newerEntry.id, conflictingClientEntry.id] } },
          { clienteId: { in: [clientAId, clientBId, clientC.cliente!.id, clientD.cliente!.id] } },
        ],
      },
    });
    await prisma.agendamento.deleteMany({
      where: {
        OR: [
          { clienteId: { in: [clientAId, clientBId, clientC.cliente!.id, clientD.cliente!.id] } },
          { barbeiroId: barberAId },
        ],
      },
    });
    await prisma.cliente.deleteMany({
      where: { usuarioId: { in: [clientC.id, clientD.id] } },
    });
    await prisma.usuario.deleteMany({
      where: { id: { in: [clientC.id, clientD.id] } },
    });
  });
});
