import { RedisThrottlerStorage } from './redis-throttler-storage';
import { RedisThrottlerClient } from './redis-throttler.tokens';

describe('RedisThrottlerStorage', () => {
  function createStorage(isReady: boolean, evalImplementation?: jest.Mock) {
    const client = {
      isReady,
      on: jest.fn(),
      eval: evalImplementation ?? jest.fn().mockResolvedValue([1, 60, 0, 0]),
      connect: jest.fn(),
      destroy: jest.fn(),
      close: jest.fn(),
    };
    return {
      storage: new RedisThrottlerStorage(
        client as unknown as RedisThrottlerClient,
      ),
      client,
    };
  }

  it('uses the atomic Redis script and maps its shared counter result', async () => {
    const evalMock = jest.fn().mockResolvedValue([5, 23, 1, 23]);
    const { storage, client } = createStorage(true, evalMock);

    await expect(
      storage.increment('request-key', 60_000, 5, 0, 'default'),
    ).resolves.toEqual({
      totalHits: 5,
      timeToExpire: 23,
      isBlocked: true,
      timeToBlockExpire: 23,
    });

    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0][0]).toContain('ZREMRANGEBYSCORE');
    expect(evalMock.mock.calls[0][1].keys).toEqual([
      'barbearia:throttle:{default:request-key}',
      'barbearia:throttle:{default:request-key}:blocked',
    ]);
    expect(evalMock.mock.calls[0][1].arguments.slice(0, 3)).toEqual([
      '60000',
      '5',
      '0',
    ]);
    expect(evalMock.mock.calls[0][1].arguments[3]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('fails closed without falling back when Redis is not ready', async () => {
    const evalMock = jest.fn();
    const { storage } = createStorage(false, evalMock);

    await expect(
      storage.increment('request-key', 60_000, 5, 0, 'default'),
    ).rejects.toThrow('Configuração ou conexão do rate limit inválida.');
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('propagates Redis command failures instead of using local counters', async () => {
    const evalMock = jest
      .fn()
      .mockRejectedValue(new Error('redis unavailable'));
    const { storage } = createStorage(true, evalMock);

    await expect(
      storage.increment('request-key', 60_000, 5, 0, 'default'),
    ).rejects.toThrow('redis unavailable');
  });

  it('fails application startup if the initial Redis connection fails', async () => {
    const { storage, client } = createStorage(true);
    client.connect.mockRejectedValue(new Error('redis unavailable'));

    await expect(storage.onModuleInit()).rejects.toThrow(
      'Redis obrigatório para rate limiting indisponível.',
    );
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
