import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Barbers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let clientToken: string;
  let barberAtivoToken: string;
  let disabledToken: string;
  let disabledUserId: number;

  let barbeiroAtivoId: number;
  let barbeiroInativoId: number;
  let barbeiroSemPerfilAtivoToken: string;

  const createdUserIds: number[] = [];
  const createdBarberIds: number[] = [];
  const password = 'barbers-e2e-password';
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
        nome: 'Cliente Barbers E2E',
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

    const barberAtivo = await createBarber('Barbeiro Ativo Barbers E2E', true);
    const barberInativo = await createBarber('Barbeiro Inativo Barbers E2E', false);
    barbeiroAtivoId = barberAtivo.barbeiro!.id;
    barbeiroInativoId = barberInativo.barbeiro!.id;

    // Cliente desativável: usado para validar bloqueio de Usuario.ativo = false.
    const deactivatableClient = await prisma.usuario.create({
      data: {
        nome: 'Cliente Desativavel Barbers E2E',
        telefone: `${phoneBase}91`,
        senhaHash,
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
    });
    createdUserIds.push(deactivatableClient.id);
    disabledUserId = deactivatableClient.id;

    const login = async (telefone: string) => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ telefone, senha: password })
        .expect(200);
      return response.body.token as string;
    };

    clientToken = await login(client.telefone);
    barberAtivoToken = await login(barberAtivo.telefone);
    barbeiroSemPerfilAtivoToken = await login(barberInativo.telefone);

    const disabledLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ telefone: deactivatableClient.telefone, senha: password })
      .expect(200);
    disabledToken = disabledLogin.body.token as string;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.barbeiro.deleteMany({ where: { id: { in: createdBarberIds } } });
      await prisma.cliente.deleteMany({ where: { usuarioId: { in: createdUserIds } } });
      await prisma.usuario.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (app) {
      await app.close();
    }
  });

  it('exige autenticação (401 sem token)', async () => {
    await request(app.getHttpServer()).get('/barbers').expect(401);
  });

  it('rejeita token inválido (401)', async () => {
    await request(app.getHttpServer())
      .get('/barbers')
      .set('Authorization', 'Bearer token-invalido')
      .expect(401);
  });

  it('CLIENTE ativo lista barbeiros ativos', async () => {
    const response = await request(app.getHttpServer())
      .get('/barbers')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: barbeiroAtivoId, nome: 'Barbeiro Ativo Barbers E2E' }),
      ]),
    );
  });

  it('BARBEIRO ativo com perfil ativo também pode listar', async () => {
    await request(app.getHttpServer())
      .get('/barbers')
      .set('Authorization', `Bearer ${barberAtivoToken}`)
      .expect(200);
  });

  it('barbeiro INATIVO não aparece na listagem', async () => {
    const response = await request(app.getHttpServer())
      .get('/barbers')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    expect(response.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: barbeiroInativoId })]),
    );
  });

  it('BARBEIRO sem perfil ativo é rejeitado pelo RolesGuard (403)', async () => {
    await request(app.getHttpServer())
      .get('/barbers')
      .set('Authorization', `Bearer ${barbeiroSemPerfilAtivoToken}`)
      .expect(403);
  });

  it('usuário desativado com JWT previamente emitido recebe 401', async () => {
    // Estado inicial: cliente ativo autentica normalmente.
    await request(app.getHttpServer())
      .get('/barbers')
      .set('Authorization', `Bearer ${disabledToken}`)
      .expect(200);

    try {
      await prisma.usuario.update({
        where: { id: disabledUserId },
        data: { ativo: false },
      });

      await request(app.getHttpServer())
        .get('/barbers')
        .set('Authorization', `Bearer ${disabledToken}`)
        .expect(401);
    } finally {
      await prisma.usuario.update({
        where: { id: disabledUserId },
        data: { ativo: true },
      });
    }
  });

  it('não expõe dados sensíveis nem campos administrativos', async () => {
    const response = await request(app.getHttpServer())
      .get('/barbers')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    for (const barber of response.body) {
      expect(Object.keys(barber).sort()).toEqual(['id', 'nome']);
      expect(barber).not.toHaveProperty('senhaHash');
      expect(barber).not.toHaveProperty('telefone');
      expect(barber).not.toHaveProperty('email');
      expect(barber).not.toHaveProperty('ativo');
      expect(barber).not.toHaveProperty('tipoUsuario');
    }

    expect(JSON.stringify(response.body)).not.toMatch(
      /senha|senhaHash|token|pix|pagamento|transaç/i,
    );
  });
});
