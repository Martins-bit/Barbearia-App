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

interface RedisErrorDetails {
  name: string;
  code: string;
  message: string;
}

function getRedisUrlSecrets(redisUrl: string): string[] {
  const secrets = [redisUrl];
  try {
    const url = new URL(redisUrl);
    secrets.push(
      url.hostname,
      url.port,
      url.username,
      url.password,
      url.pathname === '/' ? '' : url.pathname,
      url.search,
      url.hash,
    );
    for (const [key, value] of url.searchParams) {
      secrets.push(key, value);
    }

    for (const value of [...secrets]) {
      if (!value) {
        continue;
      }
      try {
        secrets.push(decodeURIComponent(value));
      } catch {
        // Keep the encoded value when it is not valid percent-encoding.
      }
    }
  } catch {
    // The URL is validated before the client is created.
  }
  return secrets.filter(Boolean);
}

function getRedisErrorDetails(
  error: unknown,
  redisUrl: string,
): RedisErrorDetails {
  const isError = error instanceof Error;
  const errorRecord =
    typeof error === 'object' && error !== null ? error : undefined;
  const rawName = isError ? error.name : 'UnknownError';
  const rawCode =
    errorRecord && 'code' in errorRecord && typeof errorRecord.code === 'string'
      ? errorRecord.code
      : 'unknown';
  const rawMessage = isError ? error.message : 'Unknown Redis client error.';
  const secrets = getRedisUrlSecrets(redisUrl);
  const containsConnectionSecret = (value: string): boolean =>
    secrets.some((secret) =>
      value.toLowerCase().includes(secret.toLowerCase()),
    );
  const safeIdentifier = (value: string): string =>
    /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/.test(value) &&
    !containsConnectionSecret(value)
      ? value
      : 'redacted';

  const flattenedMessage = rawMessage.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  const messageContainsCredentials =
    /\b(password|passwd|token|secret|authorization|credential|username)\s*[:=]\s*\S+/i.test(
      flattenedMessage,
    );
  const safeMessage =
    containsConnectionSecret(flattenedMessage) || messageContainsCredentials
      ? '[message omitted because it may contain connection credentials]'
      : flattenedMessage.replace(
          /\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi,
          '[URL omitted]',
        );

  return {
    name: safeIdentifier(rawName),
    code: safeIdentifier(rawCode),
    message: safeMessage,
  };
}

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
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL').trim();
    let connecting = true;
    let cleaningUp = false;
    const loggedConnectionErrors = new Set<string>();
    const logRedisError = (error: unknown, duringCleanup = false): void => {
      if (cleaningUp && !duringCleanup) {
        return;
      }

      const details = getRedisErrorDetails(error, redisUrl);
      const fingerprint = JSON.stringify(details);
      if (connecting) {
        if (loggedConnectionErrors.has(fingerprint)) {
          return;
        }
        loggedConnectionErrors.add(fingerprint);
      }
      this.logger.error(`Redis client error: ${JSON.stringify(details)}`);
    };

    this.client.on('error', (error) => {
      logRedisError(error);
    });

    try {
      await this.client.connect();
    } catch (error) {
      logRedisError(error);
      connecting = false;
      cleaningUp = true;
      if (this.client.isOpen) {
        try {
          this.client.destroy();
        } catch (cleanupError) {
          logRedisError(cleanupError, true);
        }
      }
      throw new Error('Redis obrigatório indisponível.', { cause: error });
    }
    connecting = false;
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
