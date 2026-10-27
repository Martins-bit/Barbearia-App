import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';

describe('DIAG def-3/def-4', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let id: number;
  const ids: number[] = [];
  const password = 'diag-password';
  const base = String(Date.now()).slice(-8);

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

    const u = await prisma.usuario.create({
      data: {
        nome: 'Diag Def3',
        telefone: `${base}01`,
        email: `diag.def3.${base}@email.com`,
        senhaHash: await hashPassword(password),
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
    });
    ids.push(u.id);
    id = u.id;

    const r = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ telefone: u.telefone, senha: password })
      .expect(200);
    token = r.body.token;
  });

  afterAll(async () => {
    await prisma.cliente.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('DEF-3: nome null', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: null });
    console.log(
      'DEF-3 nome:null status =',
      res.status,
      JSON.stringify(res.body),
    );
  });

  it('DEF-3: telefone null', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ telefone: null });
    console.log(
      'DEF-3 telefone:null status =',
      res.status,
      JSON.stringify(res.body),
    );
  });

  it('DEF-3: email invalido', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'nao-e-email' });
    console.log(
      'DEF-3 email invalido status =',
      res.status,
      JSON.stringify(res.body),
    );
  });

  it('DEF-3: nome vazio string', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: '' });
    console.log(
      'DEF-3 nome vazio status =',
      res.status,
      JSON.stringify(res.body),
    );
  });

  it('DEF-4: constraint object shape via P2002', async () => {
    const other = await prisma.usuario.create({
      data: {
        nome: 'Diag Def4',
        telefone: `${base}02`,
        email: `diag.def4.${base}@email.com`,
        senhaHash: await hashPassword(password),
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
    });
    ids.push(other.id);

    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: other.email });
    console.log(
      'DEF-4 email duplicado status =',
      res.status,
      JSON.stringify(res.body),
    );

    const res2 = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ telefone: other.telefone });
    console.log(
      'DEF-4 telefone duplicado status =',
      res2.status,
      JSON.stringify(res2.body),
    );
  });
});
