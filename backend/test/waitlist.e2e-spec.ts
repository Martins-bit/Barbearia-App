import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { StatusListaEspera, TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Waitlist (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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
      await prisma.servico.deleteMany({ where: { id: { in: serviceIds } } });
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
});
