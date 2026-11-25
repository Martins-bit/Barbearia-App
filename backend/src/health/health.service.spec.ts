import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { REDIS_CLIENT } from '../common/redis/redis.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const queryDatabase = jest.fn();
  const pingRedis = jest.fn();

  beforeEach(async () => {
    queryDatabase.mockReset().mockResolvedValue(1);
    pingRedis.mockReset().mockResolvedValue('PONG');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: { $queryRaw: queryDatabase },
        },
        {
          provide: REDIS_CLIENT,
          useValue: { ping: pingRedis },
        },
      ],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports readiness when PostgreSQL and Redis respond', async () => {
    await expect(service.check()).resolves.toEqual({ status: 'ok' });
    expect(queryDatabase).toHaveBeenCalledTimes(1);
    expect(pingRedis).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'PostgreSQL',
      () =>
        queryDatabase.mockRejectedValue(new Error('private database detail')),
    ],
    [
      'Redis',
      () => pingRedis.mockRejectedValue(new Error('private Redis detail')),
    ],
  ])(
    'returns a sanitized 503 when %s is unavailable',
    async (_dependency, fail) => {
      fail();
      const error = await service.check().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      if (!(error instanceof ServiceUnavailableException)) return;

      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toEqual({
        message: 'Serviço temporariamente indisponível.',
        error: 'Service Unavailable',
        statusCode: 503,
      });
    },
  );
});
