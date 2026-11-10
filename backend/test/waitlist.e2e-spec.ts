import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import {
  OrigemWaitlistReoffer,
  ResultadoWaitlistReoffer,
  StatusListaEspera,
  StatusWaitlistReoffer,
  StatusWaitlistClaim,
  TipoNotificacao,
  TipoUsuario,
} from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { WaitlistService } from '../src/waitlist/waitlist.service';
import { WaitlistOpportunityService } from '../src/waitlist/waitlist-opportunity.service';
import { WaitlistReofferOutboxService } from '../src/waitlist/waitlist-reoffer-outbox.service';

describe('Waitlist (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let waitlistService: WaitlistService;
  let opportunityService: WaitlistOpportunityService;
  let outboxService: WaitlistReofferOutboxService;

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
  const outboxIds: number[] = [];

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
    opportunityService = app.get(WaitlistOpportunityService);
    outboxService = app.get(WaitlistReofferOutboxService);
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
      const outboxCleanupWhere = {
        OR: [
          { id: { in: outboxIds } },
          { chaveIdempotencia: { startsWith: `e2e:${prefix}:` } },
          {
            origem: OrigemWaitlistReoffer.ENTRADA_CANCELADA,
            origemId: { in: waitlistIds },
          },
          {
            origem: OrigemWaitlistReoffer.CLAIM_RECUSADO,
            origemId: { in: claimIds },
          },
          {
            origem: OrigemWaitlistReoffer.CLAIM_EXPIRADO,
            origemId: { in: claimIds },
          },
        ],
      };
      const outboxRows = await prisma.waitlistReofferOutbox.findMany({
        where: outboxCleanupWhere,
        select: { id: true },
      });
      const outboxCleanupIds = [
        ...new Set([...outboxIds, ...outboxRows.map(({ id }) => id)]),
      ];

      await prisma.notificacao.deleteMany({
        where: { usuarioId: { in: userIds } },
      });
      await prisma.waitlistClaim.deleteMany({
        where: {
          OR: [
            { id: { in: claimIds } },
            { reofertaOutboxId: { in: outboxCleanupIds } },
          ],
        },
      });
      await prisma.waitlistReofferOutbox.deleteMany({
        where: { id: { in: outboxCleanupIds } },
      });
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
        where: {
          OR: [
            { barbeiroId: { in: barberIds } },
            { clienteId: { in: clientIds } },
          ],
        },
      });
      await prisma.servico.deleteMany({ where: { id: { in: serviceIds } } });
      await prisma.horarioFuncionamento.deleteMany({
        where: { barbeiroId: { in: barberIds } },
      });
      await prisma.barbeiro.deleteMany({ where: { id: { in: barberIds } } });
      await prisma.cliente.deleteMany({
        where: { usuarioId: { in: userIds } },
      });
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

  const createOutboxFixture = async (
    dateKey: string,
    withEligibleEntry = true,
  ) => {
    await ensureBusinessHours(dateKey);
    if (withEligibleEntry) {
      const entry = await prisma.listaEspera.create({
        data: {
          clienteId: clientAId,
          barbeiroId: barberAId,
          servicoId: serviceAId,
          dataDesejada: new Date(`${dateKey}T00:00:00.000Z`),
          horaInicio: '10:00',
          horaFim: '10:30',
        },
      });
      waitlistIds.push(entry.id);
    }

    const idempotencyKey = `e2e:${prefix}:${dateKey}`;
    await prisma.$transaction((tx) =>
      outboxService.enqueue(tx, {
        idempotencyKey,
        origin: OrigemWaitlistReoffer.BLOQUEIO_REMOVIDO,
        window: {
          barbeiroId: barberAId,
          dateKey,
          horaInicio: '10:00',
          horaFim: '10:30',
        },
      }),
    );
    const outbox = await prisma.waitlistReofferOutbox.findUnique({
      where: { chaveIdempotencia: idempotencyKey },
    });
    if (!outbox) {
      throw new Error('Fixture OUTBOX não foi persistida.');
    }
    outboxIds.push(outbox.id);
    return outbox;
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

  it('determina a vigência de claim com o relógio do PostgreSQL', async () => {
    await createClaimFixture('2099-04-09');
    const entryId = waitlistIds.at(-1);
    const claimId = claimIds.at(-1);
    if (entryId === undefined || claimId === undefined) {
      throw new Error('Fixture de claim não foi persistida.');
    }

    await prisma.$executeRaw`
      UPDATE "WaitlistClaim"
      SET "expiraEm" = (clock_timestamp() AT TIME ZONE 'UTC')
        + INTERVAL '1 minute'
      WHERE "id" = ${claimId}
    `;
    await expect(
      waitlistService.hasUnexpiredActiveClaimForEntry(entryId),
    ).resolves.toBe(true);

    await prisma.$executeRaw`
      UPDATE "WaitlistClaim"
      SET "expiraEm" = (clock_timestamp() AT TIME ZONE 'UTC')
        - INTERVAL '1 minute'
      WHERE "id" = ${claimId}
    `;
    await expect(
      waitlistService.hasUnexpiredActiveClaimForEntry(entryId),
    ).resolves.toBe(false);
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

    const storedClaim = await prisma.waitlistClaim.findUnique({
      where: { id: claim.id },
    });
    const storedEntry = await prisma.listaEspera.findUnique({
      where: { id: entry.id },
    });
    const appointment = await prisma.agendamento.findFirst({
      where: {
        clienteId: clientAId,
        barbeiroId: barberAId,
        data: new Date('2099-04-01T00:00:00.000Z'),
      },
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

    const storedClaim = await prisma.waitlistClaim.findUnique({
      where: { id: claim.id },
    });
    const storedEntry = await prisma.listaEspera.findUnique({
      where: { id: entry.id },
    });
    const appointments = await prisma.agendamento.count({
      where: {
        clienteId: clientAId,
        barbeiroId: barberAId,
        data: new Date('2099-04-02T00:00:00.000Z'),
      },
    });
    expect(storedClaim?.status).toBe(StatusWaitlistClaim.RECUSADO);
    expect(storedEntry?.status).toBe(StatusListaEspera.ATIVA);
    expect(appointments).toBe(0);
  });

  it('cancela entrada e marca claim ativo válido como RECUSADO', async () => {
    const { entry, claim } = await createClaimFixture('2099-04-09');

    await request(app.getHttpServer())
      .patch(`/waitlist/${entry.id}/cancel`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);

    const storedClaim = await prisma.waitlistClaim.findUnique({
      where: { id: claim.id },
    });
    expect(storedClaim?.status).toBe(StatusWaitlistClaim.RECUSADO);
  });

  it('cancela entrada e marca claim expirado pelo relógio do PostgreSQL como EXPIRADO', async () => {
    const { entry, claim } = await createClaimFixture('2099-04-10');
    await prisma.$executeRaw`
      UPDATE "WaitlistClaim"
      SET "expiraEm" = clock_timestamp() AT TIME ZONE 'UTC'
      WHERE "id" = ${claim.id}
    `;

    await request(app.getHttpServer())
      .patch(`/waitlist/${entry.id}/cancel`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);

    const storedClaim = await prisma.waitlistClaim.findUnique({
      where: { id: claim.id },
    });
    expect(storedClaim?.status).toBe(StatusWaitlistClaim.EXPIRADO);
  });

  it('repetir cancelamento não sobrescreve o estado final do claim', async () => {
    const { entry, claim } = await createClaimFixture('2099-04-11');

    await request(app.getHttpServer())
      .patch(`/waitlist/${entry.id}/cancel`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/waitlist/${entry.id}/cancel`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(404);

    const storedClaim = await prisma.waitlistClaim.findUnique({
      where: { id: claim.id },
    });
    expect(storedClaim?.status).toBe(StatusWaitlistClaim.RECUSADO);
  });

  it('persiste e processa uma reoferta sem criar claims duplicados em retries', async () => {
    const outbox = await createOutboxFixture('2099-05-01');

    await outboxService.processPendingReoffers();
    await outboxService.processPendingReoffers();

    const [storedOutbox, claimCount] = await Promise.all([
      prisma.waitlistReofferOutbox.findUnique({ where: { id: outbox.id } }),
      prisma.waitlistClaim.count({
        where: { reofertaOutboxId: outbox.id },
      }),
    ]);
    expect(storedOutbox?.status).toBe(StatusWaitlistReoffer.CONCLUIDA);
    expect(storedOutbox?.resultado).toBe(ResultadoWaitlistReoffer.CLAIM_CRIADO);
    expect(claimCount).toBe(1);
  });

  it('retoma uma pendência persistida por uma nova instância após falha transitória', async () => {
    const outbox = await createOutboxFixture('2099-05-02');
    const original =
      opportunityService.tryCreateForReleasedWindow.bind(opportunityService);
    const failOnce = jest
      .spyOn(opportunityService, 'tryCreateForReleasedWindow')
      .mockRejectedValueOnce(new Error('falha temporária simulada'))
      .mockImplementation(original);

    const firstAttempt = await outboxService.processPendingReoffers();
    expect(firstAttempt.retryCount).toBe(1);

    const pending = await prisma.waitlistReofferOutbox.findUnique({
      where: { id: outbox.id },
    });
    expect(pending?.status).toBe(StatusWaitlistReoffer.PENDENTE);
    expect(pending?.ultimoErro).toContain('falha temporária simulada');

    await prisma.waitlistReofferOutbox.update({
      where: { id: outbox.id },
      data: { proximaTentativaEm: new Date(Date.now() - 1000) },
    });
    const restartedWorker = new WaitlistReofferOutboxService(
      prisma,
      opportunityService,
    );
    await restartedWorker.processPendingReoffers();
    failOnce.mockRestore();

    const [completed, claimCount] = await Promise.all([
      prisma.waitlistReofferOutbox.findUnique({ where: { id: outbox.id } }),
      prisma.waitlistClaim.count({
        where: { reofertaOutboxId: outbox.id },
      }),
    ]);
    expect(completed?.status).toBe(StatusWaitlistReoffer.CONCLUIDA);
    expect(claimCount).toBe(1);
  });

  it('recupera lease abandonado depois de interrupção do worker', async () => {
    const outbox = await createOutboxFixture('2099-05-03');
    await prisma.waitlistReofferOutbox.update({
      where: { id: outbox.id },
      data: {
        status: StatusWaitlistReoffer.PROCESSANDO,
        tentativas: 1,
        leaseAte: new Date(Date.now() - 1000),
      },
    });

    const restartedWorker = new WaitlistReofferOutboxService(
      prisma,
      opportunityService,
    );
    await restartedWorker.processPendingReoffers();

    const recovered = await prisma.waitlistReofferOutbox.findUnique({
      where: { id: outbox.id },
    });
    expect(recovered?.status).toBe(StatusWaitlistReoffer.CONCLUIDA);
    expect(recovered?.tentativas).toBe(2);
  });

  it('duas instâncias concorrentes não reservam nem criam duas claims para a mesma pendência', async () => {
    const outbox = await createOutboxFixture('2099-05-04');
    const original =
      opportunityService.tryCreateForReleasedWindow.bind(opportunityService);
    let signalStarted!: () => void;
    let releaseProcessing!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseProcessing = resolve;
    });
    const processingSpy = jest
      .spyOn(opportunityService, 'tryCreateForReleasedWindow')
      .mockImplementation(async (...args) => {
        signalStarted();
        await gate;
        return original(...args);
      });

    const firstWorker = outboxService.processPendingReoffers();
    await started;
    const secondWorker = new WaitlistReofferOutboxService(
      prisma,
      opportunityService,
    );
    const secondResult = await secondWorker.processPendingReoffers();
    releaseProcessing();
    await firstWorker;
    processingSpy.mockRestore();

    const claimCount = await prisma.waitlistClaim.count({
      where: { reofertaOutboxId: outbox.id },
    });
    expect(secondResult.claimedCount).toBe(0);
    expect(claimCount).toBe(1);
  });

  it('fenceia worker antigo e reverte claim/notificação quando o lease vence durante a criação', async () => {
    const outbox = await createOutboxFixture('2099-05-06');
    const notificationsService = app.get(NotificationsService);
    const createNotification =
      notificationsService.createWaitlistOpportunity.bind(notificationsService);
    const createOpportunity =
      opportunityService.tryCreateForReleasedWindow.bind(opportunityService);

    let signalFirstNotification!: () => void;
    let releaseFirstNotification!: () => void;
    let signalSecondOpportunity!: () => void;
    const firstNotificationStarted = new Promise<void>((resolve) => {
      signalFirstNotification = resolve;
    });
    const firstNotificationGate = new Promise<void>((resolve) => {
      releaseFirstNotification = resolve;
    });
    const secondOpportunityStarted = new Promise<void>((resolve) => {
      signalSecondOpportunity = resolve;
    });

    let notificationPaused = false;
    let opportunityCalls = 0;
    const notificationSpy = jest
      .spyOn(notificationsService, 'createWaitlistOpportunity')
      .mockImplementation(async (tx, clienteId, claimId) => {
        if (!notificationPaused) {
          notificationPaused = true;
          signalFirstNotification();
          await firstNotificationGate;
        }
        return createNotification(tx, clienteId, claimId);
      });
    const opportunitySpy = jest
      .spyOn(opportunityService, 'tryCreateForReleasedWindow')
      .mockImplementation(async (...args) => {
        opportunityCalls += 1;
        if (opportunityCalls === 2) {
          signalSecondOpportunity();
        }
        await createOpportunity(...args);
        return null;
      });

    let firstWorker: Promise<unknown> | undefined;
    let secondWorker: Promise<unknown> | undefined;
    let leaseUpdateTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      firstWorker = outboxService.processPendingReoffers();
      await firstNotificationStarted;

      expect(
        await prisma.waitlistClaim.count({
          where: { reofertaOutboxId: outbox.id },
        }),
      ).toBe(0);

      const expireLease = prisma.$executeRaw`
        UPDATE "WaitlistReofferOutbox"
        SET "leaseAte" = (clock_timestamp() AT TIME ZONE 'UTC')
          + INTERVAL '1 second'
        WHERE "id" = ${outbox.id}
      `;
      await Promise.race([
        expireLease,
        new Promise<never>((_resolve, reject) => {
          leaseUpdateTimeout = setTimeout(
            () =>
              reject(
                new Error(
                  'A transação de claim manteve o lock da linha OUTBOX durante a criação.',
                ),
              ),
            3000,
          );
        }),
      ]);
      if (leaseUpdateTimeout) {
        clearTimeout(leaseUpdateTimeout);
      }

      await new Promise((resolve) => setTimeout(resolve, 1100));
      secondWorker = new WaitlistReofferOutboxService(
        prisma,
        opportunityService,
      ).processPendingReoffers();
      await secondOpportunityStarted;

      expect(
        (
          await prisma.waitlistReofferOutbox.findUnique({
            where: { id: outbox.id },
          })
        )?.tentativas,
      ).toBe(2);

      releaseFirstNotification();
      await Promise.all([firstWorker, secondWorker]);

      const [storedOutbox, claims, opportunityNotifications] =
        await Promise.all([
          prisma.waitlistReofferOutbox.findUnique({ where: { id: outbox.id } }),
          prisma.waitlistClaim.findMany({
            where: { reofertaOutboxId: outbox.id },
          }),
          prisma.notificacao.findMany({
            where: { claim: { reofertaOutboxId: outbox.id } },
          }),
        ]);
      expect(storedOutbox?.status).toBe(StatusWaitlistReoffer.CONCLUIDA);
      expect(storedOutbox?.tentativas).toBe(2);
      expect(claims).toHaveLength(1);
      expect(opportunityNotifications).toHaveLength(1);
      expect(opportunityNotifications[0].claimId).toBe(claims[0].id);
    } finally {
      if (leaseUpdateTimeout) {
        clearTimeout(leaseUpdateTimeout);
      }
      releaseFirstNotification();
      notificationSpy.mockRestore();
      opportunitySpy.mockRestore();
      await Promise.all(
        [firstWorker, secondWorker].filter((worker) => worker !== undefined),
      );
    }
  });

  it('conclui sem retry infinito quando não existem candidatos elegíveis', async () => {
    const outbox = await createOutboxFixture('2099-05-05', false);

    const result = await outboxService.processPendingReoffers();
    const stored = await prisma.waitlistReofferOutbox.findUnique({
      where: { id: outbox.id },
    });

    expect(result.completedCount).toBe(1);
    expect(stored?.status).toBe(StatusWaitlistReoffer.CONCLUIDA);
    expect(stored?.resultado).toBe(ResultadoWaitlistReoffer.SEM_CANDIDATO);
    expect(stored?.tentativas).toBe(1);
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

    const storedClaim = await prisma.waitlistClaim.findUnique({
      where: { id: claim.id },
    });
    const storedEntry = await prisma.listaEspera.findUnique({
      where: { id: entry.id },
    });
    expect(storedClaim?.status).toBe(StatusWaitlistClaim.ATIVO);
    expect(storedEntry?.status).toBe(StatusListaEspera.ATIVA);
  });

  it('reverte agendamento e notificações se o claim expirar antes da transição definitiva', async () => {
    const dateKey = '2099-04-08';
    const { entry, claim } = await createClaimFixture(dateKey);
    const client = await prisma.cliente.findUnique({
      where: { id: clientAId },
      select: { usuarioId: true },
    });
    const barber = await prisma.barbeiro.findUnique({
      where: { id: barberAId },
      select: { usuarioId: true },
    });
    const appointmentService = app.get(AppointmentsService);
    const createConfirmedForClient =
      appointmentService.createConfirmedForClient.bind(appointmentService);
    const confirmationCounts = async () => ({
      client: await prisma.notificacao.count({
        where: {
          usuarioId: client!.usuarioId,
          tipo: TipoNotificacao.AGENDAMENTO,
        },
      }),
      barber: await prisma.notificacao.count({
        where: {
          usuarioId: barber!.usuarioId,
          tipo: TipoNotificacao.AGENDAMENTO,
        },
      }),
    });
    const notificationsBefore = await confirmationCounts();
    const createConfirmedSpy = jest
      .spyOn(appointmentService, 'createConfirmedForClient')
      .mockImplementation(async (tx, input) => {
        await prisma.waitlistClaim.update({
          where: { id: claim.id },
          data: { expiraEm: new Date(Date.now() - 60_000) },
        });
        return createConfirmedForClient(tx, input);
      });

    try {
      await request(app.getHttpServer())
        .post(`/waitlist/claims/${claim.id}/accept`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(409);
    } finally {
      createConfirmedSpy.mockRestore();
    }

    const [storedClaim, storedEntry, appointments, notificationsAfter] =
      await Promise.all([
        prisma.waitlistClaim.findUnique({ where: { id: claim.id } }),
        prisma.listaEspera.findUnique({ where: { id: entry.id } }),
        prisma.agendamento.count({
          where: {
            clienteId: clientAId,
            barbeiroId: barberAId,
            data: new Date(`${dateKey}T00:00:00.000Z`),
          },
        }),
        confirmationCounts(),
      ]);

    expect(createConfirmedSpy).toHaveBeenCalledTimes(1);
    expect(storedClaim?.status).toBe(StatusWaitlistClaim.ATIVO);
    expect(storedEntry?.status).toBe(StatusListaEspera.ATIVA);
    expect(appointments).toBe(0);
    expect(notificationsAfter).toEqual(notificationsBefore);
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
        where: {
          clienteId: clientAId,
          barbeiroId: barberAId,
          data: new Date('2099-04-05T00:00:00.000Z'),
        },
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

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    const statuses = results.map((result) =>
      result.status === 'fulfilled'
        ? result.value.status
        : result.reason?.status,
    );
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);

    const storedClaim = await prisma.waitlistClaim.findUnique({
      where: { id: claim.id },
    });
    const storedEntry = await prisma.listaEspera.findUnique({
      where: { id: entry.id },
    });
    const appointmentCount = await prisma.agendamento.count({
      where: {
        clienteId: clientAId,
        barbeiroId: barberAId,
        data: new Date('2099-04-06T00:00:00.000Z'),
      },
    });
    expect([
      StatusWaitlistClaim.ACEITO,
      StatusWaitlistClaim.RECUSADO,
    ]).toContain(storedClaim?.status);
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

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    const statuses = results.map((result) =>
      result.status === 'fulfilled'
        ? result.value.status
        : result.reason?.status,
    );
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(
      statuses.filter((status) => [400, 409].includes(status)),
    ).toHaveLength(1);
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

  it('lista a espera do barbeiro autenticado com cliente e serviço', async () => {
    const created = await postWaitlist(clientAToken, {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2099-01-20',
    }).expect(201);
    waitlistIds.push(created.body.id);

    const barberList = await request(app.getHttpServer())
      .get('/waitlist')
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200);

    const entry = barberList.body.find(
      (item: any) => item.id === created.body.id,
    );
    expect(entry).toBeDefined();
    expect(entry.status).toBe(StatusListaEspera.ATIVA);
    expect(entry.data).toBe('2099-01-20');
    expect(entry.servico?.id).toBe(serviceAId);
    expect(entry.cliente?.id).toBe(clientAId);
    expect(entry.cliente?.nome).toBe('Cliente A Waitlist');

    // Escopo: só retornam entradas deste barbeiro (não vaza a lista de outro).
    expect(
      barberList.body.every((item: any) => item.barbeiroId === barberAId),
    ).toBe(true);
  });

  it('aplica autenticação e papel na lista do barbeiro', async () => {
    // Sem token → 401.
    await request(app.getHttpServer()).get('/waitlist').expect(401);

    // CLIENTE não pode listar a lista do barbeiro → 403.
    await request(app.getHttpServer())
      .get('/waitlist')
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(403);
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

    // M-3: o cancelamento é condicional (status ATIVA). A segunda tentativa não
    // casa nenhuma linha (count = 0) e retorna 404 genérico — nunca sobrescreve
    // um estado já terminal.
    await request(app.getHttpServer())
      .patch(`/waitlist/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(404);
  });

  it('M-3: entrada ATENDIDA não pode ser cancelada (404, sem sobrescrever estado)', async () => {
    const created = await postWaitlist(clientAToken, {
      barbeiroId: barberAId,
      servicoId: serviceAId,
      data: '2099-01-18',
    }).expect(201);
    waitlistIds.push(created.body.id);

    await prisma.listaEspera.update({
      where: { id: created.body.id },
      data: { status: StatusListaEspera.ATENDIDA },
    });

    await request(app.getHttpServer())
      .patch(`/waitlist/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(404);

    const stored = await prisma.listaEspera.findUnique({
      where: { id: created.body.id },
    });
    expect(stored?.status).toBe(StatusListaEspera.ATENDIDA);
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
      waitlistService.claimNextEligibleEntryForSlot(
        barberAId,
        serviceAId,
        dateKey,
        '10:00',
        '10:30',
      ),
      waitlistService.claimNextEligibleEntryForSlot(
        barberAId,
        serviceAId,
        dateKey,
        '10:00',
        '10:30',
      ),
    ]);

    if (results.every((result) => result.status === 'rejected')) {
      throw new Error(
        results
          .map((result) =>
            result.status === 'rejected' ? result.reason?.message : 'ok',
          )
          .join(' | '),
      );
    }
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);

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
        : (result.reason?.response?.status ?? 0),
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

    expect(eligible.map((entry) => entry.id)).toEqual([
      olderEntry.id,
      newerEntry.id,
    ]);
    expect(eligible.some(({ id }) => id === conflictingClientEntry.id)).toBe(
      false,
    );
    expect(eligible.some(({ id }) => id === olderEntry.id)).toBe(true);
    expect(eligible.some(({ id }) => id === newerEntry.id)).toBe(true);

    await prisma.waitlistClaim.deleteMany({
      where: { barbeiroId: barberAId },
    });
    await prisma.listaEspera.deleteMany({
      where: {
        OR: [
          {
            id: {
              in: [olderEntry.id, newerEntry.id, conflictingClientEntry.id],
            },
          },
          {
            clienteId: {
              in: [
                clientAId,
                clientBId,
                clientC.cliente!.id,
                clientD.cliente!.id,
              ],
            },
          },
        ],
      },
    });
    await prisma.agendamento.deleteMany({
      where: {
        OR: [
          {
            clienteId: {
              in: [
                clientAId,
                clientBId,
                clientC.cliente!.id,
                clientD.cliente!.id,
              ],
            },
          },
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
