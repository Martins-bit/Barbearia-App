import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import {
  StatusListaEspera,
  StatusWaitlistClaim,
  TipoNotificacao,
  TipoUsuario,
} from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { getZonedParts } from '../src/schedule/tz.util';
import { PrismaService } from '../src/prisma/prisma.service';

 describe('Waitlist opportunity orchestration (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clientToken: string;
  let barberToken: string;
  let clientId: number;
  let barberId: number;
  let service30Id: number;
  let service60Id: number;
  const userIds: number[] = [];
  const clientIds: number[] = [];
  const barberIds: number[] = [];
  const serviceIds: number[] = [];
  const appointmentIds: number[] = [];
  const waitlistIds: number[] = [];
  const claimIds: number[] = [];
  const notificationIds: number[] = [];
  const blockIds: number[] = [];
  const prefix = `opportunity-e2e-${Date.now()}`;
  const phoneBase = String(Date.now()).slice(-8);
  const password = 'opportunity-e2e-password';

  function futureDateKey(offsetDays: number): string {
    const parts = getZonedParts(new Date());
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays));
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  async function login(phone: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ telefone: phone, senha: password })
      .expect(200);
    return response.body.token as string;
  }

  async function createWaitlist(dateKey: string, serviceId = service30Id) {
    const entry = await prisma.listaEspera.create({
      data: {
        clienteId: clientId,
        barbeiroId: barberId,
        servicoId: serviceId,
        dataDesejada: new Date(`${dateKey}T00:00:00.000Z`),
        horaInicio: '09:00',
        horaFim: '18:00',
      },
    });
    waitlistIds.push(entry.id);
    return entry;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }));
    await app.init();
    prisma = app.get(PrismaService);
    const senhaHash = await hashPassword(password);

    const client = await prisma.usuario.create({
      data: {
        nome: 'Cliente Opportunity',
        telefone: `${phoneBase}61`,
        senhaHash,
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
      include: { cliente: true },
    });
    userIds.push(client.id);
    clientId = client.cliente!.id;
    clientIds.push(clientId);

    const barber = await prisma.usuario.create({
      data: {
        nome: 'Barbeiro Opportunity',
        telefone: `${phoneBase}62`,
        senhaHash,
        tipoUsuario: TipoUsuario.BARBEIRO,
        barbeiro: { create: {} },
      },
      include: { barbeiro: true },
    });
    userIds.push(barber.id);
    barberId = barber.barbeiro!.id;
    barberIds.push(barberId);

    const service30 = await prisma.servico.create({
      data: {
        barbeiroId: barberId,
        nome: `${prefix}-30`,
        duracaoMinutos: 30,
        preco: '30.00',
        ativo: true,
      },
    });
    const service60 = await prisma.servico.create({
      data: {
        barbeiroId: barberId,
        nome: `${prefix}-60`,
        duracaoMinutos: 60,
        preco: '60.00',
        ativo: true,
      },
    });
    service30Id = service30.id;
    service60Id = service60.id;
    serviceIds.push(service30Id, service60Id);

    await prisma.horarioFuncionamento.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({
        barbeiroId: barberId,
        diaSemana,
        horaInicio: '09:00',
        horaFim: '18:00',
        ativo: true,
      })),
    });

    clientToken = await login(client.telefone);
    barberToken = await login(barber.telefone);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.notificacao.deleteMany({ where: { OR: [{ id: { in: notificationIds } }, { usuarioId: { in: userIds } }] } });
      await prisma.agendamento.deleteMany({ where: { OR: [{ id: { in: appointmentIds } }, { clienteId: { in: clientIds } }, { barbeiroId: { in: barberIds } }] } });
      await prisma.waitlistClaim.deleteMany({ where: { OR: [{ id: { in: claimIds } }, { barbeiroId: { in: barberIds } }] } });
      await prisma.listaEspera.deleteMany({ where: { OR: [{ id: { in: waitlistIds } }, { clienteId: { in: clientIds } }] } });
      await prisma.bloqueioAgenda.deleteMany({ where: { OR: [{ id: { in: blockIds } }, { barbeiroId: { in: barberIds } }] } });
      await prisma.horarioFuncionamento.deleteMany({ where: { barbeiroId: { in: barberIds } } });
      await prisma.servico.deleteMany({ where: { id: { in: serviceIds } } });
      await prisma.barbeiro.deleteMany({ where: { id: { in: barberIds } } });
      await prisma.cliente.deleteMany({ where: { id: { in: clientIds } } });
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  it('cancelamento libera janela maior, encontra serviço menor e cria claim/notificação', async () => {
    const dateKey = futureDateKey(20);
    const appointment = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ barbeiroId: barberId, servicoId: service60Id, data: dateKey, horaInicio: '10:00' })
      .expect(201);
    appointmentIds.push(appointment.body.id);
    const entry = await createWaitlist(dateKey, service30Id);

    await request(app.getHttpServer())
      .patch(`/appointments/${appointment.body.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    const claim = await prisma.waitlistClaim.findFirst({
      where: { listaEsperaId: entry.id, status: StatusWaitlistClaim.ATIVO },
    });
    expect(claim).toBeTruthy();
    expect(claim?.horaInicio).toBe('10:00');
    expect(claim?.horaFim).toBe('10:30');
    claimIds.push(claim!.id);

    const notification = await prisma.notificacao.findFirst({ where: { claimId: claim!.id } });
    expect(notification?.tipo).toBe(TipoNotificacao.WAITLIST_OPPORTUNITY);
    notificationIds.push(notification!.id);
  });

  it('cancelamento sem candidato continua sucesso', async () => {
    const dateKey = futureDateKey(21);
    const appointment = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ barbeiroId: barberId, servicoId: service30Id, data: dateKey, horaInicio: '12:00' })
      .expect(201);
    appointmentIds.push(appointment.body.id);

    await request(app.getHttpServer())
      .patch(`/appointments/${appointment.body.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);
    expect(await prisma.waitlistClaim.count({ where: { data: new Date(`${dateKey}T00:00:00.000Z`) } })).toBe(0);
  });

  it('remoção de bloqueio cria claim e notificação', async () => {
    const dateKey = futureDateKey(22);
    const entry = await createWaitlist(dateKey, service30Id);
    const block = await request(app.getHttpServer())
      .post('/schedule-blocks')
      .set('Authorization', `Bearer ${barberToken}`)
      .send({ data: dateKey, horaInicio: '14:00', horaFim: '15:00' })
      .expect(201);
    blockIds.push(block.body.id);

    await request(app.getHttpServer())
      .delete(`/schedule-blocks/${block.body.id}`)
      .set('Authorization', `Bearer ${barberToken}`)
      .expect(200);

    const claim = await prisma.waitlistClaim.findFirst({
      where: { listaEsperaId: entry.id, status: StatusWaitlistClaim.ATIVO },
    });
    expect(claim).toBeTruthy();
    expect(claim?.horaInicio).toBe('14:00');
    expect(claim?.horaFim).toBe('14:30');
    claimIds.push(claim!.id);
    const notification = await prisma.notificacao.findFirst({ where: { claimId: claim!.id } });
    expect(notification?.tipo).toBe(TipoNotificacao.WAITLIST_OPPORTUNITY);
    notificationIds.push(notification!.id);
  });

  it('remoção de bloqueio sem candidato continua sucesso', async () => {
    const dateKey = futureDateKey(23);
    const block = await request(app.getHttpServer())
      .post('/schedule-blocks')
      .set('Authorization', `Bearer ${barberToken}`)
      .send({ data: dateKey, horaInicio: '15:00', horaFim: '16:00' })
      .expect(201);
    blockIds.push(block.body.id);

    await request(app.getHttpServer())
      .delete(`/schedule-blocks/${block.body.id}`)
      .set('Authorization', `Bearer ${barberToken}`)
      .expect(200);
    expect(await prisma.waitlistClaim.count({ where: { data: new Date(`${dateKey}T00:00:00.000Z`) } })).toBe(0);
  });

  it('corrida entre cancelamento e novo appointment não cria claim inválido', async () => {
    const dateKey = futureDateKey(24);
    const appointment = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ barbeiroId: barberId, servicoId: service30Id, data: dateKey, horaInicio: '10:00' })
      .expect(201);
    appointmentIds.push(appointment.body.id);
    await createWaitlist(dateKey, service30Id);

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .patch(`/appointments/${appointment.body.id}/cancel`)
        .set('Authorization', `Bearer ${clientToken}`),
      request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ barbeiroId: barberId, servicoId: service30Id, data: dateKey, horaInicio: '10:00' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const confirmed = await prisma.agendamento.count({
      where: {
        barbeiroId: barberId,
        data: new Date(`${dateKey}T00:00:00.000Z`),
        status: 'CONFIRMADO',
      },
    });
    const activeClaims = await prisma.waitlistClaim.count({
      where: {
        barbeiroId: barberId,
        data: new Date(`${dateKey}T00:00:00.000Z`),
        status: StatusWaitlistClaim.ATIVO,
        expiraEm: { gt: new Date() },
      },
    });
    expect(confirmed + activeClaims).toBeLessThanOrEqual(1);
  });
});
