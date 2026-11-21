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
    const client = {
      isOpen: false,
      on: jest.fn(),
      connect: jest
        .fn()
        .mockRejectedValue(new Error('private connection detail')),
      close: jest.fn(),
      destroy: jest.fn(),
      eval: jest.fn(),
    };
    mockedCreateClient.mockReturnValue(client as never);

    const moduleRef = await Test.createTestingModule({
      imports: [RedisModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
      })
      .compile();

    await expect(moduleRef.init()).rejects.toThrow(
      'Redis obrigatório indisponível.',
    );
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
