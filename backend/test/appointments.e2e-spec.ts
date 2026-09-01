import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { StatusAgendamento, TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { getZonedParts, zonedWallTimeToUtc } from '../src/schedule/tz.util';

describe('Appointments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let clientAToken: string;
  let clientBToken: string;
  let barberAToken: string;
  let barberBToken: string;

  let clientAClienteId: number;
  let clientBClienteId: number;
  let barberAId: number;
  let barberBId: number;

  let svcA30Id: number;
  let svcAInactiveId: number;
  let svcB30Id: number;

  const userIds: number[] = [];
  const clienteIds: number[] = [];
  const barberIds: number[] = [];
  const serviceIds: number[] = [];
  const blockIds: number[] = [];
  const appointmentIds: number[] = [];

  const password = 'appt-e2e-password';
  const prefix = `appt-e2e-${Date.now()}`;
  const phoneBase = String(Date.now()).slice(-8);

  // Datas futuras DETERMINÍSTICAS: hoje (America/Sao_Paulo) + offset de dias.
  // Nunca usar datas fixas: virariam passado e quebrariam os testes no futuro.
  function futureDateKey(offsetDays: number): string {
    const p = getZonedParts(new Date());
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + offsetDays));
    const pad = (v: number): string => String(v).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  const FUTURE_A = futureDateKey(2); // +2 dias
  const FUTURE_B = futureDateKey(9); // +9 dias
  const PAST = '2020-01-06'; // fixa no passado: permanece rejeitada para sempre
  const IMPOSSIBLE = '2099-02-30'; // 30 de fevereiro não existe

  // Todos os 7 dias 09:00–18:00 → qualquer data futura dos testes é válida.
  const fullWeek = {
    horarios: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({
      diaSemana,
      horaInicio: '09:00',
      horaFim: '18:00',
    })),
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Espelha exatamente a configuração do pipe global de main.ts.
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
      clienteIds.push(cliente!.id);
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

    const clientA = await createClient('Cliente A Appt', `${phoneBase}41`);
    const clientB = await createClient('Cliente B Appt', `${phoneBase}42`);
    const barberA = await createBarber('Barbeiro A Appt', `${phoneBase}43`);
    const barberB = await createBarber('Barbeiro B Appt', `${phoneBase}44`);

    clientAClienteId = clientA.clienteId;
    clientBClienteId = clientB.clienteId;
    barberAId = barberA.barbeiroId;
    barberBId = barberB.barbeiroId;

    const createService = async (
      barbeiroId: number,
      nome: string,
      ativo: boolean,
    ) => {
      const service = await prisma.servico.create({
        data: {
          barbeiroId,
          nome,
          descricao: 'Serviço do e2e de Appointments',
          duracaoMinutos: 30,
          preco: '30.00',
          ativo,
        },
      });
      serviceIds.push(service.id);
      return service;
    };

    svcA30Id = (
      await createService(barberAId, `${prefix}-corte-a`, true)
    ).id;
    svcAInactiveId = (
      await createService(barberAId, `${prefix}-inativo`, false)
    ).id;
    svcB30Id = (await createService(barberBId, `${prefix}-barba-b`, true)).id;

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

    // Horários de funcionamento dos DOIS barbeiros (7 dias, 09:00–18:00).
    for (const token of [barberAToken, barberBToken]) {
      await request(app.getHttpServer())
        .put('/business-hours')
        .set('Authorization', `Bearer ${token}`)
        .send(fullWeek)
        .expect(200);
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.agendamento.deleteMany({
        where: {
          OR: [
            { id: { in: appointmentIds } },
            { barbeiroId: { in: barberIds } },
            { clienteId: { in: clienteIds } },
          ],
        },
      });
      await prisma.bloqueioAgenda.deleteMany({
        where: { barbeiroId: { in: barberIds } },
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


  // -------------------------------------------------------------------
  // POST /appointments
  // -------------------------------------------------------------------
  const postAppointment = (token: string, payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

  it('exige JWT para criar agendamento', async () => {
    await request(app.getHttpServer())
      .post('/appointments')
      .send({
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: FUTURE_A,
        horaInicio: '10:00',
      })
      .expect(401);
  });

  it('BARBEIRO recebe 403 ao tentar criar agendamento', async () => {
    await postAppointment(barberAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: FUTURE_A,
      horaInicio: '10:00',
    }).expect(403);
  });

  it('CLIENTE cria agendamento válido → 201 CONFIRMADO com formato seguro', async () => {
    const response = await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: FUTURE_A,
      horaInicio: '10:00',
      observacoes: 'Chegar 5 minutos antes.',
    }).expect(201);

    appointmentIds.push(response.body.id);

    expect(response.body).toEqual({
      id: expect.any(Number),
      data: FUTURE_A,
      horaInicio: '10:00',
      horaFim: '10:30',
      duracaoMinutos: 30,
      status: 'CONFIRMADO',
      observacoes: 'Chegar 5 minutos antes.',
      servico: {
        id: svcA30Id,
        nome: `${prefix}-corte-a`,
        precoInformativo: '30.00',
      },
      barbeiro: { id: barberAId, nome: 'Barbeiro A Appt' },
      cliente: { id: clientAClienteId, nome: 'Cliente A Appt' },
    });

    // Formato seguro: EXATAMENTE estas chaves — sem campos internos/financeiros.
    expect(Object.keys(response.body).sort()).toEqual([
      'barbeiro',
      'cliente',
      'data',
      'duracaoMinutos',
      'horaFim',
      'horaInicio',
      'id',
      'observacoes',
      'servico',
      'status',
    ]);
    expect(Object.keys(response.body.servico).sort()).toEqual([
      'id',
      'nome',
      'precoInformativo',
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(
      /senhaHash|dataCriacao|dataAtualizacao|pagamento|pix|checkout/i,
    );
  });

  it('clienteId enviado no body é rejeitado pelo ValidationPipe', async () => {
    await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: FUTURE_A,
      horaInicio: '11:00',
      clienteId: 999,
    }).expect(400);
  });

  it('status enviado pelo frontend é rejeitado', async () => {
    await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: FUTURE_A,
      horaInicio: '11:00',
      status: 'CANCELADO',
    }).expect(400);
  });

  it('conflito com bloqueio ativo retorna 400', async () => {
    const block = await request(app.getHttpServer())
      .post('/schedule-blocks')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({
        data: FUTURE_A,
        horaInicio: '15:00',
        horaFim: '15:30',
        motivo: 'Manutenção',
      })
      .expect(201);
    blockIds.push(block.body.id);

    const response = await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: FUTURE_A,
      horaInicio: '15:00',
    }).expect(400);
    expect(response.body.message).toBe('Horário bloqueado.');
  });

  it('agendamento CONFIRMADO do barbeiro retorna 409', async () => {
    const response = await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: FUTURE_A,
      horaInicio: '10:00', // já ocupado pelo primeiro agendamento
    }).expect(409);
    expect(response.body.message).toBe('Horário não está mais disponível.');
  });

  it('conflito do PRÓPRIO CLIENTE em outro barbeiro retorna 409', async () => {
    const response = await postAppointment(clientAToken, {
      barbeiroId: barberBId,
      servicoId: svcB30Id,
      data: FUTURE_A,
      horaInicio: '10:15', // 10:15–10:45 sobrepõe 10:00–10:30 do cliente
    }).expect(409);
    expect(response.body.message).toBe(
      'Horário não está disponível para o cliente.',
    );
  });

  it('slot adjacente (10:30) é permitido', async () => {
    const response = await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: FUTURE_A,
      horaInicio: '10:30',
    }).expect(201);

    appointmentIds.push(response.body.id);
    expect(response.body.status).toBe('CONFIRMADO');
    expect(response.body.horaFim).toBe('11:00');
  });

  it('serviço de outro barbeiro retorna 404', async () => {
    await postAppointment(clientAToken, {
      barbeiroId: barberBId,
      servicoId: svcA30Id, // serviço pertence ao barbeiro A
      data: FUTURE_A,
      horaInicio: '12:00',
    }).expect(404);
  });

  it('serviço inativo retorna 404', async () => {
    await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcAInactiveId,
      data: FUTURE_A,
      horaInicio: '12:00',
    }).expect(404);
  });

  it('fora do horário de funcionamento retorna 400', async () => {
    await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: FUTURE_A,
      horaInicio: '07:00',
    }).expect(400);
  });

  it('horário no passado retorna 400', async () => {
    await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: PAST,
      horaInicio: '10:00',
    }).expect(400);
  });

  it('data impossível retorna 400', async () => {
    await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: IMPOSSIBLE,
      horaInicio: '10:00',
    }).expect(400);
  });

  it('hora fora da grade de 15 minutos retorna 400', async () => {
    await postAppointment(clientAToken, {
      barbeiroId: barberAId,
      servicoId: svcA30Id,
      data: FUTURE_A,
      horaInicio: '10:07',
    }).expect(400);
  });



  it('exige JWT para listar meus agendamentos', async () => {
    await request(app.getHttpServer()).get('/appointments/my').expect(401);
  });

  it('BARBEIRO recebe 403 ao listar agendamentos do cliente', async () => {
    await request(app.getHttpServer())
      .get('/appointments/my')
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(403);
  });

  it('CLIENTE recebe somente os próprios agendamentos, em ordem cronológica e sem dados sensíveis', async () => {
    const ownDate = futureDateKey(5);

    const ownA = await prisma.agendamento.create({
      data: {
        clienteId: clientAClienteId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${ownDate}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(ownDate, '11:00'),
        horaFim: zonedWallTimeToUtc(ownDate, '11:30'),
        status: StatusAgendamento.CONFIRMADO,
        observacoes: 'Primeiro',
      },
    });
    appointmentIds.push(ownA.id);

    const ownB = await prisma.agendamento.create({
      data: {
        clienteId: clientAClienteId,
        barbeiroId: barberBId,
        servicoId: svcB30Id,
        data: new Date(`${ownDate}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(ownDate, '12:00'),
        horaFim: zonedWallTimeToUtc(ownDate, '12:30'),
        status: StatusAgendamento.CANCELADO,
        observacoes: 'Cancelado',
      },
    });
    appointmentIds.push(ownB.id);

    const other = await prisma.agendamento.create({
      data: {
        clienteId: clientBClienteId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${ownDate}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(ownDate, '13:00'),
        horaFim: zonedWallTimeToUtc(ownDate, '13:30'),
        status: StatusAgendamento.CONFIRMADO,
        observacoes: 'Outro cliente',
      },
    });
    appointmentIds.push(other.id);

    const response = await request(app.getHttpServer())
      .get('/appointments/my')
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ownA.id,
          data: ownDate,
          horaInicio: '11:00',
          horaFim: '11:30',
          status: 'CONFIRMADO',
          observacoes: 'Primeiro',
          servico: {
            id: svcA30Id,
            nome: `${prefix}-corte-a`,
            precoInformativo: '30.00',
          },
          barbeiro: { id: barberAId, nome: 'Barbeiro A Appt' },
          cliente: { id: clientAClienteId, nome: 'Cliente A Appt' },
        }),
        expect.objectContaining({
          id: ownB.id,
          data: ownDate,
          horaInicio: '12:00',
          horaFim: '12:30',
          status: 'CANCELADO',
          observacoes: 'Cancelado',
        }),
      ]),
    );

    const ownIds = response.body
      .filter((item: any) => [ownA.id, ownB.id].includes(item.id))
      .map((item: any) => item.id);

    expect(ownIds).toEqual([ownA.id, ownB.id]);
    expect(
      response.body.every((item: any) => item.cliente.id === clientAClienteId),
    ).toBe(true);
    expect(response.body.some((item: any) => item.id === other.id)).toBe(false);
    expect(JSON.stringify(response.body)).not.toMatch(
      /senhaHash|pagamento|pix|checkout|clienteId|status\s*:/i,
    );
    expect(response.body[0].servico.precoInformativo).toMatch(/^\d+\.\d{2}$/);
  });

  it('inclui diferentes status do mesmo cliente na listagem', async () => {
    const statusDate = futureDateKey(6);

    const created = [] as any[];
    created.push(
      await prisma.agendamento.create({
        data: {
          clienteId: clientAClienteId,
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: new Date(`${statusDate}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(statusDate, '09:00'),
          horaFim: zonedWallTimeToUtc(statusDate, '09:30'),
          status: StatusAgendamento.CONFIRMADO,
          observacoes: 'confirmado',
        },
      }),
    );
    created.push(
      await prisma.agendamento.create({
        data: {
          clienteId: clientAClienteId,
          barbeiroId: barberBId,
          servicoId: svcB30Id,
          data: new Date(`${statusDate}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(statusDate, '09:30'),
          horaFim: zonedWallTimeToUtc(statusDate, '10:00'),
          status: StatusAgendamento.CONCLUIDO,
          observacoes: 'concluido',
        },
      }),
    );
    created.push(
      await prisma.agendamento.create({
        data: {
          clienteId: clientAClienteId,
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: new Date(`${statusDate}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(statusDate, '10:00'),
          horaFim: zonedWallTimeToUtc(statusDate, '10:30'),
          status: StatusAgendamento.NAO_COMPARECEU,
          observacoes: 'nao compareceu',
        },
      }),
    );
    created.forEach((row) => appointmentIds.push(row.id));

    const response = await request(app.getHttpServer())
      .get('/appointments/my')
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);

    const statuses = response.body
      .filter((item: any) => item.data === statusDate)
      .map((item: any) => item.status)
      .sort();

    expect(statuses).toEqual(
      ['CONCLUIDO', 'CONFIRMADO', 'NAO_COMPARECEU'].sort(),
    );
  });
});
