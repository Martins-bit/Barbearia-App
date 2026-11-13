import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { REDIS_THROTTLER_CLIENT } from './redis-throttler.tokens';
import type { RedisThrottlerClient } from './redis-throttler.tokens';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

const INCREMENT_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockedHits = redis.call('GET', KEYS[2])
if blockedHits then
  local blockTtl = redis.call('PTTL', KEYS[2])
  if blockTtl > 0 then
    local remaining = math.ceil(blockTtl / 1000)
    return { tonumber(blockedHits), remaining, 1, remaining }
  end
  redis.call('DEL', KEYS[2])
end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - ttl)
local hits = redis.call('ZCARD', KEYS[1])
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local timeToExpire = math.ceil(ttl / 1000)
if #oldest > 0 then
  timeToExpire = math.max(0, math.ceil((tonumber(oldest[2]) + ttl - now) / 1000))
end

if blockDuration <= 0 and hits >= limit then
  return { hits + 1, timeToExpire, 1, timeToExpire }
end

redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], math.max(1, math.ceil(ttl)))
hits = hits + 1

if blockDuration > 0 and hits > limit then
  local duration = math.max(1, math.ceil(blockDuration))
  redis.call('SET', KEYS[2], hits, 'PX', duration)
  redis.call('DEL', KEYS[1])
  return { hits, math.ceil(ttl / 1000), 1, math.ceil(duration / 1000) }
end

oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #oldest > 0 then
  timeToExpire = math.max(0, math.ceil((tonumber(oldest[2]) + ttl - now) / 1000))
end
return { hits, timeToExpire, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(
    @Inject(REDIS_THROTTLER_CLIENT)
    private readonly client: RedisThrottlerClient,
  ) {
    this.client.on('error', () => {
      this.logger.error('Redis indisponível para o rate limit.');
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch {
      this.client.destroy();
      this.logger.error('Não foi possível conectar ao Redis obrigatório.');
      throw new Error('Redis obrigatório para rate limiting indisponível.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (
      !this.client.isReady ||
      !Number.isFinite(ttl) ||
      ttl <= 0 ||
      !Number.isFinite(limit) ||
      limit < 1 ||
      !Number.isFinite(blockDuration) ||
      blockDuration < 0
    ) {
      throw new Error('Configuração ou conexão do rate limit inválida.');
    }

    const baseKey = `barbearia:throttle:{${throttlerName}:${key}}`;
    const result = await this.client.eval(INCREMENT_SCRIPT, {
      keys: [baseKey, `${baseKey}:blocked`],
      arguments: [
        String(ttl),
        String(limit),
        String(blockDuration),
        randomUUID(),
      ],
    });

    if (!Array.isArray(result) || result.length !== 4) {
      throw new Error('Resposta inválida do storage Redis de rate limit.');
    }

    const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] =
      result.map(Number);
    if (
      !Number.isFinite(totalHits) ||
      !Number.isFinite(timeToExpire) ||
      !Number.isFinite(isBlocked) ||
      !Number.isFinite(timeToBlockExpire)
    ) {
      throw new Error('Resposta inválida do storage Redis de rate limit.');
    }

    return {
      totalHits,
      timeToExpire,
      isBlocked: isBlocked === 1,
      timeToBlockExpire,
    };
  }
}
