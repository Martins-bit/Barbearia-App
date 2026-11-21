import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { REDIS_CLIENT } from './redis.tokens';
import type { RedisClient } from './redis.tokens';

function createRedisClient(configService: ConfigService): RedisClient {
  const redisUrl = configService.getOrThrow<string>('REDIS_URL').trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(redisUrl);
  } catch {
    throw new Error('REDIS_URL deve ser uma URL Redis válida.');
  }
  if (!['redis:', 'rediss:'].includes(parsedUrl.protocol)) {
    throw new Error('REDIS_URL deve usar o protocolo redis:// ou rediss://.');
  }

  let connectedOnce = false;
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => {
        if (!connectedOnce && retries >= 3) {
          return false;
        }
        return Math.min((retries + 1) * 200, 3_000);
      },
    },
  });
  client.on('ready', () => {
    connectedOnce = true;
  });
  return client;
}

@Injectable()
class RedisClientLifecycle implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisClientLifecycle.name);

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: RedisClient,
  ) {}

  async onModuleInit(): Promise<void> {
    this.client.on('error', () => {
      this.logger.error('Redis indisponível para serviços compartilhados.');
    });

    try {
      await this.client.connect();
    } catch {
      this.client.destroy();
      this.logger.error('Não foi possível conectar ao Redis obrigatório.');
      throw new Error('Redis obrigatório indisponível.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: createRedisClient,
    },
    RedisClientLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
