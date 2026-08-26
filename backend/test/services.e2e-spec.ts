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
  let disabledUserToken: string;
  let disabledUserId: number;
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

  // Retorna um ID que certamente não existe no banco (máximo atual + folga).
  const getNonExistentServiceId = async (): Promise<number> => {
    const aggregate = await prisma.servico.aggregate({ _max: { id: true } });
    return (aggregate._max.id ?? 0) + 1000;
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

    // Cliente usado para validar bloqueio de usuário com Usuario.ativo = false.
    const deactivatableClient = await prisma.usuario.create({
      data: {
        nome: 'Cliente Desativavel Services E2E',
        telefone: `${phoneBase}91`,
        senhaHash,
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
    });
    createdUserIds.push(deactivatableClient.id);
    disabledUserId = deactivatableClient.id;

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

    const disabledLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ telefone: deactivatableClient.telefone, senha: password })
      .expect(200);
    disabledUserToken = disabledLogin.body.token as string;
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

  describe('IDs inexistentes', () => {
    it('GET /services/:id com ID inexistente retorna 404', async () => {
      const nonExistentId = await getNonExistentServiceId();

      const response = await request(app.getHttpServer())
        .get(`/services/${nonExistentId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(404);

      expect(response.body.message).toBe('Serviço não encontrado.');
    });

    it('PATCH /services/:id com ID inexistente retorna 404', async () => {
      const nonExistentId = await getNonExistentServiceId();

      await request(app.getHttpServer())
        .patch(`/services/${nonExistentId}`)
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ nome: 'Serviço inexistente' })
        .expect(404);
    });

    it('PATCH /services/:id/status com ID inexistente retorna 404', async () => {
      const nonExistentId = await getNonExistentServiceId();

      await request(app.getHttpServer())
        .patch(`/services/${nonExistentId}/status`)
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ ativo: true })
        .expect(404);
    });
  });

  describe('IDs malformados', () => {
    it('GET /services/abc retorna 400', async () => {
      await request(app.getHttpServer())
        .get('/services/abc')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(400);
    });

    it('PATCH /services/abc retorna 400', async () => {
      await request(app.getHttpServer())
        .patch('/services/abc')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ nome: 'ID inválido' })
        .expect(400);
    });

    it('PATCH /services/abc/status retorna 400', async () => {
      await request(app.getHttpServer())
        .patch('/services/abc/status')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ ativo: false })
        .expect(400);
    });

    // O ParseIntPipe atual (/^-?\d+$/) aceita inteiros negativos; "-1"
    // atravessa o pipe e cai na busca por ID inexistente -> 404.
    it('GET /services/-1 retorna 404', async () => {
      await request(app.getHttpServer())
        .get('/services/-1')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(404);
    });

    it('PATCH /services/-1 retorna 404', async () => {
      await request(app.getHttpServer())
        .patch('/services/-1')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ nome: 'ID negativo' })
        .expect(404);
    });

    it('PATCH /services/-1/status retorna 404', async () => {
      await request(app.getHttpServer())
        .patch('/services/-1/status')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ ativo: false })
        .expect(404);
    });
  });

  describe('campos obrigatórios ausentes', () => {
    it.each([
      ['sem nome', { duracaoMinutos: 30, preco: '20.00' }],
      ['sem duracaoMinutos', { nome: 'Sem duração e2e', preco: '20.00' }],
      ['sem preco', { nome: 'Sem preço e2e', duracaoMinutos: 30 }],
    ])('rejeita POST /services %s', async (_name, partialPayload) => {
      await request(app.getHttpServer())
        .post('/services')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send(partialPayload)
        .expect(400);
    });
  });

  describe('limites de campos', () => {
    it('rejeita nome com menos de 2 caracteres no POST /services', async () => {
      await request(app.getHttpServer())
        .post('/services')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ nome: 'A', duracaoMinutos: 30, preco: '20.00' })
        .expect(400);
    });

    it('rejeita nome com mais de 100 caracteres no POST /services', async () => {
      await request(app.getHttpServer())
        .post('/services')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ nome: 'N'.repeat(101), duracaoMinutos: 30, preco: '20.00' })
        .expect(400);
    });

    it('rejeita descricao com mais de 500 caracteres no POST /services', async () => {
      await request(app.getHttpServer())
        .post('/services')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({
          nome: `${testPrefix}-descricao-longa`,
          descricao: 'D'.repeat(501),
          duracaoMinutos: 30,
          preco: '20.00',
        })
        .expect(400);
    });

    it('aceita preco "0" no POST /services', async () => {
      const response = await request(app.getHttpServer())
        .post('/services')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({
          nome: `${testPrefix}-preco-zero`,
          duracaoMinutos: 30,
          preco: '0',
        })
        .expect(201);

      createdServiceIds.push(response.body.id);
      expect(response.body.preco).toBe('0.00');
    });

    it('aceita preco "99999999.99" no limite superior no POST /services', async () => {
      const response = await request(app.getHttpServer())
        .post('/services')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({
          nome: `${testPrefix}-preco-limite`,
          duracaoMinutos: 480,
          preco: '99999999.99',
        })
        .expect(201);

      createdServiceIds.push(response.body.id);
      expect(response.body.preco).toBe('99999999.99');
    });
  });

  describe('ciclo completo de status', () => {
    it('serviço criado aparece, some e volta aos endpoints públicos conforme status', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/services')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({
          nome: `${testPrefix}-fluxo-status`,
          descricao: 'Fluxo completo de status',
          duracaoMinutos: 60,
          preco: '50.00',
        })
        .expect(201);

      const serviceId = createResponse.body.id as number;
      createdServiceIds.push(serviceId);
      expect(createResponse.body.ativo).toBe(true);

      // ativo: aparece na listagem pública
      await request(app.getHttpServer())
        .get('/services')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: serviceId, ativo: true }),
            ]),
          );
        });

      // desativa
      await request(app.getHttpServer())
        .patch(`/services/${serviceId}/status`)
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ ativo: false })
        .expect(200)
        .expect((response) => expect(response.body.ativo).toBe(false));

      // inativo: some da listagem pública
      await request(app.getHttpServer())
        .get('/services')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ id: serviceId })]),
          );
          for (const service of response.body) {
            expect(service.ativo).toBe(true);
          }
        });

      // inativo: detalhe público retorna 404
      await request(app.getHttpServer())
        .get(`/services/${serviceId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(404);

      // o dono ainda enxerga o serviço inativo na área administrativa
      await request(app.getHttpServer())
        .get('/services/admin')
        .set('Authorization', `Bearer ${barberAToken}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: serviceId, ativo: false }),
            ]),
          );
        });

      // reativa
      await request(app.getHttpServer())
        .patch(`/services/${serviceId}/status`)
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({ ativo: true })
        .expect(200)
        .expect((response) => expect(response.body.ativo).toBe(true));

      // reativado: volta à listagem pública
      await request(app.getHttpServer())
        .get('/services')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: serviceId, ativo: true }),
            ]),
          );
        });

      // reativado: detalhe público responde novamente
      await request(app.getHttpServer())
        .get(`/services/${serviceId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200)
        .expect((response) => expect(response.body.ativo).toBe(true));
    });
  });

  describe('atualização completa', () => {
    it('PATCH atualiza todos os campos do serviço próprio e persiste as alterações', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/services')
        .set('Authorization', `Bearer ${barberAToken}`)
        .send({
          nome: `${testPrefix}-update-completo`,
          descricao: 'Descrição original',
          duracaoMinutos: 30,
          preco: '10.00',
        })
        .expect(201);

      const serviceId = createResponse.body.id as number;
      createdServiceIds.push(serviceId);

      const updatePayload = {
        nome: 'Serviço totalmente atualizado',
        descricao: 'Descrição atualizada',
        duracaoMinutos: 90,
        preco: '123.45',
      };

      const updateResponse = await request(app.getHttpServer())
        .patch(`/services/${serviceId}`)
        .set('Authorization', `Bearer ${barberAToken}`)
        .send(updatePayload)
        .expect(200);

      expect(updateResponse.body).toMatchObject({
        id: serviceId,
        ...updatePayload,
      });

      // confirma persistência consultando novamente
      await request(app.getHttpServer())
        .get(`/services/${serviceId}`)
        .set('Authorization', `Bearer ${barberAToken}`)
        .expect(200)
        .expect((response) =>
          expect(response.body).toMatchObject(updatePayload),
        );
    });
  });

  describe('autenticação e segurança', () => {
    it('rejeita token inválido em rotas protegidas de Services', async () => {
      await request(app.getHttpServer())
        .get('/services')
        .set('Authorization', 'Bearer token-invalido')
        .expect(401);

      await request(app.getHttpServer())
        .get('/services/admin')
        .set('Authorization', 'Bearer token-invalido')
        .expect(401);
    });

    it('usuario desativado com JWT previamente emitido recebe 401 nas rotas administrativas', async () => {
      // Estado inicial: cliente ativo autentica, mas recebe 403 por papel.
      await request(app.getHttpServer())
        .get('/services/admin')
        .set('Authorization', `Bearer ${disabledUserToken}`)
        .expect(403);

      try {
        await prisma.usuario.update({
          where: { id: disabledUserId },
          data: { ativo: false },
        });

        await request(app.getHttpServer())
          .get('/services/admin')
          .set('Authorization', `Bearer ${disabledUserToken}`)
          .expect(401);

        await request(app.getHttpServer())
          .post('/services')
          .set('Authorization', `Bearer ${disabledUserToken}`)
          .send({ nome: 'Usuario desativado', duracaoMinutos: 30, preco: '20.00' })
          .expect(401);
      } finally {
        // Restaura o estado para não deixar dado permanente alterado.
        await prisma.usuario.update({
          where: { id: disabledUserId },
          data: { ativo: true },
        });
      }

      // Restaurado, volta ao comportamento normal de cliente.
      await request(app.getHttpServer())
        .get('/services/admin')
        .set('Authorization', `Bearer ${disabledUserToken}`)
        .expect(403);
    });

    it('nenhuma resposta de Services expõe dados administrativos ou financeiros', async () => {
      const createBody = (
        await request(app.getHttpServer())
          .post('/services')
          .set('Authorization', `Bearer ${barberAToken}`)
          .send({
            nome: `${testPrefix}-sem-vazamento`,
            descricao: 'Verificação de exposição de dados',
            duracaoMinutos: 30,
            preco: '25.00',
          })
          .expect(201)
      ).body;
      createdServiceIds.push(createBody.id);

      const patchBody = (
        await request(app.getHttpServer())
          .patch(`/services/${createBody.id}`)
          .set('Authorization', `Bearer ${barberAToken}`)
          .send({ descricao: 'Descrição alterada' })
          .expect(200)
      ).body;

      const statusBody = (
        await request(app.getHttpServer())
          .patch(`/services/${createBody.id}/status`)
          .set('Authorization', `Bearer ${barberAToken}`)
          .send({ ativo: false })
          .expect(200)
      ).body;

      const publicListBody = (
        await request(app.getHttpServer())
          .get('/services')
          .set('Authorization', `Bearer ${clientToken}`)
          .expect(200)
      ).body;

      const adminListBody = (
        await request(app.getHttpServer())
          .get('/services/admin')
          .set('Authorization', `Bearer ${barberAToken}`)
          .expect(200)
      ).body;

      const responsesToCheck = [
        createBody,
        patchBody,
        statusBody,
        ...publicListBody,
        ...adminListBody,
      ];

      for (const service of responsesToCheck) {
        expect(service).not.toHaveProperty('barbeiroId');
        expect(service).not.toHaveProperty('dataCriacao');
        expect(service).not.toHaveProperty('dataAtualizacao');
        expect(service).not.toHaveProperty('senhaHash');
      }

      expect(JSON.stringify(responsesToCheck)).not.toMatch(
        /pagamento|pix|checkout|transaç|transac|cobranç|cobranca/i,
      );
    });
  });
});