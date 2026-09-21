import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { MessagesSocketRegistry } from '../src/messages/messages.socket-registry';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(20000);

describe('Messages WebSocket — fundação autenticada (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let registry: MessagesSocketRegistry;
  let baseUrl: string;

  let clientUserId: number;
  let clientDiscUserId: number;
  let clientOffUserId: number;
  let barberUserId: number;
  let barberOffId: number;

  let clientToken: string;
  let clientDiscToken: string;
  let clientOffToken: string;
  let barberToken: string;
  let barberOffToken: string;

  const openSockets: Socket[] = [];
  const userIds: number[] = [];
  const clientIds: number[] = [];
  const barberIds: number[] = [];
  const phoneBase = String(Date.now()).slice(-8);
  const password = 'ws-e2e-password';

  const createClient = async (name: string, phone: string) => {
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
    return { userId: user.id, phone };
  };

  const createBarber = async (name: string, phone: string) => {
    const user = await prisma.usuario.create({
      data: {
        nome: name,
        telefone: phone,
        senhaHash: await hashPassword(password),
        tipoUsuario: TipoUsuario.BARBEIRO,
        barbeiro: { create: {} },
      },
      include: { barbeiro: true },
    });
    userIds.push(user.id);
    barberIds.push(user.barbeiro!.id);
    return { userId: user.id, barbeiroId: user.barbeiro!.id, phone };
  };

  const login = async (phone: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ telefone: phone, senha: password })
      .expect(200);
    return response.body.token as string;
  };

  /** Conecta ao namespace /messages e resolve com erro de handshake ou socket. */
  const tryConnect = (auth: Record<string, unknown>) =>
    new Promise<{ socket: Socket; error: Error | null }>((resolve) => {
      const socket = io(`${baseUrl}/messages`, {
        auth,
        transports: ['websocket'],
        reconnection: false,
      });
      let settled = false;
      const timer = setTimeout(
        () => finish(new Error('Tempo esgotado aguardando conexão.')),
        8000,
      );
      const finish = (error: Error | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ socket, error });
      };
      socket.on('connect', () => finish(null));
      socket.on('connect_error', (error: Error) => {
        socket.disconnect();
        finish(error);
      });
    });

  /**
   * Handshake autenticado: emite `ping` e aguarda o evento `pong` com a
   * identidade validada (padrão Nest de request/reply por eventos).
   */
  const ping = (socket: Socket) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('pong não recebido')),
        5000,
      );
      socket.once('pong', (data: any) => {
        clearTimeout(timer);
        resolve(data);
      });
      socket.emit('ping');
    });

  const waitUntil = async (condition: () => boolean, timeoutMs = 4000) => {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Condição não atingida a tempo.');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
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
    // Escuta efetiva: o cliente socket.io precisa de porta real.
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    registry = app.get(MessagesSocketRegistry);

    const client = await createClient('Cliente WS', `${phoneBase}81`);
    const clientDisc = await createClient('Cliente WS Desconecta', `${phoneBase}82`);
    const clientOff = await createClient('Cliente WS Inativo', `${phoneBase}83`);
    const barber = await createBarber('Barbeiro WS', `${phoneBase}84`);
    const barberOff = await createBarber('Barbeiro WS Perfil Inativo', `${phoneBase}85`);

    clientUserId = client.userId;
    clientDiscUserId = clientDisc.userId;
    clientOffUserId = clientOff.userId;
    barberUserId = barber.userId;
    barberOffId = barberOff.barbeiroId;

    clientToken = await login(client.phone);
    clientDiscToken = await login(clientDisc.phone);
    clientOffToken = await login(clientOff.phone);
    barberToken = await login(barber.phone);
    barberOffToken = await login(barberOff.phone);
  });

  afterAll(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.disconnect();
    }
    if (prisma) {
      await prisma.barbeiro.deleteMany({ where: { id: { in: barberIds } } });
      await prisma.cliente.deleteMany({ where: { id: { in: clientIds } } });
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) {
      await app.close();
    }
  });

  it('conexão sem JWT é rejeitada', async () => {
    const { error } = await tryConnect({});
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toBe('Não autorizado.');
  });

  it('conexão com JWT inválido é rejeitada', async () => {
    const { error } = await tryConnect({ token: 'jwt-invalido' });
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toBe('Não autorizado.');
  });

  it('conexão com JWT de usuário inativo é rejeitada', async () => {
    await prisma.usuario.update({
      where: { id: clientOffUserId },
      data: { ativo: false },
    });

    const { error } = await tryConnect({ token: clientOffToken });
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toBe('Não autorizado.');
  });

  it('conexão autenticada como CLIENTE funciona e ecoa a identidade do JWT', async () => {
    const { socket, error } = await tryConnect({ token: clientToken });
    expect(error).toBeNull();
    openSockets.push(socket);

    // Registro da conexão acontece no servidor após o handshake aceito.
    await waitUntil(() => registry.count(clientUserId) > 0);

    const pong = await ping(socket);
    expect(pong).toEqual({
      usuarioId: clientUserId,
      tipoUsuario: TipoUsuario.CLIENTE,
    });
    // Identidade do socket corresponde ao usuário do JWT.
    expect(registry.getSocketIds(clientUserId)).toContain(socket.id);
  });

  it('conexão autenticada como BARBEIRO funciona', async () => {
    const { socket, error } = await tryConnect({ token: barberToken });
    expect(error).toBeNull();
    openSockets.push(socket);

    await waitUntil(() => registry.count(barberUserId) > 0);

    const pong = await ping(socket);
    expect(pong).toEqual({
      usuarioId: barberUserId,
      tipoUsuario: TipoUsuario.BARBEIRO,
    });
    expect(registry.getSocketIds(barberUserId)).toContain(socket.id);
  });

  it('barbeiro com perfil inativo é rejeitado', async () => {
    await prisma.barbeiro.update({
      where: { id: barberOffId },
      data: { ativo: false },
    });

    const { error } = await tryConnect({ token: barberOffToken });
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toBe('Não autorizado.');
  });

  it('desconexão é tratada corretamente e limpa o registro', async () => {
    const { socket, error } = await tryConnect({ token: clientDiscToken });
    expect(error).toBeNull();
    await waitUntil(() => registry.count(clientDiscUserId) === 1);

    const disconnected = new Promise<void>((resolve) =>
      socket.once('disconnect', () => resolve()),
    );
    socket.disconnect();
    await disconnected;
    await waitUntil(() => registry.count(clientDiscUserId) === 0);

    expect(registry.has(clientDiscUserId)).toBe(false);
  });

  it('endpoints REST de mensagens permanecem operando (sem regressão)', async () => {
    const response = await request(app.getHttpServer())
      .get('/messages/unread-count')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);
    expect(response.body).toEqual({ count: 0 });
  });
});

