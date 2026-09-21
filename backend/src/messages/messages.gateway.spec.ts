import { BadRequestException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { TipoUsuario } from '../generated/prisma/enums';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';
import { MessagesSocketRegistry } from './messages.socket-registry';

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildHandshake(token?: string): any {
  return {
    auth: token === undefined ? {} : { token },
    headers: {},
  };
}

function buildClient(token?: string, socketId = 'socket-1'): any {
  return {
    id: socketId,
    handshake: buildHandshake(token),
    data: {},
    disconnect: jest.fn(),
    join: jest.fn(),
    emit: jest.fn(),
  };
}

function buildJwtMock(): any {
  return { verifyAsync: jest.fn() };
}

function buildUsersMock(): any {
  return { findAuthorizationStateById: jest.fn() };
}

function buildMessagesServiceMock(): any {
  return { sendMessage: jest.fn() };
}

/** Server Socket.IO mínimo: `to(room).emit(event, payload)`. */
function buildServerMock(): any {
  const emit = jest.fn();
  return { use: jest.fn(), to: jest.fn(() => ({ emit })), emitted: emit };
}

const clientAuthState = {
  id: 10,
  ativo: true,
  tipoUsuario: TipoUsuario.CLIENTE,
  barbeiro: null,
};

const barberAuthState = {
  id: 20,
  ativo: true,
  tipoUsuario: TipoUsuario.BARBEIRO,
  barbeiro: { ativo: true },
};

describe('MessagesGateway', () => {
  let registry: MessagesSocketRegistry;
  let jwt: any;
  let users: any;
  let messagesService: any;
  let gateway: MessagesGateway;

  /** `exp` futuro: socket com JWT ainda válido. */
  const FUTURO = Math.floor(Date.now() / 1000) + 3600;
  /** `exp` passado: JWT expirado durante a vida do socket. */
  const PASSADO = Math.floor(Date.now() / 1000) - 60;

  beforeEach(() => {
    registry = new MessagesSocketRegistry();
    jwt = buildJwtMock();
    users = buildUsersMock();
    messagesService = buildMessagesServiceMock();
    // Por padrão a conta está autorizada (CLIENTE ativo). Cada teste pode
    // sobrescrever para simular desativação após a conexão.
    users.findAuthorizationStateById.mockResolvedValue(clientAuthState);
    gateway = new MessagesGateway(
      registry,
      jwt,
      users,
      messagesService as MessagesService,
    );
  });

  describe('autenticação do handshake', () => {
    it('aceita CLIENTE ativo e anexa identidade do JWT ao socket', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 10 });
      users.findAuthorizationStateById.mockResolvedValue(clientAuthState);
      const client = buildClient('jwt-cliente');

      await gateway.authenticate(client);

      expect(jwt.verifyAsync).toHaveBeenCalledWith('jwt-cliente');
      expect(users.findAuthorizationStateById).toHaveBeenCalledWith(10);
      expect(client.data.usuarioId).toBe(10);
      expect(client.data.tipoUsuario).toBe(TipoUsuario.CLIENTE);
    });

    it('aceita token com prefixo Bearer', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 10 });
      users.findAuthorizationStateById.mockResolvedValue(clientAuthState);
      const client = buildClient('Bearer jwt-cliente');

      await gateway.authenticate(client);

      expect(jwt.verifyAsync).toHaveBeenCalledWith('jwt-cliente');
    });

    it('aceita token vindo do header Authorization', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 10 });
      users.findAuthorizationStateById.mockResolvedValue(clientAuthState);
      const client = buildClient();
      client.handshake.headers.authorization = 'Bearer jwt-header';

      await gateway.authenticate(client);

      expect(jwt.verifyAsync).toHaveBeenCalledWith('jwt-header');
    });

    it('aceita BARBEIRO com perfil ativo', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 20 });
      users.findAuthorizationStateById.mockResolvedValue(barberAuthState);
      const client = buildClient('jwt-barbeiro');

      await gateway.authenticate(client);

      expect(client.data.usuarioId).toBe(20);
      expect(client.data.tipoUsuario).toBe(TipoUsuario.BARBEIRO);
    });

    it('rejeita conexão sem token', async () => {
      await expect(gateway.authenticate(buildClient())).rejects.toThrow(
        'Não autorizado.',
      );
      expect(jwt.verifyAsync).not.toHaveBeenCalled();
      expect(users.findAuthorizationStateById).not.toHaveBeenCalled();
    });

    it('rejeita JWT inválido/expirado sem detalhes internos', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      const client = buildClient('jwt-quebrado');

      await expect(gateway.authenticate(client)).rejects.toThrow(
        'Não autorizado.',
      );
      expect(users.findAuthorizationStateById).not.toHaveBeenCalled();
      expect(client.data.usuarioId).toBeUndefined();
    });

    it('rejeita payload do JWT sem sub válido', async () => {
      jwt.verifyAsync.mockResolvedValue({});
      const client = buildClient('jwt-sem-sub');

      await expect(gateway.authenticate(client)).rejects.toThrow(
        'Não autorizado.',
      );
      expect(users.findAuthorizationStateById).not.toHaveBeenCalled();
    });

    it('rejeita usuário inexistente', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 999 });
      users.findAuthorizationStateById.mockResolvedValue(null);

      await expect(
        gateway.authenticate(buildClient('jwt-fantasma')),
      ).rejects.toThrow('Não autorizado.');
    });

    it('rejeita usuário inativo', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 10 });
      users.findAuthorizationStateById.mockResolvedValue({
        ...clientAuthState,
        ativo: false,
      });

      await expect(
        gateway.authenticate(buildClient('jwt-inativo')),
      ).rejects.toThrow('Não autorizado.');
    });

    it('rejeita BARBEIRO com perfil inativo (mesma regra do RolesGuard)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 20 });
      users.findAuthorizationStateById.mockResolvedValue({
        ...barberAuthState,
        barbeiro: { ativo: false },
      });

      await expect(
        gateway.authenticate(buildClient('jwt-barbeiro-inativo')),
      ).rejects.toThrow('Não autorizado.');
    });

    it('middleware do handshake chama next() sem erro quando autentica', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 10 });
      users.findAuthorizationStateById.mockResolvedValue(clientAuthState);

      const serverMock: any = { use: jest.fn() };
      gateway.afterInit(serverMock);

      const middleware = serverMock.use.mock.calls[0][0];
      const client = buildClient('jwt-cliente');
      const next = jest.fn();
      await middleware(client, next);

      expect(next).toHaveBeenCalledWith();
      expect(client.data.usuarioId).toBe(10);
    });

    it('middleware do handshake chama next(erro) quando autenticação falha', async () => {
      const serverMock: any = { use: jest.fn() };
      gateway.afterInit(serverMock);

      const middleware = serverMock.use.mock.calls[0][0];
      const client = buildClient(); // sem token
      const next = jest.fn();
      await middleware(client, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0] as Error;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Não autorizado.');
    });
  });

  describe('registro de conexão e desconexão', () => {
    const authenticatedClient = (usuarioId: number, socketId: string) => {
      const client = buildClient(undefined, socketId);
      client.data.usuarioId = usuarioId;
      client.data.tipoUsuario = TipoUsuario.CLIENTE;
      return client;
    };

    it('handleConnection registra o socket do usuário autenticado', () => {
      gateway.handleConnection(authenticatedClient(10, 'socket-1'));

      expect(registry.has(10)).toBe(true);
      expect(registry.getSocketIds(10)).toEqual(['socket-1']);
    });

    it('handleConnection desconecta socket sem identidade (defesa)', () => {
      const client = buildClient();

      gateway.handleConnection(client);

      expect(registry.size()).toBe(0);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('handleDisconnect remove o socket do registro', () => {
      const client = authenticatedClient(10, 'socket-1');
      gateway.handleConnection(client);

      gateway.handleDisconnect(client);

      expect(registry.has(10)).toBe(false);
      expect(registry.size()).toBe(0);
    });

    it('handleDisconnect sem identidade não lança erro', () => {
      expect(() => gateway.handleDisconnect(buildClient())).not.toThrow();
    });
  });

  describe('handshake ping/pong', () => {
    it('responde pong com a identidade validada do JWT', () => {
      const client = buildClient();
      client.data.usuarioId = 20;
      client.data.tipoUsuario = TipoUsuario.BARBEIRO;

      const response = gateway.handlePing(client);

      expect(response).toEqual({
        event: 'pong',
        data: { usuarioId: 20, tipoUsuario: TipoUsuario.BARBEIRO },
      });
    });

    it('rejeita ping de socket sem identidade', () => {
      expect(() => gateway.handlePing(buildClient())).toThrow(WsException);
    });
  });

  describe('envio em tempo real (message:send)', () => {
    const createdMessage = {
      id: 500,
      remetenteUsuarioId: 10,
      destinatarioUsuarioId: 20,
      conteudo: 'Olá!',
      lida: false,
      dataCriacao: new Date('2099-01-01T10:00:00.000Z'),
      dataLeitura: null,
    };

    /** Socket autenticado (como se viesse do handshake JWT). */
    const authenticatedClient = (
      usuarioId: number,
      tipoUsuario = TipoUsuario.CLIENTE,
      socketId = 'socket-1',
      tokenExpiraEm: number | null = FUTURO,
    ) => {
      const client = buildClient(undefined, socketId);
      client.data.usuarioId = usuarioId;
      client.data.tipoUsuario = tipoUsuario;
      client.data.tokenExpiraEm = tokenExpiraEm;
      return client;
    };

    beforeEach(() => {
      messagesService.sendMessage.mockResolvedValue(createdMessage);
    });

    it('envio válido: delega ao MessagesService e confirma message:sent', async () => {
      const client = authenticatedClient(10);
      const server = buildServerMock();
      gateway.server = server;

      await gateway.handleMessageSend(client, {
        destinatarioId: 20,
        conteudo: '  Olá!  ',
      });

      // Remetente SEMPRE do socket/JWT, nunca do payload.
      expect(messagesService.sendMessage).toHaveBeenCalledTimes(1);
      const [remetenteUsuarioId, dto] =
        messagesService.sendMessage.mock.calls[0];
      expect(remetenteUsuarioId).toBe(10);
      expect(dto.destinatarioId).toBe(20);
      expect(dto.conteudo).toBe('Olá!');

      // Emitido UMA única vez (o handler não retorna valor, para não
      // duplicar a emissão via ack do Nest).
      expect(client.emit).toHaveBeenCalledTimes(1);
      expect(client.emit).toHaveBeenCalledWith('message:sent', createdMessage);
    });

    it('BARBEIRO autenticado envia para CLIENTE usando a própria identidade', async () => {
      const client = authenticatedClient(20, TipoUsuario.BARBEIRO);
      gateway.server = buildServerMock();
      messagesService.sendMessage.mockResolvedValue({
        ...createdMessage,
        remetenteUsuarioId: 20,
        destinatarioUsuarioId: 10,
      });

      await gateway.handleMessageSend(client, {
        destinatarioId: 10,
        conteudo: 'Resposta',
      });

      expect(messagesService.sendMessage.mock.calls[0][0]).toBe(20);
    });

    it('rejeita payload tentando informar remetente (não confia no cliente)', async () => {
      const client = authenticatedClient(10);

      for (const injected of [
        { remetenteId: 999 },
        { remetenteUsuarioId: 999 },
        { usuarioId: 999 },
        { tipoUsuario: TipoUsuario.BARBEIRO },
      ]) {
        await expect(
          gateway.handleMessageSend(client, {
            destinatarioId: 20,
            conteudo: 'Olá',
            ...injected,
          }),
        ).rejects.toThrow(WsException);
      }

      // Nenhuma tentativa chegou a persistir.
      expect(messagesService.sendMessage).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalled();
    });

    it('rejeita socket sem identidade', async () => {
      const socket = buildClient();

      // A recusa é comunicada via `exception` e o socket é encerrado
      // (ETAPA 7D.1), em vez de lançar.
      await gateway.handleMessageSend(socket, {
        destinatarioId: 20,
        conteudo: 'Olá',
      });

      expect(socket.emit).toHaveBeenCalledWith('exception', {
        status: 'error',
        message: 'Não autorizado.',
      });
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(messagesService.sendMessage).not.toHaveBeenCalled();
    });

    it('rejeita na validação do payload (tipo errado, > 500, ausente, não-objeto)', async () => {
      const client = authenticatedClient(10);

      // Reprovados pela validação do DTO do socket, sem chegar ao service.
      for (const conteudo of ['a'.repeat(501), ['a', 'b'], undefined]) {
        await expect(
          gateway.handleMessageSend(client, { destinatarioId: 20, conteudo }),
        ).rejects.toThrow(WsException);
      }

      await expect(
        gateway.handleMessageSend(client, { conteudo: 'Olá' }),
      ).rejects.toThrow(WsException);
      await expect(
        gateway.handleMessageSend(client, { destinatarioId: 0, conteudo: 'Olá' }),
      ).rejects.toThrow(WsException);
      await expect(
        gateway.handleMessageSend(client, { destinatarioId: -1, conteudo: 'Olá' }),
      ).rejects.toThrow(WsException);
      await expect(gateway.handleMessageSend(client, 'não-objeto')).rejects.toThrow(
        WsException,
      );

      expect(messagesService.sendMessage).not.toHaveBeenCalled();
    });

    it('conteúdo vazio/só espaços é rejeitado pelo service (mesma regra do REST)', async () => {
      const client = authenticatedClient(10);
      gateway.server = buildServerMock();
      // O trim do DTO normaliza para '', e o MessagesService rejeita —
      // exatamente como no POST /messages.
      messagesService.sendMessage.mockRejectedValue(
        new BadRequestException('Conteúdo da mensagem é obrigatório.'),
      );

      for (const conteudo of ['', '   ']) {
        await expect(
          gateway.handleMessageSend(client, { destinatarioId: 20, conteudo }),
        ).rejects.toThrow('Conteúdo da mensagem é obrigatório.');
      }

      expect(client.emit).not.toHaveBeenCalled();
    });

    it('propaga erro de regra de negócio (CLIENTE -> CLIENTE) sem emitir sucesso', async () => {
      const client = authenticatedClient(10);
      gateway.server = buildServerMock();
      messagesService.sendMessage.mockRejectedValue(
        new BadRequestException(
          'Mensagens são permitidas somente entre cliente e barbeiro.',
        ),
      );

      await expect(
        gateway.handleMessageSend(client, { destinatarioId: 11, conteudo: 'Oi' }),
      ).rejects.toThrow('Mensagens são permitidas somente entre cliente e barbeiro.');

      expect(client.emit).not.toHaveBeenCalled();
      expect(gateway.server!.to).not.toHaveBeenCalled();
    });

    it('erro do MessagesService não gera emissão de sucesso nem vaza detalhes internos', async () => {
      const client = authenticatedClient(10);
      gateway.server = buildServerMock();
      // Erro inesperado (ex.: falha de banco) com detalhe interno.
      messagesService.sendMessage.mockRejectedValue(
        new Error('SQL: relation "Mensagem" does not exist'),
      );

      await expect(
        gateway.handleMessageSend(client, { destinatarioId: 20, conteudo: 'Oi' }),
      ).rejects.toThrow('Não foi possível enviar a mensagem.');

      expect(client.emit).not.toHaveBeenCalled();
      expect(gateway.server!.to).not.toHaveBeenCalled();
    });

    it('persistência acontece ANTES de qualquer emissão', async () => {
      const client = authenticatedClient(10);
      const server = buildServerMock();
      gateway.server = server;
      const ordem: string[] = [];
      // Destinatário conectado: garante que message:received seria emitido.
      registry.add(20, 'socket-dest');

      messagesService.sendMessage.mockImplementation(async () => {
        ordem.push('persistir');
        return createdMessage;
      });
      client.emit.mockImplementation(() => ordem.push('message:sent'));
      server.to.mockImplementation(() => ({
        emit: () => ordem.push('message:received'),
      }));

      await gateway.handleMessageSend(client, {
        destinatarioId: 20,
        conteudo: 'Olá!',
      });

      expect(ordem).toEqual(['persistir', 'message:sent', 'message:received']);
      // Exatamente uma persistência por chamada.
      expect(messagesService.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('destinatário conectado recebe message:received', async () => {
      const client = authenticatedClient(10);
      const server = buildServerMock();
      gateway.server = server;
      registry.add(20, 'socket-dest');

      await gateway.handleMessageSend(client, {
        destinatarioId: 20,
        conteudo: 'Olá!',
      });

      expect(server.to).toHaveBeenCalledWith('usuario:20');
      expect(server.emitted).toHaveBeenCalledWith(
        'message:received',
        createdMessage,
      );
    });

    it('TODAS as conexões do destinatário recebem a mensagem', async () => {
      const client = authenticatedClient(10);
      const server = buildServerMock();
      gateway.server = server;
      // Múltiplas abas/dispositivos do mesmo destinatário.
      registry.add(20, 'socket-1');
      registry.add(20, 'socket-2');
      registry.add(20, 'socket-3');

      await gateway.handleMessageSend(client, {
        destinatarioId: 20,
        conteudo: 'Olá!',
      });

      expect(registry.getSocketIds(20)).toHaveLength(3);
      expect(server.to).toHaveBeenCalledWith('usuario:20');
      expect(server.emitted).toHaveBeenCalledTimes(1);
      expect(server.emitted).toHaveBeenCalledWith(
        'message:received',
        createdMessage,
      );
    });

    it('destinatário offline não impede a persistência nem gera erro', async () => {
      const client = authenticatedClient(10);
      const server = buildServerMock();
      gateway.server = server;
      // Nenhuma conexão registrada para o destinatário.

      await gateway.handleMessageSend(client, {
        destinatarioId: 20,
        conteudo: 'Olá!',
      });

      expect(messagesService.sendMessage).toHaveBeenCalledTimes(1);
      expect(client.emit).toHaveBeenCalledWith('message:sent', createdMessage);
      // Nada é emitido para quem não está conectado (sem fila offline).
      expect(server.to).not.toHaveBeenCalled();
    });

    it('a emissão não cria uma segunda persistência', async () => {
      const client = authenticatedClient(10);
      const server = buildServerMock();
      gateway.server = server;
      registry.add(20, 'socket-dest');

      await gateway.handleMessageSend(client, {
        destinatarioId: 20,
        conteudo: 'Olá!',
      });

      expect(messagesService.sendMessage).toHaveBeenCalledTimes(1);
      expect(client.emit).toHaveBeenCalledTimes(1);
      expect(server.emitted).toHaveBeenCalledTimes(1);
    });
  });

  describe('revalidação de autorização durante a vida do socket (ETAPA 7D.1)', () => {
    const createdMessage = {
      id: 900,
      remetenteUsuarioId: 10,
      destinatarioUsuarioId: 20,
      conteudo: 'Olá!',
      lida: false,
      dataCriacao: new Date('2099-01-01T10:00:00.000Z'),
      dataLeitura: null,
    };

    const client = (
      tokenExpiraEm: number | null = FUTURO,
      usuarioId = 10,
      tipoUsuario = TipoUsuario.CLIENTE,
    ) => {
      const socket = buildClient(undefined, 'socket-1');
      socket.data.usuarioId = usuarioId;
      socket.data.tipoUsuario = tipoUsuario;
      socket.data.tokenExpiraEm = tokenExpiraEm;
      return socket;
    };

    beforeEach(() => {
      messagesService.sendMessage.mockResolvedValue(createdMessage);
    });

    it('handshake guarda o exp do JWT (nunca o token) no socket', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 10, exp: FUTURO });
      users.findAuthorizationStateById.mockResolvedValue(clientAuthState);
      const socket = buildClient('jwt-cliente');

      await gateway.authenticate(socket);

      expect(socket.data.tokenExpiraEm).toBe(FUTURO);
      // Nenhuma propriedade do socket contém o token.
      for (const value of Object.values(socket.data)) {
        expect(String(value)).not.toContain('jwt-cliente');
      }
    });

    /** O erro entregue ao cliente, capturado via `client.emit('exception')`. */
    const erroEmitido = (socket: any): string | undefined => {
      const chamada = socket.emit.mock.calls.find(
        (call: any[]) => call[0] === 'exception',
      );
      return chamada?.[1]?.message;
    };

    it('JWT expirado durante o uso: envio recusado, erro emitido, desconectado e nada persistido', async () => {
      const socket = client(PASSADO);
      gateway.server = buildServerMock();

      // A recusa é comunicada ao cliente e o socket é encerrado — não lança,
      // para que o motivo chegue antes da desconexão.
      await expect(
        gateway.handleMessageSend(socket, { destinatarioId: 20, conteudo: 'Oi' }),
      ).resolves.toBeUndefined();

      expect(erroEmitido(socket)).toBe('Não autorizado.');
      expect(messagesService.sendMessage).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('nem consulta a autorização quando o JWT já expirou', async () => {
      const socket = client(PASSADO);

      await gateway.handleMessageSend(socket, {
        destinatarioId: 20,
        conteudo: 'Oi',
      });

      expect(users.findAuthorizationStateById).not.toHaveBeenCalled();
    });

    it('usuário desativado APÓS a conexão: envio recusado, desconectado e removido do registry', async () => {
      const socket = client();
      // Conectou enquanto ativo...
      gateway.handleConnection(socket);
      expect(registry.has(10)).toBe(true);

      // ...e foi desativado no banco depois.
      users.findAuthorizationStateById.mockResolvedValue({
        ...clientAuthState,
        ativo: false,
      });

      await gateway.handleMessageSend(socket, {
        destinatarioId: 20,
        conteudo: 'Oi',
      });

      expect(erroEmitido(socket)).toBe('Não autorizado.');
      expect(messagesService.sendMessage).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(registry.has(10)).toBe(false);
    });

    it('usuário removido do banco após a conexão: envio recusado', async () => {
      const socket = client();
      users.findAuthorizationStateById.mockResolvedValue(null);

      await gateway.handleMessageSend(socket, {
        destinatarioId: 20,
        conteudo: 'Oi',
      });

      expect(erroEmitido(socket)).toBe('Não autorizado.');
      expect(messagesService.sendMessage).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('BARBEIRO com perfil desativado APÓS a conexão: envio recusado', async () => {
      const socket = client(FUTURO, 20, TipoUsuario.BARBEIRO);
      gateway.handleConnection(socket);

      users.findAuthorizationStateById.mockResolvedValue({
        ...barberAuthState,
        barbeiro: { ativo: false },
      });

      await gateway.handleMessageSend(socket, {
        destinatarioId: 10,
        conteudo: 'Oi',
      });

      expect(erroEmitido(socket)).toBe('Não autorizado.');
      expect(messagesService.sendMessage).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(registry.has(20)).toBe(false);
    });

    it('BARBEIRO com perfil ativo continua enviando normalmente', async () => {
      const socket = client(FUTURO, 20, TipoUsuario.BARBEIRO);
      gateway.server = buildServerMock();
      messagesService.sendMessage.mockResolvedValue({
        ...createdMessage,
        remetenteUsuarioId: 20,
        destinatarioUsuarioId: 10,
      });

      await gateway.handleMessageSend(socket, {
        destinatarioId: 10,
        conteudo: 'Resposta',
      });

      expect(messagesService.sendMessage.mock.calls[0][0]).toBe(20);
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('socket válido não é desconectado pela revalidação', async () => {
      const socket = client();
      gateway.handleConnection(socket);
      gateway.server = buildServerMock();

      await gateway.handleMessageSend(socket, {
        destinatarioId: 20,
        conteudo: 'Olá!',
      });

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(registry.has(10)).toBe(true);
    });

    it('mesmo com autorização válida, remetente informado no payload é rejeitado', async () => {
      const socket = client();

      await expect(
        gateway.handleMessageSend(socket, {
          destinatarioId: 20,
          conteudo: 'Olá!',
          remetenteUsuarioId: 999,
        }),
      ).rejects.toThrow('Dados inválidos.');

      expect(messagesService.sendMessage).not.toHaveBeenCalled();
    });

    it('múltiplas conexões do usuário: a revalidação não derruba as demais', async () => {
      const primeira = client();
      const segunda = client();
      segunda.id = 'socket-2';
      gateway.handleConnection(primeira);
      gateway.handleConnection(segunda);
      expect(registry.count(10)).toBe(2);

      users.findAuthorizationStateById.mockResolvedValue({
        ...clientAuthState,
        ativo: false,
      });

      await gateway.handleMessageSend(primeira, {
        destinatarioId: 20,
        conteudo: 'Oi',
      });

      // Só a conexão que tentou enviar foi removida; a outra permanece.
      expect(registry.getSocketIds(10)).toEqual(['socket-2']);
    });

    it('socket sem identidade continua rejeitado', async () => {
      const socket = buildClient();

      await expect(
        gateway.handleMessageSend(socket, {
          destinatarioId: 20,
          conteudo: 'Oi',
        }),
      ).resolves.toBeUndefined();

      expect(erroEmitido(socket)).toBe('Não autorizado.');
      expect(messagesService.sendMessage).not.toHaveBeenCalled();
    });

    it('erro inesperado permanece genérico e sem dados sensíveis', async () => {
      const socket = client();
      gateway.server = buildServerMock();
      messagesService.sendMessage.mockRejectedValue(
        new Error(
          'SQL: SELECT * FROM "Usuario" WHERE senhaHash = $1; jwt=eyJhbGciOi',
        ),
      );

      let capturado: unknown;
      try {
        await gateway.handleMessageSend(socket, {
          destinatarioId: 20,
          conteudo: 'Oi',
        });
      } catch (error) {
        capturado = error;
      }

      expect(capturado).toBeInstanceOf(WsException);
      const texto = JSON.stringify(capturado);
      expect(texto).not.toContain('SQL');
      expect(texto).not.toContain('SELECT');
      expect(texto).not.toContain('senhaHash');
      expect(texto).not.toContain('jwt');
      expect((capturado as Error).message).toBe(
        'Não foi possível enviar a mensagem.',
      );
      expect(socket.emit).not.toHaveBeenCalled();
    });
  });
});
