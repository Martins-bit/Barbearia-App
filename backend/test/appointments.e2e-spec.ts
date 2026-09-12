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
      await prisma.notificacao.deleteMany({
        where: {
          OR: [
            { usuarioId: { in: userIds } },
            { agendamentoId: { in: appointmentIds } },
          ],
        },
      });
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

  const getAppointmentById = (token: string, id: number) =>
    request(app.getHttpServer())
      .get(`/appointments/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const getBarberAgenda = (token: string) =>
    request(app.getHttpServer())
      .get('/appointments')
      .set('Authorization', `Bearer ${token}`);

  const cancelAppointment = (token: string, id: number) =>
    request(app.getHttpServer())
      .patch(`/appointments/${id}/cancel`)
      .set('Authorization', `Bearer ${token}`);

  const completeAppointment = (token: string, id: number) =>
    request(app.getHttpServer())
      .patch(`/appointments/${id}/complete`)
      .set('Authorization', `Bearer ${token}`);

  const noShowAppointment = (token: string, id: number) =>
    request(app.getHttpServer())
      .patch(`/appointments/${id}/no-show`)
      .set('Authorization', `Bearer ${token}`);

  it('GET /appointments/:id exige JWT', async () => {
    await request(app.getHttpServer()).get('/appointments/1').expect(401);
  });

  it('CLIENTE acessa seu próprio agendamento com 200', async () => {
    const ownDate = futureDateKey(7);
    const appointment = await prisma.agendamento.create({
      data: {
        clienteId: clientAClienteId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${ownDate}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(ownDate, '14:00'),
        horaFim: zonedWallTimeToUtc(ownDate, '14:30'),
        status: StatusAgendamento.CONFIRMADO,
        observacoes: 'Detalhes próprios',
      },
    });
    appointmentIds.push(appointment.id);

    const response = await getAppointmentById(clientAToken, appointment.id).expect(200);
    expect(response.body.id).toBe(appointment.id);
    expect(response.body.cliente.id).toBe(clientAClienteId);
    expect(response.body.servico.precoInformativo).toMatch(/^\d+\.\d{2}$/);
  });

  it('CLIENTE acessa agendamento de outro cliente com 404', async () => {
    const appointment = await prisma.agendamento.create({
      data: {
        clienteId: clientBClienteId,
        barbeiroId: barberBId,
        servicoId: svcB30Id,
        data: new Date(`${futureDateKey(8)}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(futureDateKey(8), '15:00'),
        horaFim: zonedWallTimeToUtc(futureDateKey(8), '15:30'),
        status: StatusAgendamento.CONFIRMADO,
      },
    });
    appointmentIds.push(appointment.id);

    await getAppointmentById(clientAToken, appointment.id).expect(404);
  });

  it('BARBEIRO acessa agendamento do próprio perfil com 200', async () => {
    const appointment = await prisma.agendamento.create({
      data: {
        clienteId: clientBClienteId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${futureDateKey(9)}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(futureDateKey(9), '16:00'),
        horaFim: zonedWallTimeToUtc(futureDateKey(9), '16:30'),
        status: StatusAgendamento.CONFIRMADO,
      },
    });
    appointmentIds.push(appointment.id);

    const response = await getAppointmentById(barberAToken, appointment.id).expect(200);
    expect(response.body.barbeiro.id).toBe(barberAId);
    expect(response.body.cliente.id).toBe(clientBClienteId);
  });

  it('BARBEIRO acessa agendamento de outro barbeiro com 404', async () => {
    const appointment = await prisma.agendamento.create({
      data: {
        clienteId: clientAToken ? clientAClienteId : clientAClienteId,
        barbeiroId: barberBId,
        servicoId: svcB30Id,
        data: new Date(`${futureDateKey(10)}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(futureDateKey(10), '10:00'),
        horaFim: zonedWallTimeToUtc(futureDateKey(10), '10:30'),
        status: StatusAgendamento.CONFIRMADO,
      },
    });
    appointmentIds.push(appointment.id);

    await getAppointmentById(barberAToken, appointment.id).expect(404);
  });

  it('GET /appointments/:id retorna 404 para id inexistente', async () => {
    await getAppointmentById(clientAToken, 999999).expect(404);
  });

  it('GET /appointments exige JWT', async () => {
    await request(app.getHttpServer()).get('/appointments').expect(401);
  });

  it('CLIENTE recebe 403 em GET /appointments', async () => {
    await getBarberAgenda(clientAToken).expect(403);
  });

  it('BARBEIRO recebe somente a própria agenda ordenada', async () => {
    const barberDate = futureDateKey(11);
    const ownA = await prisma.agendamento.create({
      data: {
        clienteId: clientAClienteId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${barberDate}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(barberDate, '11:00'),
        horaFim: zonedWallTimeToUtc(barberDate, '11:30'),
        status: StatusAgendamento.CONFIRMADO,
      },
    });
    const ownB = await prisma.agendamento.create({
      data: {
        clienteId: clientBClienteId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${barberDate}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(barberDate, '12:00'),
        horaFim: zonedWallTimeToUtc(barberDate, '12:30'),
        status: StatusAgendamento.CANCELADO,
      },
    });
    const other = await prisma.agendamento.create({
      data: {
        clienteId: clientAClienteId,
        barbeiroId: barberBId,
        servicoId: svcB30Id,
        data: new Date(`${barberDate}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(barberDate, '13:00'),
        horaFim: zonedWallTimeToUtc(barberDate, '13:30'),
        status: StatusAgendamento.CONFIRMADO,
      },
    });
    appointmentIds.push(ownA.id, ownB.id, other.id);

    const response = await getBarberAgenda(barberAToken).expect(200);
    expect(response.body.some((item: any) => item.id === other.id)).toBe(false);
    expect(response.body.map((item: any) => item.id)).toEqual(
      expect.arrayContaining([ownA.id, ownB.id]),
    );
    expect(response.body.every((item: any) => item.barbeiro.id === barberAId)).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/senhaHash|pagamento|pix|checkout/i);
  });

  it('GET /appointments inclui diferentes status e ordenação cronológica', async () => {
    const statusDate = futureDateKey(12);
    const first = await prisma.agendamento.create({
      data: {
        clienteId: clientAClienteId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${statusDate}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(statusDate, '09:30'),
        horaFim: zonedWallTimeToUtc(statusDate, '10:00'),
        status: StatusAgendamento.CONCLUIDO,
      },
    });
    const second = await prisma.agendamento.create({
      data: {
        clienteId: clientBClienteId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${statusDate}T00:00:00-03:00`),
        horaInicio: zonedWallTimeToUtc(statusDate, '10:00'),
        horaFim: zonedWallTimeToUtc(statusDate, '10:30'),
        status: StatusAgendamento.NAO_COMPARECEU,
      },
    });
    appointmentIds.push(first.id, second.id);

    const response = await getBarberAgenda(barberAToken).expect(200);
    const statuses = response.body
      .filter((item: any) => item.data === statusDate)
      .map((item: any) => item.status)
      .sort();

    expect(statuses).toEqual(['CONCLUIDO', 'NAO_COMPARECEU'].sort());
    expect(response.body.find((item: any) => item.id === first.id).horaInicio).toBe('09:30');
    expect(response.body.find((item: any) => item.id === second.id).horaInicio).toBe('10:00');
  });

  describe('ETAPA 4B — transições de status', () => {
    it('PATCH /appointments/:id/cancel exige JWT', async () => {
      await request(app.getHttpServer()).patch('/appointments/1/cancel').expect(401);
    });

    it('CLIENTE cancela próprio CONFIRMADO antes do dia -> 200', async () => {
      const cancelDate = futureDateKey(14);
      const appointment = await prisma.agendamento.create({
        data: {
          clienteId: clientAClienteId,
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: new Date(`${cancelDate}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(cancelDate, '09:00'),
          horaFim: zonedWallTimeToUtc(cancelDate, '09:30'),
          status: StatusAgendamento.CONFIRMADO,
        },
      });
      appointmentIds.push(appointment.id);

      const response = await cancelAppointment(clientAToken, appointment.id).expect(200);
      expect(response.body.status).toBe(StatusAgendamento.CANCELADO);
      expect(response.body.cliente.id).toBe(clientAClienteId);
    });

    it('CLIENTE tenta cancelar no mesmo dia -> 400', async () => {
      const sameDay = futureDateKey(0);
      const appointment = await prisma.agendamento.create({
        data: {
          clienteId: clientAClienteId,
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: new Date(`${sameDay}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(sameDay, '12:00'),
          horaFim: zonedWallTimeToUtc(sameDay, '12:30'),
          status: StatusAgendamento.CONFIRMADO,
        },
      });
      appointmentIds.push(appointment.id);

      await cancelAppointment(clientAToken, appointment.id).expect(400);
    });

    it('CLIENTE tenta cancelar agendamento de outro cliente -> 404', async () => {
      const appointment = await prisma.agendamento.create({
        data: {
          clienteId: clientBClienteId,
          barbeiroId: barberBId,
          servicoId: svcB30Id,
          data: new Date(`${futureDateKey(15)}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(futureDateKey(15), '10:00'),
          horaFim: zonedWallTimeToUtc(futureDateKey(15), '10:30'),
          status: StatusAgendamento.CONFIRMADO,
        },
      });
      appointmentIds.push(appointment.id);

      await cancelAppointment(clientAToken, appointment.id).expect(404);
    });

    it('BARBEIRO cancela agendamento da própria agenda -> 200', async () => {
      const appointment = await prisma.agendamento.create({
        data: {
          clienteId: clientBClienteId,
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: new Date(`${futureDateKey(16)}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(futureDateKey(16), '14:00'),
          horaFim: zonedWallTimeToUtc(futureDateKey(16), '14:30'),
          status: StatusAgendamento.CONFIRMADO,
        },
      });
      appointmentIds.push(appointment.id);

      const response = await cancelAppointment(barberAToken, appointment.id).expect(200);
      expect(response.body.status).toBe(StatusAgendamento.CANCELADO);
      expect(response.body.barbeiro.id).toBe(barberAId);
    });

    it('BARBEIRO tenta cancelar agendamento de outro barbeiro -> 404', async () => {
      const appointment = await prisma.agendamento.create({
        data: {
          clienteId: clientAToken ? clientAClienteId : clientAClienteId,
          barbeiroId: barberBId,
          servicoId: svcB30Id,
          data: new Date(`${futureDateKey(17)}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(futureDateKey(17), '15:00'),
          horaFim: zonedWallTimeToUtc(futureDateKey(17), '15:30'),
          status: StatusAgendamento.CONFIRMADO,
        },
      });
      appointmentIds.push(appointment.id);

      await cancelAppointment(barberAToken, appointment.id).expect(404);
    });

    it('PATCH /appointments/:id/cancel status incompatível -> 409', async () => {
      const appointment = await prisma.agendamento.create({
        data: {
          clienteId: clientAClienteId,
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: new Date(`${futureDateKey(18)}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(futureDateKey(18), '16:00'),
          horaFim: zonedWallTimeToUtc(futureDateKey(18), '16:30'),
          status: StatusAgendamento.CANCELADO,
        },
      });
      appointmentIds.push(appointment.id);

      await cancelAppointment(clientAToken, appointment.id).expect(409);
    });

    it('PATCH /appointments/:id/complete exige JWT e 403 para CLIENTE', async () => {
      await request(app.getHttpServer()).patch('/appointments/1/complete').expect(401);
      await completeAppointment(clientAToken, 1).expect(403);
    });

    it('BARBEIRO conclui próprio agendamento após horaFim -> 200', async () => {
      const completedDate = futureDateKey(19);
      const appointment = await prisma.agendamento.create({
        data: {
          clienteId: clientAClienteId,
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: new Date(`${completedDate}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(completedDate, '09:00'),
          horaFim: zonedWallTimeToUtc(completedDate, '09:30'),
          status: StatusAgendamento.CONFIRMADO,
        },
      });
      appointmentIds.push(appointment.id);

      const response = await completeAppointment(barberAToken, appointment.id).expect(400);
      expect(response.body.message).toContain('Só é possível concluir após o fim do agendamento');
    });

    it('PATCH /appointments/:id/no-show exige JWT e 403 para CLIENTE', async () => {
      await request(app.getHttpServer()).patch('/appointments/1/no-show').expect(401);
      await noShowAppointment(clientAToken, 1).expect(403);
    });

    it('BARBEIRO marca falta após o início -> 200', async () => {
      const noShowDate = futureDateKey(-1);
      const appointment = await prisma.agendamento.create({
        data: {
          clienteId: clientBClienteId,
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: new Date(`${noShowDate}T00:00:00-03:00`),
          horaInicio: zonedWallTimeToUtc(noShowDate, '08:00'),
          horaFim: zonedWallTimeToUtc(noShowDate, '08:30'),
          status: StatusAgendamento.CONFIRMADO,
        },
      });
      appointmentIds.push(appointment.id);

      const response = await noShowAppointment(barberAToken, appointment.id).expect(200);
      expect(response.body.status).toBe(StatusAgendamento.NAO_COMPARECEU);
    });
  });

  describe('ETAPA 5A — concorrência real de agendamentos', () => {
    it('MESMO BARBEIRO / MESMO HORÁRIO: uma criação 201 e outra 409', async () => {
      const slotDate = futureDateKey(25);
      const payloadA = {
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: slotDate,
        horaInicio: '10:00',
      };
      const payloadB = {
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: slotDate,
        horaInicio: '10:00',
      };

      const results = await Promise.allSettled([
        postAppointment(clientAToken, payloadA),
        postAppointment(clientBToken, payloadB),
      ]);

      const statusCodes = results.map((item) =>
        item.status === 'fulfilled'
          ? item.value.status
          : item.reason?.response?.status ?? 0,
      );

      expect(statusCodes.filter((code) => code === 201)).toHaveLength(1);
      expect(statusCodes.filter((code) => code === 409)).toHaveLength(1);

      const successful = results.filter(
        (item): item is PromiseFulfilledResult<any> => item.status === 'fulfilled',
      );
      for (const result of successful) {
        if (result.value.status === 201) {
          appointmentIds.push(result.value.body.id);
        }
      }

      const count = await prisma.agendamento.count({
        where: {
          barbeiroId: barberAId,
          data: new Date(`${slotDate}T00:00:00-03:00`),
          status: StatusAgendamento.CONFIRMADO,
        },
      });

      expect(count).toBe(1);
    }, 30000);

    it('MESMO CLIENTE / BARBEIROS DIFERENTES: uma criação 201 e outra 409', async () => {
      const slotDate = futureDateKey(26);
      const payloadA = {
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: slotDate,
        horaInicio: '11:00',
      };
      const payloadB = {
        barbeiroId: barberBId,
        servicoId: svcB30Id,
        data: slotDate,
        horaInicio: '11:00',
      };

      const results = await Promise.allSettled([
        postAppointment(clientAToken, payloadA),
        postAppointment(clientAToken, payloadB),
      ]);

      const statusCodes = results.map((item) =>
        item.status === 'fulfilled'
          ? item.value.status
          : item.reason?.response?.status ?? 0,
      );
      expect(statusCodes.filter((code) => code === 201)).toHaveLength(1);
      expect(statusCodes.filter((code) => code === 409)).toHaveLength(1);

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.status === 201) {
          appointmentIds.push(result.value.body.id);
        }
      }

      const count = await prisma.agendamento.count({
        where: {
          clienteId: clientAClienteId,
          data: new Date(`${slotDate}T00:00:00-03:00`),
          status: StatusAgendamento.CONFIRMADO,
        },
      });

      expect(count).toBe(1);
    }, 30000);

    it('REQUISIÇÕES INDEPENDENTES: dois 201 em horários distintos', async () => {
      const slotDate = futureDateKey(27);
      const results = await Promise.allSettled([
        postAppointment(clientAToken, {
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: slotDate,
          horaInicio: '12:00',
        }),
        postAppointment(clientBToken, {
          barbeiroId: barberBId,
          servicoId: svcB30Id,
          data: slotDate,
          horaInicio: '13:00',
        }),
      ]);

      const statusCodes = results.map((item) =>
        item.status === 'fulfilled'
          ? item.value.status
          : item.reason?.response?.status ?? 0,
      );
      expect(statusCodes.filter((code) => code === 201)).toHaveLength(2);
      expect(statusCodes.some((code) => code === 409)).toBe(false);

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.status === 201) {
          appointmentIds.push(result.value.body.id);
        }
      }

      const count = await prisma.agendamento.count({
        where: {
          data: new Date(`${slotDate}T00:00:00-03:00`),
          status: StatusAgendamento.CONFIRMADO,
        },
      });

      expect(count).toBeGreaterThanOrEqual(2);
    }, 30000);

    it('ADJACÊNCIA CONCORRENTE: dois 201 em slots adjacentes', async () => {
      const slotDate = futureDateKey(28);
      const results = await Promise.allSettled([
        postAppointment(clientAToken, {
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: slotDate,
          horaInicio: '09:00',
        }),
        postAppointment(clientBToken, {
          barbeiroId: barberAId,
          servicoId: svcA30Id,
          data: slotDate,
          horaInicio: '09:30',
        }),
      ]);

      const statusCodes = results.map((item) =>
        item.status === 'fulfilled'
          ? item.value.status
          : item.reason?.response?.status ?? 0,
      );
      expect(statusCodes.filter((code) => code === 201)).toHaveLength(2);
      expect(statusCodes.some((code) => code === 409)).toBe(false);

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.status === 201) {
          appointmentIds.push(result.value.body.id);
        }
      }

      const count = await prisma.agendamento.count({
        where: {
          barbeiroId: barberAId,
          data: new Date(`${slotDate}T00:00:00-03:00`),
          status: StatusAgendamento.CONFIRMADO,
        },
      });

      expect(count).toBeGreaterThanOrEqual(2);
    }, 30000);
  });
});
