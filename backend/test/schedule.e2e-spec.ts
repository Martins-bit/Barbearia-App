import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Schedule (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let clientToken: string;
  let barberAToken: string;
  let barberBToken: string;
  let inactiveBarberToken: string;
  let disabledToken: string;

  let barberAId: number; // Barbeiro.id
  let barberBId: number;
  let disabledUserId: number;
  let clienteRowId: number;

  let svcA30Id: number;
  let svcA240Id: number;
  let svcAInactiveId: number;
  let svcB30Id: number;

  const userIds: number[] = [];
  const barberIds: number[] = [];
  const serviceIds: number[] = [];
  const blockIds: number[] = [];
  const appointmentIds: number[] = [];

  const password = 'sched-e2e-password';
  const prefix = `sched-e2e-${Date.now()}`;
  const phoneBase = String(Date.now()).slice(-8);

  // Datas distantes e determinísticas (calendário local São Paulo).
  const SATURDAY = '2099-01-10';
  const SUNDAY = '2099-01-11';
  const MONDAY = '2099-01-12'; // segunda
  const WEDNESDAY = '2099-01-14'; // quarta

  // Semana canônica: seg-sex 09:00-18:00; sábado com DUAS janelas (almoço);
  // domingo omitido de propósito.
  const weekPayload = {
    horarios: [
      { diaSemana: 1, horaInicio: '09:00', horaFim: '18:00' },
      { diaSemana: 2, horaInicio: '09:00', horaFim: '18:00' },
      { diaSemana: 3, horaInicio: '09:00', horaFim: '18:00' },
      { diaSemana: 4, horaInicio: '09:00', horaFim: '18:00' },
      { diaSemana: 5, horaInicio: '09:00', horaFim: '18:00' },
      { diaSemana: 6, horaInicio: '08:00', horaFim: '12:00' },
      { diaSemana: 6, horaInicio: '13:00', horaFim: '17:00' },
    ],
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

    const client = await prisma.usuario.create({
      data: {
        nome: 'Cliente Sched E2E',
        telefone: `${phoneBase}41`,
        senhaHash,
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
    });
    userIds.push(client.id);
    const clienteRow = await prisma.cliente.findUnique({
      where: { usuarioId: client.id },
    });
    clienteRowId = clienteRow!.id;

    const createBarber = async (
      nome: string,
      telefone: string,
      ativo = true,
    ) => {
      const barber = await prisma.usuario.create({
        data: {
          nome,
          telefone,
          senhaHash,
          tipoUsuario: TipoUsuario.BARBEIRO,
          barbeiro: { create: { ativo } },
        },
        include: { barbeiro: true },
      });
      userIds.push(barber.id);
      barberIds.push(barber.barbeiro!.id);
      return barber;
    };

    const barberA = await createBarber('Barbeiro A Sched', `${phoneBase}42`);
    const barberB = await createBarber('Barbeiro B Sched', `${phoneBase}43`);
    const inactive = await createBarber(
      'Inativo Sched',
      `${phoneBase}44`,
      false,
    );

    barberAId = barberA.barbeiro!.id;
    barberBId = barberB.barbeiro!.id;

    const disabledClient = await prisma.usuario.create({
      data: {
        nome: 'Desativavel Sched',
        telefone: `${phoneBase}92`,
        senhaHash,
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
    });
    userIds.push(disabledClient.id);
    disabledUserId = disabledClient.id;

    const createService = async (
      barbeiroId: number,
      nome: string,
      duracaoMinutos: number,
      ativo: boolean,
    ) => {
      const service = await prisma.servico.create({
        data: {
          barbeiroId,
          nome,
          descricao: 'Serviço do teste e2e de Schedule',
          duracaoMinutos,
          preco: '30.00',
          ativo,
        },
      });
      serviceIds.push(service.id);
      return service;
    };

    svcA30Id = (await createService(barberAId, `${prefix}-corte-30`, 30, true)).id;
    svcA240Id = (
      await createService(barberAId, `${prefix}-combo-240`, 240, true)
    ).id;
    svcAInactiveId = (
      await createService(barberAId, `${prefix}-inativo`, 30, false)
    ).id;
    svcB30Id = (
      await createService(barberBId, `${prefix}-barba-b`, 30, true)
    ).id;

    const login = async (telefone: string): Promise<string> => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ telefone, senha: password })
        .expect(200);
      return response.body.token as string;
    };

    clientToken = await login(client.telefone);
    barberAToken = await login(barberA.telefone);
    barberBToken = await login(barberB.telefone);
    inactiveBarberToken = await login(inactive.telefone);
    disabledToken = await login(disabledClient.telefone);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.agendamento.deleteMany({
        where: {
          OR: [
            { id: { in: appointmentIds } },
            { barbeiroId: { in: barberIds } },
          ],
        },
      });
      await prisma.bloqueioAgenda.deleteMany({
        where: {
          OR: [
            { id: { in: blockIds } },
            { barbeiroId: { in: barberIds } },
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


  // -------------------------------------------------------------------
  // Horários de funcionamento
  // -------------------------------------------------------------------
  it('PUT substitui integralmente a semana, com múltiplas janelas no sábado', async () => {
    const response = await request(app.getHttpServer())
      .put('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send(weekPayload)
      .expect(200);

    expect(response.body).toHaveLength(7);
    const saturdayWindows = response.body.filter(
      (window: any) => window.diaSemana === 6,
    );
    expect(saturdayWindows).toHaveLength(2);
    expect(saturdayWindows.map((window: any) => window.horaInicio)).toEqual([
      '08:00',
      '13:00',
    ]);
    // Domingo não foi enviado e não existe na configuração.
    expect(
      response.body.some((window: any) => window.diaSemana === 0),
    ).toBe(false);
  });

  it('GET retorna somente os horários do próprio barbeiro', async () => {
    const ownA = await request(app.getHttpServer())
      .get('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200);
    expect(ownA.body).toHaveLength(7);

    const ownB = await request(app.getHttpServer())
      .get('/business-hours')
      .set('Authorization', `Bearer ${barberBToken}`)
      .expect(200);
    expect(ownB.body).toEqual([]);
  });

  it('PUT é idempotente: reenvio não duplica registros', async () => {
    await request(app.getHttpServer())
      .put('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send(weekPayload)
      .expect(200);

    const response = await request(app.getHttpServer())
      .get('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200);

    expect(response.body).toHaveLength(7);
  });

  it.each([
    [
      'hora inválida',
      { diaSemana: 1, horaInicio: '25:00', horaFim: '18:00' },
    ],
    [
      'ordem invertida',
      { diaSemana: 1, horaInicio: '12:00', horaFim: '09:00' },
    ],
    [
      'diaSemana fora do intervalo',
      { diaSemana: 7, horaInicio: '09:00', horaFim: '18:00' },
    ],
    [
      'campo extra',
      { diaSemana: 1, horaInicio: '09:00', horaFim: '18:00', extra: true },
    ],
  ])('rejeita PUT com %s', async (_name, window) => {
    await request(app.getHttpServer())
      .put('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({ horarios: [window] })
      .expect(400);
  });

  it('rejeita payload sem horarios e array vazio', async () => {
    await request(app.getHttpServer())
      .put('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .put('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({ horarios: [] })
      .expect(400);
  });

  it('rejeita janelas sobrepostas no mesmo dia', async () => {
    await request(app.getHttpServer())
      .put('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({
        horarios: [
          { diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' },
          { diaSemana: 1, horaInicio: '11:00', horaFim: '13:00' },
        ],
      })
      .expect(400);
  });


  // -------------------------------------------------------------------
  // Bloqueios
  // -------------------------------------------------------------------
  it('POST cria bloqueio com horários locais e resposta HH:mm', async () => {
    const response = await request(app.getHttpServer())
      .post('/schedule-blocks')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({
        data: MONDAY,
        horaInicio: '10:00',
        horaFim: '10:45',
        motivo: 'Manutenção',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      data: MONDAY,
      horaInicio: '10:00',
      horaFim: '10:45',
      motivo: 'Manutenção',
      ativo: true,
    });
    blockIds.push(response.body.id);
  });

  it('rejeita bloqueio sobreposto (409) e permite encostado', async () => {
    const overlap = await request(app.getHttpServer())
      .post('/schedule-blocks')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({
        data: MONDAY,
        horaInicio: '10:15',
        horaFim: '11:00',
      })
      .expect(409);
    expect(overlap.body.message).toBe('Já existe um bloqueio para esse período.');

    const touching = await request(app.getHttpServer())
      .post('/schedule-blocks')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({
        data: MONDAY,
        horaInicio: '10:45',
        horaFim: '11:30',
      })
      .expect(201);
    blockIds.push(touching.body.id);
  });

  it.each([
    ['data inexistente no calendário', { horaInicio: '10:00', horaFim: '11:00', data: '2099-02-30' }],
    ['horas invertidas', { data: MONDAY, horaInicio: '11:00', horaFim: '10:00' }],
    // Literal obrigatório: esta tabela é avaliada durante a REGISTRO da suíte,
    // antes do beforeAll — variáveis de fixture ainda seriam `undefined` e a
    // chave sumiria do JSON em vez de chegar como campo extra ao servidor.
    ['campo extra', { data: MONDAY, horaInicio: '10:00', horaFim: '11:00', barbeiroId: 999999 }],
    ['sem horaFim', { data: MONDAY, horaInicio: '10:00' }],
  ])('rejeita bloqueio com %s', async (_name, payload) => {
    await request(app.getHttpServer())
      .post('/schedule-blocks')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send(payload)
      .expect(400);
  });

  it('GET lista somente os próprios bloqueios com filtro por período', async () => {
    const ownA = await request(app.getHttpServer())
      .get('/schedule-blocks')
      .query({ dataInicio: MONDAY, dataFim: MONDAY })
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200);
    expect(ownA.body).toHaveLength(2);
    expect(ownA.body[0].horaInicio).toBe('10:00');

    const emptyA = await request(app.getHttpServer())
      .get('/schedule-blocks')
      .query({ dataInicio: SUNDAY, dataFim: SUNDAY })
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200);
    expect(emptyA.body).toEqual([]);

    const ownB = await request(app.getHttpServer())
      .get('/schedule-blocks')
      .set('Authorization', `Bearer ${barberBToken}`)
      .expect(200);
    expect(ownB.body).toEqual([]);
  });

  it('DELETE valida ownership e retorna 404 genérico para outro barbeiro', async () => {
    const targetId = blockIds[0];
    const forbidden = await request(app.getHttpServer())
      .delete(`/schedule-blocks/${targetId}`)
      .set('Authorization', `Bearer ${barberBToken}`)
      .expect(404);
    expect(forbidden.body.message).toBe('Bloqueio não encontrado.');

    await request(app.getHttpServer())
      .delete('/schedule-blocks/987654321')
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(404);
  });

  it('DELETE remove o bloqueio próprio', async () => {
    const secondId = blockIds[1];
    await request(app.getHttpServer())
      .delete(`/schedule-blocks/${secondId}`)
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200)
      .expect((response) => expect(response.body.removido).toBe(true));

    const list = await request(app.getHttpServer())
      .get('/schedule-blocks')
      .query({ dataInicio: MONDAY, dataFim: MONDAY })
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('POST verifica conflito com agendamento CONFIRMADO existente', async () => {
    const appointment = await prisma.agendamento.create({
      data: {
        clienteId: clienteRowId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${WEDNESDAY}T00:00:00.000Z`),
        horaInicio: new Date(`${WEDNESDAY}T14:00:00.000Z`), // 11:00 SP
        horaFim: new Date(`${WEDNESDAY}T14:30:00.000Z`), // 11:30 SP
        status: 'CONFIRMADO',
      },
    });
    appointmentIds.push(appointment.id);

    try {
      const response = await request(app.getHttpServer())
        .post('/schedule-blocks')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({
          data: WEDNESDAY,
          horaInicio: '10:45',
          horaFim: '11:15',
        })
        .expect(409);
      expect(response.body.message).toBe(
        'Existe um agendamento confirmado nesse período.',
      );
    } finally {
      await prisma.agendamento.delete({ where: { id: appointment.id } });
      appointmentIds.splice(appointmentIds.indexOf(appointment.id), 1);
    }
  });


  // -------------------------------------------------------------------
  // Disponibilidade
  // -------------------------------------------------------------------
  it('CLIENTE precisa informar barbeiroId', async () => {
    await request(app.getHttpServer())
      .get('/availability')
      .query({ data: MONDAY, servicoId: svcA30Id })
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(400);
  });

  it.each([
    ['sem data', { servicoId: 1 }],
    ['data inexistente', { data: '2099-02-30', servicoId: 1 }],
    ['sem servicoId', { data: MONDAY }],
  ])('rejeita consulta de disponibilidade com %s', async (_name, query) => {
    await request(app.getHttpServer())
      .get('/availability')
      .query(query)
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(400);
  });

  it('dia sem configuração retorna lista vazia', async () => {
    const response = await request(app.getHttpServer())
      .get('/availability')
      .query({ data: SUNDAY, servicoId: svcA30Id, barbeiroId: barberAId })
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      data: SUNDAY,
      barbeiroId: barberAId,
      duracaoMinutos: 30,
      horariosLivres: [],
    });
  });

  it('serviço inativo, inexistente ou de outro barbeiro retorna 404', async () => {
    await request(app.getHttpServer())
      .get('/availability')
      .query({ data: MONDAY, servicoId: svcAInactiveId, barbeiroId: barberAId })
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/availability')
      .query({ data: MONDAY, servicoId: 987654321, barbeiroId: barberAId })
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/availability')
      .query({ data: MONDAY, servicoId: svcB30Id, barbeiroId: barberAId })
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(404);
  });

  it('CASO OBRIGATÓRIO: serviço 30min + bloqueio 10:00–10:45 remove exatamente os slots conflitantes', async () => {
    const response = await request(app.getHttpServer())
      .get('/availability')
      .query({ data: MONDAY, servicoId: svcA30Id, barbeiroId: barberAId })
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    // Janela seg 09:00–18:00, grade de 15min, serviço 30min,
    // bloqueio 10:00–10:45 criado nos testes de bloqueios.
    expect(response.body.horariosLivres).toEqual(
      expect.arrayContaining([
        '09:00',
        '09:15',
        '09:30',
        '10:45',
        '11:00',
        '12:00',
        '17:30',
      ]),
    );
    expect(response.body.horariosLivres).not.toContain('09:45');
    expect(response.body.horariosLivres).not.toContain('10:00');
    expect(response.body.horariosLivres).not.toContain('10:15');
    expect(response.body.horariosLivres).not.toContain('10:30');
    // 09:30 termina exatamente às 10:00 -> permitido.
    expect(response.body.horariosLivres).toContain('09:30');
    // 10:45 começa exatamente quando o bloqueio termina -> permitido.
    expect(response.body.horariosLivres).toContain('10:45');
  });

  it('agendamento CONFIRMADO remove slots interceptantes e sua remoção libera novamente', async () => {
    // 11:00–11:30 em São Paulo == 14:00Z–14:30Z.
    const appointment = await prisma.agendamento.create({
      data: {
        clienteId: clienteRowId,
        barbeiroId: barberAId,
        servicoId: svcA30Id,
        data: new Date(`${MONDAY}T00:00:00.000Z`),
        horaInicio: new Date(`${MONDAY}T14:00:00.000Z`),
        horaFim: new Date(`${MONDAY}T14:30:00.000Z`),
        status: 'CONFIRMADO',
      },
    });
    appointmentIds.push(appointment.id);

    try {
      const busy = await request(app.getHttpServer())
        .get('/availability')
        .query({ data: MONDAY, servicoId: svcA30Id, barbeiroId: barberAId })
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      // Slots que interceptam [11:00, 11:30): 10:45, 11:00 e 11:15.
      // Além deles, o bloqueio 10:00–10:45 já remove 09:45–10:30.
      expect(busy.body.horariosLivres).not.toContain('09:45');
      expect(busy.body.horariosLivres).not.toContain('10:00');
      expect(busy.body.horariosLivres).not.toContain('10:15');
      expect(busy.body.horariosLivres).not.toContain('10:30');
      expect(busy.body.horariosLivres).not.toContain('10:45');
      expect(busy.body.horariosLivres).not.toContain('11:00');
      expect(busy.body.horariosLivres).not.toContain('11:15');
      expect(busy.body.horariosLivres).toContain('09:30');
      expect(busy.body.horariosLivres).toContain('11:30');

      await prisma.agendamento.delete({ where: { id: appointment.id } });
      appointmentIds.splice(appointmentIds.indexOf(appointment.id), 1);

      const restored = await request(app.getHttpServer())
        .get('/availability')
        .query({ data: MONDAY, servicoId: svcA30Id, barbeiroId: barberAId })
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);
      expect(restored.body.horariosLivres).toContain('10:45');
      expect(restored.body.horariosLivres).toContain('11:00');
    } catch (error) {
      if (appointmentIds.includes(appointment.id)) {
        await prisma.agendamento.delete({ where: { id: appointment.id } });
        appointmentIds.splice(appointmentIds.indexOf(appointment.id), 1);
      }
      throw error;
    }
  });

  it('BARBEIRO consulta a própria disponibilidade sem informar barbeiroId', async () => {
    const response = await request(app.getHttpServer())
      .get('/availability')
      .query({ data: MONDAY, servicoId: svcA30Id })
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200);

    expect(response.body.barbeiroId).toBe(barberAId);
    expect(response.body.horariosLivres).toContain('09:00');
  });

  it('múltiplas janelas do sábado respeitam o intervalo de almoço', async () => {
    const response = await request(app.getHttpServer())
      .get('/availability')
      .query({ data: SATURDAY, servicoId: svcA30Id, barbeiroId: barberAId })
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    expect(response.body.horariosLivres).toContain('08:00'); // início manhã
    expect(response.body.horariosLivres).toContain('11:30'); // último da manhã
    expect(response.body.horariosLivres).toContain('13:00'); // primeiro da tarde
    expect(response.body.horariosLivres).toContain('16:30'); // último da tarde
    expect(response.body.horariosLivres).not.toContain('12:00');
    expect(response.body.horariosLivres).not.toContain('12:30');
    expect(response.body.horariosLivres).not.toContain('12:45');
  });

  it('serviço que não cabe inteiro na janela retorna lista vazia', async () => {
    try {
      // Configuração temporária: apenas domingo, janela curta de 1h.
      await request(app.getHttpServer())
        .put('/business-hours')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({
          horarios: [{ diaSemana: 0, horaInicio: '09:00', horaFim: '10:00' }],
        })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/availability')
        .query({ data: SUNDAY, servicoId: svcA240Id, barbeiroId: barberAId })
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.duracaoMinutos).toBe(240);
      expect(response.body.horariosLivres).toEqual([]);
    } finally {
      await request(app.getHttpServer())
        .put('/business-hours')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send(weekPayload)
        .expect(200);
    }
  });

  it('BARBEIRO B sem configuração própria recebe lista vazia', async () => {
    const response = await request(app.getHttpServer())
      .get('/availability')
      .query({ data: MONDAY, servicoId: svcB30Id })
      .set('Authorization', `Bearer ${barberBToken}`)
      .expect(200);

    expect(response.body.barbeiroId).toBe(barberBId);
    expect(response.body.horariosLivres).toEqual([]);
  });



  // -------------------------------------------------------------------
  // Mutação final da configuração (dias omitidos são removidos)
  // -------------------------------------------------------------------
  it('janelas encostadas no mesmo dia são aceitas no PUT', async () => {
    const response = await request(app.getHttpServer())
      .put('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({
        horarios: [
          { diaSemana: 1, horaInicio: '09:00', horaFim: '12:00' },
          { diaSemana: 1, horaInicio: '12:00', horaFim: '15:00' },
        ],
      })
      .expect(200);

    expect(response.body).toHaveLength(2);
    expect(response.body.every((window: any) => window.diaSemana === 1)).toBe(
      true,
    );
  });

  it('dias omitidos no PUT não permanecem da configuração anterior', async () => {
    const response = await request(app.getHttpServer())
      .put('/business-hours')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({
        horarios: [
          { diaSemana: 2, horaInicio: '10:00', horaFim: '16:00' },
        ],
      })
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].diaSemana).toBe(2);

    // Segunda-feira deixou de estar configurada -> disponibilidade some.
    const mondayAvailability = await request(app.getHttpServer())
      .get('/availability')
      .query({ data: MONDAY, servicoId: svcA30Id, barbeiroId: barberAId })
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);
    expect(mondayAvailability.body.horariosLivres).toEqual([]);

    // Bloqueio criado para segunda permanece registrado (não é apagado).
    const blocks = await request(app.getHttpServer())
      .get('/schedule-blocks')
      .query({ dataInicio: MONDAY, dataFim: MONDAY })
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200);
    expect(blocks.body).toHaveLength(1);
  });

});
