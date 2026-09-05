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
import { PrismaService } from '../src/prisma/prisma.service';
import { WaitlistService } from '../src/waitlist/waitlist.service';

 describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let waitlistService: WaitlistService;
  let clientAToken: string;
  let clientBToken: string;
  let clientAId: number;
  let clientBId: number;
  let clientAUserId: number;
  let clientBUserId: number;
  let barberId: number;
  let serviceId: number;
  let claimId: number;
  let waitlistId: number;
  const userIds: number[] = [];
  const clientIds: number[] = [];
  const notificationIds: number[] = [];
  const claimIds: number[] = [];
  const waitlistIds: number[] = [];
  const serviceIds: number[] = [];
  const barberIds: number[] = [];
  const prefix = `notification-e2e-${Date.now()}`;
  const phoneBase = String(Date.now()).slice(-8);
  const password = 'notification-e2e-password';

  const createUser = async (name: string, phone: string) => {
    const user = await prisma.usuario.create({
      data: {
        nome: name,
        telefone: phone,
        senhaHash: await hashPassword(password),
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
      include: { cliente: true },
    });
    userIds.push(user.id);
    clientIds.push(user.cliente!.id);
    return { userId: user.id, clientId: user.cliente!.id, phone };
  };

  const login = async (phone: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ telefone: phone, senha: password })
      .expect(200);
    return response.body.token as string;
  };

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

    const clientA = await createUser('Cliente A Notifications', `${phoneBase}51`);
    const clientB = await createUser('Cliente B Notifications', `${phoneBase}52`);
    clientAId = clientA.clientId;
    clientBId = clientB.clientId;
    clientAUserId = clientA.userId;
    clientBUserId = clientB.userId;

    const barber = await prisma.usuario.create({
      data: {
        nome: 'Barbeiro Notifications',
        telefone: `${phoneBase}53`,
        senhaHash: await hashPassword(password),
        tipoUsuario: TipoUsuario.BARBEIRO,
        barbeiro: { create: {} },
      },
      include: { barbeiro: true },
    });
    userIds.push(barber.id);
    barberId = barber.barbeiro!.id;
    barberIds.push(barberId);

    const service = await prisma.servico.create({
      data: {
        barbeiroId: barberId,
        nome: `${prefix}-service`,
        duracaoMinutos: 30,
        preco: '30.00',
        ativo: true,
      },
    });
    serviceId = service.id;
    serviceIds.push(serviceId);

    await prisma.horarioFuncionamento.create({
      data: {
        barbeiroId: barberId,
        diaSemana: new Date('2099-05-10T00:00:00.000Z').getUTCDay(),
        horaInicio: '08:00',
        horaFim: '18:00',
        ativo: true,
      },
    });

    clientAToken = await login(clientA.phone);
    clientBToken = await login(clientB.phone);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.notificacao.deleteMany({ where: { OR: [{ id: { in: notificationIds } }, { usuarioId: { in: userIds } }] } });
      await prisma.agendamento.deleteMany({ where: { OR: [{ clienteId: { in: clientIds } }, { barbeiroId: { in: barberIds } }] } });
      await prisma.waitlistClaim.deleteMany({ where: { OR: [{ id: { in: claimIds } }, { barbeiroId: { in: barberIds } }] } });
      await prisma.listaEspera.deleteMany({ where: { OR: [{ id: { in: waitlistIds } }, { clienteId: { in: clientIds } }] } });
      await prisma.horarioFuncionamento.deleteMany({ where: { barbeiroId: { in: barberIds } } });
      await prisma.servico.deleteMany({ where: { id: { in: serviceIds } } });
      await prisma.barbeiro.deleteMany({ where: { id: { in: barberIds } } });
      await prisma.cliente.deleteMany({ where: { id: { in: clientIds } } });
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) {
      await app.close();
    }
  });

  const createClaimFixture = async (dateKey: string, clienteId = clientAId) => {
    const entry = await prisma.listaEspera.create({
      data: {
        clienteId,
        barbeiroId: barberId,
        servicoId: serviceId,
        dataDesejada: new Date(`${dateKey}T00:00:00.000Z`),
        horaInicio: '08:00',
        horaFim: '18:00',
      },
    });
    waitlistIds.push(entry.id);
    const claim = await prisma.waitlistClaim.create({
      data: {
        listaEsperaId: entry.id,
        barbeiroId: barberId,
        servicoId: serviceId,
        data: new Date(`${dateKey}T00:00:00.000Z`),
        horaInicio: '10:00',
        horaFim: '10:30',
        status: StatusWaitlistClaim.ATIVO,
        expiraEm: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    claimIds.push(claim.id);
    return { entry, claim };
  };

  const createEntryFixture = async (dateKey: string, clienteId: number) => {
    await prisma.horarioFuncionamento.create({
      data: {
        barbeiroId: barberId,
        diaSemana: new Date(`${dateKey}T00:00:00.000Z`).getUTCDay(),
        horaInicio: '08:00',
        horaFim: '18:00',
        ativo: true,
      },
    });
    const entry = await prisma.listaEspera.create({
      data: {
        clienteId,
        barbeiroId: barberId,
        servicoId: serviceId,
        dataDesejada: new Date(`${dateKey}T00:00:00.000Z`),
        horaInicio: '08:00',
        horaFim: '18:00',
      },
    });
    waitlistIds.push(entry.id);
    return entry;
  };

  it('cria uma notificação ao criar claim válido', async () => {
    const dateKey = '2099-05-10';
    await prisma.listaEspera.create({
      data: {
        clienteId: clientAId,
        barbeiroId: barberId,
        servicoId: serviceId,
        dataDesejada: new Date(`${dateKey}T00:00:00.000Z`),
        horaInicio: '08:00',
        horaFim: '18:00',
      },
    }).then((entry) => {
      waitlistIds.push(entry.id);
    });

    const claim = await waitlistService.claimNextEligibleEntryForSlot(
      barberId,
      serviceId,
      dateKey,
      '10:00',
      '10:30',
    );
    claimId = claim.id;
    claimIds.push(claim.id);

    const notifications = await prisma.notificacao.findMany({
      where: { claimId: claim.id },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].usuarioId).toBe(clientAUserId);
    expect(notifications[0].tipo).toBe(TipoNotificacao.WAITLIST_OPPORTUNITY);
    notificationIds.push(notifications[0].id);
  });

  it('lista próprias notificações, conta não lidas e protege ownership', async () => {
    const own = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);
    expect(own.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimId, lida: false }),
    ]));
    expect(own.body.every((item: any) => item.usuarioId === undefined)).toBe(true);

    await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${clientBToken}`)
      .expect(200)
      .then((response) => expect(response.body).toEqual([]));

    await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200)
      .then((response) => expect(response.body.count).toBe(1));

    const notification = await prisma.notificacao.findFirst({ where: { claimId } });
    notificationIds.push(notification!.id);
    await request(app.getHttpServer())
      .patch(`/notifications/${notification!.id}/read`)
      .set('Authorization', `Bearer ${clientBToken}`)
      .expect(404);
  });

  it('marca como lida de forma idempotente e marca todas as próprias', async () => {
    const notification = await prisma.notificacao.findFirst({ where: { claimId } });
    const firstRead = await request(app.getHttpServer())
      .patch(`/notifications/${notification!.id}/read`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);
    expect(firstRead.body.lida).toBe(true);
    expect(firstRead.body.dataLeitura).toBeTruthy();

    const secondRead = await request(app.getHttpServer())
      .patch(`/notifications/${notification!.id}/read`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);
    expect(secondRead.body.lida).toBe(true);
    expect(secondRead.body.dataLeitura).toBe(firstRead.body.dataLeitura);

    const other = await prisma.notificacao.create({
      data: {
        usuarioId: clientAUserId,
        tipo: TipoNotificacao.AVISO,
        titulo: 'Aviso de teste',
        mensagem: 'Mensagem de teste',
      },
    });
    notificationIds.push(other.id);
    await prisma.notificacao.create({
      data: {
        usuarioId: clientBUserId,
        tipo: TipoNotificacao.AVISO,
        titulo: 'Aviso de outro usuário',
        mensagem: 'Mensagem de teste',
      },
    }).then((created) => notificationIds.push(created.id));

    await request(app.getHttpServer())
      .patch('/notifications/read-all')
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200)
      .then((response) => expect(response.body.updated).toBe(1));
    expect((await prisma.notificacao.findUnique({ where: { id: other.id } }))?.lida).toBe(true);
  });

  it('concorrência de claims cria um claim e uma notificação', async () => {
    const dateKey = '2099-05-11';
    const first = await createEntryFixture(dateKey, clientAId);
    const second = await createEntryFixture(dateKey, clientBId);
    const results = await Promise.allSettled([
      waitlistService.claimNextEligibleEntryForSlot(barberId, serviceId, dateKey, '10:00', '10:30'),
      waitlistService.claimNextEligibleEntryForSlot(barberId, serviceId, dateKey, '10:00', '10:30'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const activeClaims = await prisma.waitlistClaim.findMany({
      where: {
        barbeiroId: barberId,
        servicoId: serviceId,
        data: new Date(`${dateKey}T00:00:00.000Z`),
        horaInicio: '10:00',
        horaFim: '10:30',
        status: StatusWaitlistClaim.ATIVO,
        expiraEm: { gt: new Date() },
      },
    });
    expect(activeClaims).toHaveLength(1);
    expect(await prisma.notificacao.count({ where: { claimId: activeClaims[0].id } })).toBe(1);
    expect([first.id, second.id]).toContain(activeClaims[0].listaEsperaId);
  });
});
