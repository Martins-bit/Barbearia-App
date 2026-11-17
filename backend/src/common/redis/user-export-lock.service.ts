import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RedisClient } from './redis.tokens';
import { REDIS_CLIENT } from './redis.tokens';

const LOCK_KEY_PREFIX = 'barbearia:lgpd-export-lock:v1:user:';
const LOCK_REDIS_COMMAND_TIMEOUT_MS = 5_000;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class UserExportLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserExportLockError';
  }
}

export interface UserExportLock {
  readonly lost: AbortSignal;
  renew(): Promise<void>;
  stopRenewal(): Promise<void>;
  release(): Promise<boolean>;
}

export type UserExportLockAcquisition =
  | { acquired: false; reason: 'LOCKED' }
  | { acquired: true; lock: UserExportLock };

export interface UserExportLockOptions {
  ttlMs: number;
  renewalIntervalMs?: number;
}

@Injectable()
export class UserExportLockService implements OnModuleDestroy {
  private readonly activeRenewals = new Set<() => Promise<void>>();
  private readonly boundedCommandClient: RedisClient;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: RedisClient,
  ) {
    this.boundedCommandClient = client.withCommandOptions({
      timeout: LOCK_REDIS_COMMAND_TIMEOUT_MS,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.activeRenewals].map((stop) => stop()));
  }

  async tryAcquire(
    internalUserId: number,
    options: UserExportLockOptions,
  ): Promise<UserExportLockAcquisition> {
    if (!Number.isSafeInteger(internalUserId) || internalUserId <= 0) {
      throw new TypeError('O identificador interno do titular é inválido.');
    }

    const { ttlMs, renewalIntervalMs = Math.floor(options.ttlMs / 3) } =
      options;
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 3 ||
      !Number.isSafeInteger(renewalIntervalMs) ||
      renewalIntervalMs < 1 ||
      renewalIntervalMs >= ttlMs
    ) {
      throw new TypeError('TTL ou intervalo de renovação do lock inválido.');
    }

    const key = `${LOCK_KEY_PREFIX}${internalUserId}`;
    const token = randomBytes(32).toString('hex');
    const leaseStartedAt = performance.now();
    let response: string | null;
    try {
      response = await this.boundedCommandClient.set(key, token, {
        NX: true,
        PX: ttlMs,
      });
    } catch {
      throw new UserExportLockError(
        'Não foi possível confirmar a aquisição do lock Redis.',
      );
    }

    if (response === null) {
      return { acquired: false, reason: 'LOCKED' };
    }
    if (response !== 'OK') {
      throw new UserExportLockError(
        'Resposta inválida ao adquirir o lock Redis.',
      );
    }

    return {
      acquired: true,
      lock: this.createLock(
        key,
        token,
        ttlMs,
        renewalIntervalMs,
        leaseStartedAt,
      ),
    };
  }

  private createLock(
    key: string,
    token: string,
    ttlMs: number,
    renewalIntervalMs: number,
    initialLeaseStartedAt: number,
  ): UserExportLock {
    const abortController = new AbortController();
    let ownership: 'owned' | 'lost' | 'released' = 'owned';
    let stopped = false;
    let releasing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let renewalInFlight: Promise<void> | undefined;
    let releaseInFlight: Promise<boolean> | undefined;
    let lastLeaseStartedAt = initialLeaseStartedAt;
    let unregisterRenewal = (): void => undefined;

    const markLost = (reason: Error): void => {
      if (ownership === 'owned') {
        ownership = 'lost';
        abortController.abort(reason);
      }
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      unregisterRenewal();
    };

    const renew = (): Promise<void> => {
      if (ownership !== 'owned' || releasing) {
        return Promise.reject(
          new UserExportLockError('A propriedade do lock não está ativa.'),
        );
      }
      if (renewalInFlight) {
        return renewalInFlight;
      }

      renewalInFlight = (async () => {
        let result: unknown;
        const requestStartedAt = performance.now();
        const remainingLeaseMs =
          ttlMs - (requestStartedAt - lastLeaseStartedAt);
        if (remainingLeaseMs <= 1) {
          const error = new UserExportLockError(
            'O prazo do lock Redis expirou antes da renovação.',
          );
          markLost(error);
          throw error;
        }

        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const renewal = this.client.eval(RENEW_SCRIPT, {
            keys: [key],
            arguments: [token, String(ttlMs)],
          });
          const deadline = new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new UserExportLockError(
                    'A renovação do lock Redis não foi confirmada antes do prazo.',
                  ),
                ),
              Math.max(1, Math.floor(remainingLeaseMs / 2)),
            );
          });
          result = await Promise.race([renewal, deadline]);
        } catch {
          const error = new UserExportLockError(
            'Não foi possível confirmar a renovação do lock Redis.',
          );
          markLost(error);
          throw error;
        } finally {
          if (timeout) {
            clearTimeout(timeout);
          }
        }

        if (result !== 1) {
          const error = new UserExportLockError(
            'A propriedade do lock Redis foi perdida ou não pôde ser confirmada.',
          );
          markLost(error);
          throw error;
        }
        lastLeaseStartedAt = requestStartedAt;
      })().finally(() => {
        renewalInFlight = undefined;
      });

      return renewalInFlight;
    };

    const scheduleRenewal = (): void => {
      if (stopped || ownership !== 'owned') {
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        void renew()
          .then(scheduleRenewal)
          .catch(() => undefined);
      }, renewalIntervalMs);
      timer.unref?.();
    };

    const stopRenewal = async (): Promise<void> => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await renewalInFlight?.catch(() => undefined);
      unregisterRenewal();
    };

    this.activeRenewals.add(stopRenewal);
    unregisterRenewal = () => this.activeRenewals.delete(stopRenewal);
    scheduleRenewal();

    return {
      lost: abortController.signal,
      renew,
      stopRenewal,
      release: () => {
        if (releaseInFlight) {
          return releaseInFlight;
        }
        if (ownership === 'released') {
          return Promise.resolve(false);
        }

        releasing = true;
        releaseInFlight = (async () => {
          await stopRenewal();

          let result: unknown;
          try {
            result = await this.boundedCommandClient.eval(RELEASE_SCRIPT, {
              keys: [key],
              arguments: [token],
            });
          } catch {
            const error = new UserExportLockError(
              'Não foi possível confirmar a liberação do lock Redis.',
            );
            markLost(error);
            throw error;
          }

          if (result === 1) {
            ownership = 'released';
            return true;
          }
          if (result === 0) {
            markLost(
              new UserExportLockError(
                'A propriedade do lock Redis foi perdida antes da liberação.',
              ),
            );
            return false;
          }
          const error = new UserExportLockError(
            'Resposta inválida ao liberar o lock Redis.',
          );
          markLost(error);
          throw error;
        })();
        return releaseInFlight;
      },
    };
  }
}
