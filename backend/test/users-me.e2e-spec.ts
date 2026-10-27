import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Users /me (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let clientToken: string;
  let clientId: number;

  let outroToken: string;
  let outroId: number;

  let terceiroEmail: string;

  const createdUserIds: number[] = [];
  const password = 'users-me-e2e-password';
  const phoneBase = String(Date.now()).slice(-8);

  const criarCliente = async (
    nome: string,
    telefone: string,
    email: string | null,
  ) => {
    const usuario = await prisma.usuario.create({
      data: {
        nome,
        telefone,
        email,
        senhaHash: await hashPassword(password),
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
    });
    createdUserIds.push(usuario.id);
    return usuario;
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

    const client = await criarCliente(
      'Cliente Users ME E2E',
      `${phoneBase}01`,
      'cliente.users.me@email.com',
    );
    clientId = client.id;

    // Segundo cliente SEM e-mail: reproduz o DEF-1 (e-mail anulável).
    const outro = await criarCliente(
      'Outro Cliente Users ME E2E',
      `${phoneBase}02`,
      null,
    );
    outroId = outro.id;

    // Terceiro cliente COM e-mail: dono de um e-mail que o `client` tentará usar.
    terceiroEmail = `terceiro.${phoneBase}@email.com`;
    await criarCliente(
      'Terceiro Cliente Users ME E2E',
      `${phoneBase}03`,
      terceiroEmail,
    );

    const login = async (telefone: string) => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ telefone, senha: password })
        .expect(200);
      return response.body.token as string;
    };

    clientToken = await login(client.telefone);
    outroToken = await login(outro.telefone);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.cliente.deleteMany({
        where: { usuarioId: { in: createdUserIds } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('exige autenticação (401 sem token)', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('rejeita token inválido (401)', async () => {
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer token-invalido')
      .expect(401);
  });

  it('GET /users/me retorna o perfil sem senhaHash', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: clientId,
      nome: 'Cliente Users ME E2E',
      telefone: `${phoneBase}01`,
      email: 'cliente.users.me@email.com',
      tipoUsuario: 'CLIENTE',
      ativo: true,
    });
    expect(response.body).not.toHaveProperty('senhaHash');
  });

  it('GET /users/me funciona para usuário sem e-mail (email null)', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${outroToken}`)
      .expect(200);

    expect(response.body.id).toBe(outroId);
    expect(response.body.email).toBeNull();
  });
  it('PATCH /users/me atualiza nome e telefone', async () => {
    const novoTelefone = `${phoneBase}11`;
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ nome: 'Cliente Renomeado', telefone: novoTelefone })
      .expect(200);

    expect(response.body).toMatchObject({
      id: clientId,
      nome: 'Cliente Renomeado',
      telefone: novoTelefone,
    });
    expect(response.body).not.toHaveProperty('senhaHash');
  });

  it('PATCH /users/me rejeita corpo vazio (400)', async () => {
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({})
      .expect(400);
  });

  it('PATCH /users/me rejeita campo não permitido (400)', async () => {
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ ativo: false })
      .expect(400);
  });

  it('PATCH /users/me rejeita e-mail duplicado de outra conta (409)', async () => {
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ email: terceiroEmail })
      .expect(409);

    expect(typeof response.body.message).toBe('string');
  });

  it('PATCH /users/me rejeita telefone duplicado de outra conta (409)', async () => {
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ telefone: `${phoneBase}02` })
      .expect(409);

    expect(typeof response.body.message).toBe('string');
  });

  it('PATCH /users/me permite limpar o e-mail (DEF-1: sem falso 409)', async () => {
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ email: null })
      .expect(200);

    expect(response.body.email).toBeNull();
  });

  it('PATCH /users/me permite informar um e-mail após tê-lo limpo', async () => {
    const email = `novo.${phoneBase}@email.com`;
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ email })
      .expect(200);

    expect(response.body.email).toBe(email);
  });

  it('PATCH /users/me não permite editar o e-mail de outra conta', async () => {
    // O usuário só altera a PRÓPRIA conta; não existe rota por id.
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ id: outroId })
      .expect(400);

    expect(response.body.message).toBeDefined();
  });
});
