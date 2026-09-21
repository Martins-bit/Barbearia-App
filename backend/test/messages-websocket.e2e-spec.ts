import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { MessageResponseDto } from '../src/messages/dto/message-response.dto';
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
  let clientSecondUserId: number;
  let barberUserId: number;
  let barberSecondUserId: number;
  let barberOffId: number;

  let clientToken: string;
  let clientDiscToken: string;
  let clientOffToken: string;
  let clientSecondToken: string;
  let barberToken: string;
  let barberSecondToken: string;
  let barberOffToken: string;

  const openSockets: Socket[] = [];
  const userIds: number[] = [];
  const clientIds: number[] = [];
  const barberIds: number[] = [];
  const messageIds: number[] = [];
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
    const clientSecond = await createClient('Cliente WS Segundo', `${phoneBase}86`);
    const barber = await createBarber('Barbeiro WS', `${phoneBase}84`);
    const barberSecond = await createBarber('Barbeiro WS Segundo', `${phoneBase}87`);
    const barberOff = await createBarber('Barbeiro WS Perfil Inativo', `${phoneBase}85`);

    clientUserId = client.userId;
    clientDiscUserId = clientDisc.userId;
    clientOffUserId = clientOff.userId;
    clientSecondUserId = clientSecond.userId;
    barberUserId = barber.userId;
    barberSecondUserId = barberSecond.userId;
    barberOffId = barberOff.barbeiroId;

    clientToken = await login(client.phone);
    clientDiscToken = await login(clientDisc.phone);
    clientOffToken = await login(clientOff.phone);
    clientSecondToken = await login(clientSecond.phone);
    barberToken = await login(barber.phone);
    barberSecondToken = await login(barberSecond.phone);
    barberOffToken = await login(barberOff.phone);
  });

  afterAll(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.disconnect();
    }
    if (prisma) {
      // Mensagem referencia Usuario (FK): remover antes de cliente/barbeiro.
      await prisma.mensagem.deleteMany({
        where: {
          OR: [
            { id: { in: messageIds } },
            { remetenteId: { in: userIds } },
            { destinatarioId: { in: userIds } },
          ],
        },
      });
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

  describe('envio em tempo real (message:send / message:sent / message:received)', () => {
    /** Aguarda um evento específico no socket, com timeout. */
    const waitEvent = (socket: Socket, event: string, timeoutMs = 5000) =>
      new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Evento ${event} não recebido`)),
          timeoutMs,
        );
        socket.once(event, (data: any) => {
          clearTimeout(timer);
          resolve(data);
        });
      });

    /**
     * Emite `message:send` e resolve com o payload de `message:sent` (sucesso)
     * ou com a mensagem do evento `exception` (erro de validação/negócio).
     *
     * O handler não retorna valor (evita ack duplicado), então o sinal de
     * sucesso é o próprio evento `message:sent`.
     */
    const sendMessage = (socket: Socket, payload: Record<string, unknown>) =>
      new Promise<{ sent: any; error: string | null }>((resolve) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('exception', onException);
          socket.off('message:sent', onSent);
        };
        const finish = (result: { sent: any; error: string | null }) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        };
        const onException = (err: any) =>
          finish({ sent: null, error: String(err?.message ?? err) });
        const onSent = (data: any) => finish({ sent: data, error: null });
        const timer = setTimeout(
          () => finish({ sent: null, error: 'timeout' }),
          5000,
        );
        socket.once('exception', onException);
        socket.once('message:sent', onSent);
        socket.emit('message:send', payload);
      });

    /**
     * Conecta e garante limpeza ao final do teste (evita vazar conexões para
     * os testes seguintes, que verificam contagens do registry).
     */
    const connectedSockets: Socket[] = [];
    const connectAs = async (token: string) => {
      const { socket, error } = await tryConnect({ token });
      expect(error).toBeNull();
      openSockets.push(socket);
      connectedSockets.push(socket);
      return socket;
    };

    afterEach(async () => {
      // Fecha também conexões deixadas por testes anteriores (7C.1)
      // para que as contagens do registry sejam determinísticas.
      for (const socket of openSockets.splice(0)) {
        socket.disconnect();
      }
      connectedSockets.splice(0);
      // Aguarda o servidor processar TODAS as desconexões antes do próximo
      // teste (que pode afirmar destinatário offline).
      await waitUntil(() => registry.size() === 0, 8000);
    });

    it('CLIENTE envia, destinatário BARBEIRO conectado recebe e a mensagem é persistida', async () => {
      const clientSocket = await connectAs(clientToken);
      const barberSocket = await connectAs(barberToken);
      await waitUntil(
        () =>
          registry.count(clientUserId) > 0 && registry.count(barberUserId) > 0,
      );

      const conteudo = `mensagem ws ${Date.now()}`;
      const received = waitEvent(barberSocket, 'message:received');

      // O helper já captura `message:sent` do remetente.
      const { sent, error } = await sendMessage(clientSocket, {
        destinatarioId: barberUserId,
        conteudo,
      });
      expect(error).toBeNull();

      const sentPayload: MessageResponseDto = sent;
      const receivedPayload: MessageResponseDto = await received;

      // 3. Remetente recebe message:sent; 4. destinatário recebe message:received.
      expect(sentPayload.remetenteUsuarioId).toBe(clientUserId);
      expect(sentPayload.destinatarioUsuarioId).toBe(barberUserId);
      expect(receivedPayload).toEqual(sentPayload);

      // 5. Conteúdo recebido corresponde ao persistido.
      const persisted = await prisma.mensagem.findUnique({
        where: { id: sentPayload.id },
      });
      expect(persisted).toBeTruthy();
      messageIds.push(persisted!.id);
      expect(persisted!.conteudo).toBe(conteudo);
      expect(persisted!.remetenteId).toBe(clientUserId);
      expect(persisted!.destinatarioId).toBe(barberUserId);
      expect(persisted!.lida).toBe(false);
      expect(receivedPayload.conteudo).toBe(persisted!.conteudo);
      expect(receivedPayload.id).toBe(persisted!.id);

      // Os payloads emitidos não expõem dados sensíveis.
      for (const payload of [sentPayload, receivedPayload]) {
        expect(payload.senhaHash).toBeUndefined();
        expect(payload.remetenteId).toBeUndefined();
        expect(payload.destinatarioId).toBeUndefined();
      }
    });

    it('BARBEIRO responde o CLIENTE em tempo real', async () => {
      const clientSocket = await connectAs(clientToken);
      const barberSocket = await connectAs(barberToken);
      await waitUntil(
        () =>
          registry.count(clientUserId) > 0 && registry.count(barberUserId) > 0,
      );

      const received = waitEvent(clientSocket, 'message:received');
      const { error } = await sendMessage(barberSocket, {
        destinatarioId: clientUserId,
        conteudo: 'resposta do barbeiro',
      });
      expect(error).toBeNull();

      const payload: MessageResponseDto = await received;
      messageIds.push(payload.id);
      expect(payload.remetenteUsuarioId).toBe(barberUserId);
      expect(payload.destinatarioUsuarioId).toBe(clientUserId);
      expect(payload.conteudo).toBe('resposta do barbeiro');
    });

    it('destinatário offline não impede o envio nem a persistência', async () => {
      const clientSocket = await connectAs(clientToken);
      await waitUntil(() => registry.count(clientUserId) > 0);
      // Garante que o barbeiro NÃO está conectado neste teste.
      expect(registry.count(barberUserId)).toBe(0);

      const { sent, error } = await sendMessage(clientSocket, {
        destinatarioId: barberUserId,
        conteudo: 'destinatário offline',
      });
      expect(error).toBeNull();

      const payload: MessageResponseDto = sent;
      messageIds.push(payload.id);

      // Persistida e recuperável via REST.
      const persisted = await prisma.mensagem.findUnique({
        where: { id: payload.id },
      });
      expect(persisted?.conteudo).toBe('destinatário offline');

      const viaRest = await request(app.getHttpServer())
        .get(`/messages/${clientUserId}`)
        .set('Authorization', `Bearer ${barberToken}`)
        .expect(200);
      expect(
        viaRest.body.some((item: any) => item.id === payload.id),
      ).toBe(true);
    });

    it('múltiplas conexões do destinatário recebem a mesma mensagem', async () => {
      const clientSocket = await connectAs(clientToken);
      const barberSocketA = await connectAs(barberToken);
      const barberSocketB = await connectAs(barberToken);
      await waitUntil(
        () =>
          registry.count(clientUserId) > 0 && registry.count(barberUserId) === 2,
      );

      const recebidoA = waitEvent(barberSocketA, 'message:received');
      const recebidoB = waitEvent(barberSocketB, 'message:received');

      const { error } = await sendMessage(clientSocket, {
        destinatarioId: barberUserId,
        conteudo: 'para vários dispositivos',
      });
      expect(error).toBeNull();

      const [a, b]: MessageResponseDto[] = await Promise.all([
        recebidoA,
        recebidoB,
      ]);
      messageIds.push(a.id);
      expect(a.id).toBe(b.id);
      expect(a).toEqual(b);
      expect(a.conteudo).toBe('para vários dispositivos');

      // Exatamente uma persistência para a única chamada.
      expect(
        await prisma.mensagem.count({
          where: { id: a.id, remetenteId: clientUserId },
        }),
      ).toBe(1);
    });

    it('cliente malicioso não consegue definir outro remetente', async () => {
      const clientSocket = await connectAs(clientToken);
      await waitUntil(() => registry.count(clientUserId) > 0);

      const attempts = [
        { destinatarioId: barberUserId, conteudo: 'spoof', remetenteId: barberUserId },
        {
          destinatarioId: barberUserId,
          conteudo: 'spoof',
          remetenteUsuarioId: barberUserId,
        },
        { destinatarioId: barberUserId, conteudo: 'spoof', usuarioId: barberUserId },
        {
          destinatarioId: barberUserId,
          conteudo: 'spoof',
          tipoUsuario: TipoUsuario.BARBEIRO,
        },
      ];

      for (const payload of attempts) {
        const { error } = await sendMessage(clientSocket, payload);
        expect(error).not.toBeNull();
      }

      // Nenhuma mensagem persistida com o remetente forjado.
      expect(
        await prisma.mensagem.count({
          where: { conteudo: 'spoof', remetenteId: barberUserId },
        }),
      ).toBe(0);
    });

    it('regras de conversa continuam respeitadas (CLIENTE -> CLIENTE)', async () => {
      const clientSocket = await connectAs(clientToken);
      await waitUntil(() => registry.count(clientUserId) > 0);

      const { error } = await sendMessage(clientSocket, {
        destinatarioId: clientSecondUserId,
        conteudo: 'cliente para cliente',
      });
      expect(error).toContain('cliente e barbeiro');
      expect(
        await prisma.mensagem.count({
          where: { conteudo: 'cliente para cliente' },
        }),
      ).toBe(0);
    });

    it('regras de conversa continuam respeitadas (BARBEIRO -> BARBEIRO)', async () => {
      const barberSocket = await connectAs(barberToken);
      await waitUntil(() => registry.count(barberUserId) > 0);

      const { error } = await sendMessage(barberSocket, {
        destinatarioId: barberSecondUserId,
        conteudo: 'barbeiro para barbeiro',
      });
      expect(error).toContain('cliente e barbeiro');
      expect(
        await prisma.mensagem.count({
          where: { conteudo: 'barbeiro para barbeiro' },
        }),
      ).toBe(0);
    });

    it('conteúdo inválido é rejeitado e nada é persistido', async () => {
      const clientSocket = await connectAs(clientToken);
      await waitUntil(() => registry.count(clientUserId) > 0);

      const antes = await prisma.mensagem.count({
        where: { remetenteId: clientUserId, destinatarioId: barberUserId },
      });

      for (const conteudo of ['', '   ', 'a'.repeat(501)]) {
        const { error } = await sendMessage(clientSocket, {
          destinatarioId: barberUserId,
          conteudo,
        });
        expect(error).not.toBeNull();
      }

      // Nenhuma linha nova foi criada pelas tentativas inválidas.
      expect(
        await prisma.mensagem.count({
          where: { remetenteId: clientUserId, destinatarioId: barberUserId },
        }),
      ).toBe(antes);
    });

    it('REST continua funcionando após o envio via WebSocket', async () => {
      const clientSocket = await connectAs(clientToken);
      await waitUntil(() => registry.count(clientUserId) > 0);

      const { error } = await sendMessage(clientSocket, {
        destinatarioId: barberUserId,
        conteudo: 'validação REST',
      });
      expect(error).toBeNull();

      const viaRest = await request(app.getHttpServer())
        .get(`/messages/${barberUserId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);
      expect(
        viaRest.body.some((item: any) => item.conteudo === 'validação REST'),
      ).toBe(true);

      const unread = await request(app.getHttpServer())
        .get('/messages/unread-count')
        .set('Authorization', `Bearer ${barberToken}`)
        .expect(200);
      expect(unread.body.count).toBeGreaterThanOrEqual(1);
    });
  });
});

