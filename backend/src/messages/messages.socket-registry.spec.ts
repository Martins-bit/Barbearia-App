import { MessagesSocketRegistry } from './messages.socket-registry';

describe('MessagesSocketRegistry', () => {
  let registry: MessagesSocketRegistry;

  beforeEach(() => {
    registry = new MessagesSocketRegistry();
  });

  it('registra e localiza sockets por usuário', () => {
    registry.add(10, 'socket-a');

    expect(registry.has(10)).toBe(true);
    expect(registry.count(10)).toBe(1);
    expect(registry.getSocketIds(10)).toEqual(['socket-a']);
    expect(registry.size()).toBe(1);
  });

  it('permite múltiplos sockets simultâneos para o mesmo usuário', () => {
    registry.add(10, 'socket-a');
    registry.add(10, 'socket-b');
    registry.add(20, 'socket-c');

    expect(registry.getSocketIds(10).sort()).toEqual(['socket-a', 'socket-b']);
    expect(registry.count(10)).toBe(2);
    expect(registry.count(20)).toBe(1);
    expect(registry.size()).toBe(3);
  });

  it('remove socket específico preservando as demais conexões do usuário', () => {
    registry.add(10, 'socket-a');
    registry.add(10, 'socket-b');

    registry.remove(10, 'socket-a');

    expect(registry.getSocketIds(10)).toEqual(['socket-b']);
    expect(registry.has(10)).toBe(true);
  });

  it('remove a entrada do usuário quando o último socket é encerrado', () => {
    registry.add(10, 'socket-a');

    registry.remove(10, 'socket-a');

    expect(registry.has(10)).toBe(false);
    expect(registry.getSocketIds(10)).toEqual([]);
    expect(registry.count(10)).toBe(0);
    expect(registry.size()).toBe(0);
  });

  it('remoção é idempotente e ignora usuários/socketes desconhecidos', () => {
    registry.add(10, 'socket-a');

    registry.remove(999, 'socket-x');
    registry.remove(10, 'socket-x');
    registry.remove(10, 'socket-a');
    registry.remove(10, 'socket-a');

    expect(registry.size()).toBe(0);
    expect(() => registry.remove(10, 'socket-a')).not.toThrow();
  });

  it('getSocketIds retorna cópia (snapshot) sem expor a estrutura interna', () => {
    registry.add(10, 'socket-a');

    const snapshot = registry.getSocketIds(10);
    snapshot.push('socket-fantasma');

    expect(registry.getSocketIds(10)).toEqual(['socket-a']);
  });
});
