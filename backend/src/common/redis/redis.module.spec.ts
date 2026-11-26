import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { REDIS_CLIENT } from './redis.tokens';
import { RedisModule } from './redis.module';
import { RedisThrottlerStorage } from '../throttling/redis-throttler-storage';
import { REDIS_THROTTLER_CLIENT } from '../throttling/redis-throttler.tokens';
import { RedisThrottlerStorageModule } from '../throttling/redis-throttler-storage.module';

jest.mock('redis', () => ({ createClient: jest.fn() }), { virtual: true });

describe('RedisModule shared client', () => {
  const mockedCreateClient = jest.mocked(createClient);

  beforeEach(() => {
    mockedCreateClient.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shares one client and centralizes connect and close lifecycle', async () => {
    const client: {
      isOpen: boolean;
      on: jest.Mock;
      connect: jest.Mock;
      close: jest.Mock;
      destroy: jest.Mock;
      eval: jest.Mock;
    } = {
      isOpen: true,
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
      destroy: jest.fn(),
      eval: jest.fn(),
    };
    client.close.mockImplementation(async () => {
      client.isOpen = false;
    });
    mockedCreateClient.mockReturnValue(client as never);

    const moduleRef = await Test.createTestingModule({
      imports: [RedisModule, RedisThrottlerStorageModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
      })
      .compile();

    await moduleRef.init();
    expect(moduleRef.get(REDIS_CLIENT)).toBe(
      moduleRef.get(REDIS_THROTTLER_CLIENT),
    );
    expect(moduleRef.get(RedisThrottlerStorage)).toBeDefined();
    expect(mockedCreateClient).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));

    await moduleRef.close();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('rejects startup when the shared client cannot connect', async () => {
    const redisUrl =
      'rediss://default:redis-password@redis.example:6380/0?token=redis-token';
    const connectionError = Object.assign(
      new Error(`Connection failed for ${redisUrl}`),
      { code: 'ECONNREFUSED' },
    );
    const errorListeners: Array<(error: Error) => void> = [];
    const client = {
      isOpen: false,
      on: jest.fn((event: string, listener: (error: Error) => void) => {
        if (event === 'error') {
          errorListeners.push(listener);
        }
      }),
      connect: jest.fn().mockImplementation(async () => {
        errorListeners[0](connectionError);
        throw connectionError;
      }),
      close: jest.fn(),
      destroy: jest.fn(() => {
        throw new Error('ClientClosedError: The client is closed');
      }),
      eval: jest.fn(),
    };
    mockedCreateClient.mockReturnValue(client as never);
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      imports: [RedisModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: jest.fn().mockReturnValue(redisUrl),
      })
      .compile();

    let startupError: unknown;
    try {
      await moduleRef.init();
    } catch (error) {
      startupError = error;
    }

    expect(startupError).toBeInstanceOf(Error);
    expect((startupError as Error).message).toBe(
      'Redis obrigatório indisponível.',
    );
    expect((startupError as Error).cause).toBe(connectionError);
    expect(client.destroy).not.toHaveBeenCalled();

    const redisLogs = loggerError.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('Redis client error:'));
    expect(redisLogs).toHaveLength(1);
    expect(redisLogs[0]).toContain('ECONNREFUSED');
    expect(redisLogs[0]).toContain('Error');
    expect(redisLogs[0]).not.toContain('rediss://');
    expect(redisLogs[0]).not.toContain('redis-password');
    expect(redisLogs[0]).not.toContain('redis-token');
    expect(redisLogs[0]).not.toContain('redis.example');
  });

  it('preserves the connection error if client cleanup also fails', async () => {
    const connectionError = new Error('Connection refused');
    const client = {
      isOpen: true,
      on: jest.fn(),
      connect: jest.fn().mockRejectedValue(connectionError),
      close: jest.fn(),
      destroy: jest.fn(() => {
        throw new Error('ClientClosedError: The client is closed');
      }),
      eval: jest.fn(),
    };
    mockedCreateClient.mockReturnValue(client as never);
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      imports: [RedisModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
      })
      .compile();

    let startupError: unknown;
    try {
      await moduleRef.init();
    } catch (error) {
      startupError = error;
    }

    expect(startupError).toBeInstanceOf(Error);
    expect((startupError as Error).cause).toBe(connectionError);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledTimes(2);
  });
});
