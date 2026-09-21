import { WsException } from '@nestjs/websockets';
import { TipoUsuario } from '../generated/prisma/enums';
import { MessagesGateway } from './messages.gateway';
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
  };
}

function buildJwtMock(): any {
  return { verifyAsync: jest.fn() };
}

function buildUsersMock(): any {
  return { findAuthorizationStateById: jest.fn() };
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
  let gateway: MessagesGateway;

  beforeEach(() => {
    registry = new MessagesSocketRegistry();
    jwt = buildJwtMock();
    users = buildUsersMock();
    gateway = new MessagesGateway(registry, jwt, users);
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
});
