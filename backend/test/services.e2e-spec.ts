import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Services (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clientToken: string;
  let barberAToken: string;
  let barberBToken: string;
  let inactiveBarberToken: string;
  let activeServiceId: number;
  let inactiveServiceId: number;
  let barberAServiceId: number;
  let barberBServiceId: number;
  let createdServiceId: number | undefined;
  const createdUserIds: number[] = [];
  const createdBarberIds: number[] = [];
  const createdServiceIds: number[] = [];
  const password = 'services-e2e-password';
  const testPrefix = `services-e2e-${Date.now()}`;
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

    const client = await prisma.usuario.create({
      data: {
        nome: 'Cliente Services E2E',
        telefone: `${phoneBase}01`,
        senhaHash,
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
    });
    createdUserIds.push(client.id);

    const createBarber = async (nome: string, ativo = true) => {
      const barber = await prisma.usuario.create({
        data: {
          nome,
          telefone: `${phoneBase}${String(createdUserIds.length + 2).padStart(2, '0')}`,
          senhaHash,
          tipoUsuario: TipoUsuario.BARBEIRO,
          barbeiro: { create: { ativo } },
        },
        include: { barbeiro: true },
      });

      createdUserIds.push(barber.id);
      createdBarberIds.push(barber.barbeiro!.id);
      return barber;
    };

    const barberA = await createBarber('Barbeiro A');
    const barberB = await createBarber('Barbeiro B');
    const inactiveBarber = await createBarber('Barbeiro Inativo', false);

    const createService = async (barbeiroId: number, ativo: boolean) => {
      const service = await prisma.servico.create({
        data: {
          barbeiroId,
          nome: `${testPrefix}-${ativo ? 'ativo' : 'inativo'}-${barbeiroId}`,
          descricao: 'Serviço criado pelo teste e2e',
          duracaoMinutos: 30,
          preco: '35.00',
          ativo,
        },
      });

      createdServiceIds.push(service.id);
      return service;
    };

    const activeService = await createService(barberA.barbeiro!.id, true);
    const inactiveService = await createService(barberA.barbeiro!.id, false);
    const barberAService = await createService(barberA.barbeiro!.id, true);
    const barberBService = await createService(barberB.barbeiro!.id, true);
    activeServiceId = activeService.id;
    inactiveServiceId = inactiveService.id;
    barberAServiceId = barberAService.id;
    barberBServiceId = barberBService.id;

    const login = async (telefone: string) => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ telefone, senha: password })
        .expect(200);

      return response.body.token as string;
    };

    clientToken = await login(client.telefone);
    barberAToken = await login(barberA.telefone);
    barberBToken = await login(barberB.telefone);
    inactiveBarberToken = await login(inactiveBarber.telefone);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.servico.deleteMany({ where: { id: { in: createdServiceIds } } });
      await prisma.barbeiro.deleteMany({ where: { id: { in: createdBarberIds } } });
      await prisma.cliente.deleteMany({ where: { usuarioId: { in: createdUserIds } } });
      await prisma.usuario.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    if (app) {
      await app.close();
    }
  });

  it('exige JWT para listar serviços', async () => {
    await request(app.getHttpServer()).get('/services').expect(401);
  });

  it('cliente lista somente serviços ativos', async () => {
    const response = await request(app.getHttpServer())
      .get('/services')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: activeServiceId, ativo: true }),
      ]),
    );
    expect(response.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: inactiveServiceId })]),
    );
    for (const service of response.body) {
      expect(service.ativo).toBe(true);
      expect(service).not.toHaveProperty('barbeiroId');
      expect(service).not.toHaveProperty('dataCriacao');
      expect(service).not.toHaveProperty('dataAtualizacao');
    }
  });

  it('cliente não consulta serviço inativo', async () => {
    await request(app.getHttpServer())
      .get(`/services/${inactiveServiceId}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(404);
  });

  it('cliente consulta serviço ativo sem expor dados administrativos', async () => {
    const response = await request(app.getHttpServer())
      .get(`/services/${activeServiceId}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    expect(response.body).toMatchObject({ id: activeServiceId, ativo: true });
    expect(response.body.preco).toMatch(/^\d+\.\d{2}$/);
    expect(response.body).not.toHaveProperty('barbeiroId');
    expect(response.body).not.toHaveProperty('dataCriacao');
    expect(response.body).not.toHaveProperty('dataAtualizacao');
    expect(JSON.stringify(response.body)).not.toMatch(/pagamento|pix|checkout|transação/i);
  });

  it('cliente recebe 403 nas operações administrativas', async () => {
    const payload = {
      nome: 'Tentativa cliente',
      duracaoMinutos: 30,
      preco: '20.00',
    };

    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${clientToken}`)
      .send(payload)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/services/${activeServiceId}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ nome: 'Tentativa cliente' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/services/${activeServiceId}/status`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ ativo: false })
      .expect(403);
  });

  it('barbeiro consulta seus serviços ativos e inativos', async () => {
    const response = await request(app.getHttpServer())
      .get('/services/admin')
      .set('Authorization', `Bearer ${barberAToken}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: activeServiceId, ativo: true }),
        expect.objectContaining({ id: inactiveServiceId, ativo: false }),
      ]),
    );
    expect(response.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: barberBServiceId })]),
    );
  });

  it('barbeiro cria serviço próprio e serializa preço com duas casas', async () => {
    const response = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({
        nome: 'Novo serviço e2e',
        descricao: 'Descrição e2e',
        duracaoMinutos: 45,
        preco: '42',
      })
      .expect(201);

    createdServiceId = response.body.id;
    createdServiceIds.push(createdServiceId!);
    expect(response.body.preco).toBe('42.00');
    expect(response.body).not.toHaveProperty('barbeiroId');
    expect(response.body).not.toHaveProperty('dataCriacao');
    expect(response.body).not.toHaveProperty('dataAtualizacao');
  });

  it('barbeiro atualiza serviço próprio', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/services/${createdServiceId}`)
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({ nome: 'Serviço atualizado', preco: '43.50' })
      .expect(200);

    expect(response.body).toMatchObject({
      id: createdServiceId,
      nome: 'Serviço atualizado',
      preco: '43.50',
    });
  });

  it('barbeiro desativa e reativa serviço próprio', async () => {
    await request(app.getHttpServer())
      .patch(`/services/${createdServiceId}/status`)
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({ ativo: false })
      .expect(200)
      .expect((response) => expect(response.body.ativo).toBe(false));

    await request(app.getHttpServer())
      .patch(`/services/${createdServiceId}/status`)
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({ ativo: true })
      .expect(200)
      .expect((response) => expect(response.body.ativo).toBe(true));
  });

  it('barbeiro não acessa serviço de outro barbeiro', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/services/${barberAServiceId}`)
      .set('Authorization', `Bearer ${barberBToken}`)
      .send({ nome: 'Acesso indevido' })
      .expect(404);

    expect(response.body.message).toBe('Serviço não encontrado.');
    expect(JSON.stringify(response.body)).not.toMatch(/barbeiro|proprietário|owner/i);
  });

  it.each([
    ['barbeiroId', { barbeiroId: 999 }],
    ['ativo', { ativo: false }],
    ['campo extra', { campoExtra: true }],
    ['preço negativo', { preco: '-1.00' }],
    ['preço com mais de 2 casas', { preco: '10.999' }],
    ['duração menor que 5', { duracaoMinutos: 4 }],
    ['duração maior que 480', { duracaoMinutos: 481 }],
  ])('rejeita %s no POST /services', async (_name, invalidField) => {
    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({
        nome: 'Payload inválido',
        duracaoMinutos: 30,
        preco: '20.00',
        ...invalidField,
      })
      .expect(400);
  });

  it.each([
    ['update vazio', {}],
    ['ativo', { ativo: false }],
    ['barbeiroId', { barbeiroId: 999 }],
    ['campo extra', { campoExtra: true }],
    ['preço inválido', { preco: '-2.00' }],
    ['duração inválida', { duracaoMinutos: 481 }],
  ])('rejeita %s no PATCH /services/:id', async (_name, invalidField) => {
    await request(app.getHttpServer())
      .patch(`/services/${activeServiceId}`)
      .set('Authorization', `Bearer ${barberAToken}`)
      .send(invalidField)
      .expect(400);
  });

  it('aceita somente booleano no status', async () => {
    await request(app.getHttpServer())
      .patch(`/services/${activeServiceId}/status`)
      .set('Authorization', `Bearer ${barberAToken}`)
      .send({ ativo: null })
      .expect(400);
  });

  it('barbeiro sem registro ativo recebe 403 nas rotas administrativas', async () => {
    await request(app.getHttpServer())
      .get('/services/admin')
      .set('Authorization', `Bearer ${inactiveBarberToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${inactiveBarberToken}`)
      .send({ nome: 'Inválido', duracaoMinutos: 30, preco: '20.00' })
      .expect(403);
  });

  it('não expõe rota DELETE', async () => {
    await request(app.getHttpServer()).delete('/services/1').expect(404);
  });
});