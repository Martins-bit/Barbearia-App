import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { REDIS_CLIENT } from '../common/redis/redis.tokens';
import type { RedisClient } from '../common/redis/redis.tokens';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
  ) {}

  async check(): Promise<{ status: 'ok' }> {
    const checks = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);

    if (checks.some((check) => check.status === 'rejected')) {
      this.logger.error('Readiness check failed for a required dependency.');
      throw new ServiceUnavailableException(
        'Serviço temporariamente indisponível.',
      );
    }

    return { status: 'ok' };
  }
}
