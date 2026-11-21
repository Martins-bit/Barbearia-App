import { REDIS_CLIENT } from '../redis/redis.tokens';
import type { RedisClient } from '../redis/redis.tokens';

export const REDIS_THROTTLER_CLIENT = REDIS_CLIENT;
export type RedisThrottlerClient = RedisClient;
