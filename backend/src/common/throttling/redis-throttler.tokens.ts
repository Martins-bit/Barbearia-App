import { createClient } from 'redis';

export const REDIS_THROTTLER_CLIENT = Symbol('REDIS_THROTTLER_CLIENT');
export type RedisThrottlerClient = ReturnType<typeof createClient>;
