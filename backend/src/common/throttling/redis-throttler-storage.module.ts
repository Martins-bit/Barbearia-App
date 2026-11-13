import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { RedisThrottlerStorage } from './redis-throttler-storage';
import {
  REDIS_THROTTLER_CLIENT,
  RedisThrottlerClient,
} from './redis-throttler.tokens';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_THROTTLER_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): RedisThrottlerClient => {
        const redisUrl = configService.getOrThrow<string>('REDIS_URL').trim();
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(redisUrl);
        } catch {
          throw new Error('REDIS_URL deve ser uma URL Redis válida.');
        }
        if (!['redis:', 'rediss:'].includes(parsedUrl.protocol)) {
          throw new Error(
            'REDIS_URL deve usar o protocolo redis:// ou rediss://.',
          );
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
      },
    },
    RedisThrottlerStorage,
  ],
  exports: [RedisThrottlerStorage],
})
export class RedisThrottlerStorageModule {}
