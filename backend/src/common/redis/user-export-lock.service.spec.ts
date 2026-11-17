import { UserExportLockService } from './user-export-lock.service';
import type { RedisClient } from './redis.tokens';

class MockRedis {
  readonly values = new Map<string, { token: string; expiresAt: number }>();
  readonly commandTimeouts: number[] = [];
  setFailure: Error | undefined;
  evalFailure: Error | undefined;
  evalResult: unknown;
  setPending = false;
  setPendingAfterWrite = false;
  evalPending = false;
  evalPendingAfterExecution = false;

  withCommandOptions(options: { timeout: number }) {
    this.commandTimeouts.push(options.timeout);
    return {
      set: (key: string, token: string, setOptions: { NX: true; PX: number }) =>
        this.withCommandTimeout(
          this.set(key, token, setOptions),
          options.timeout,
        ),
      eval: (
        script: string,
        evalOptions: { keys: string[]; arguments: string[] },
      ) =>
        this.withCommandTimeout(
          this.eval(script, evalOptions),
          options.timeout,
        ),
    };
  }

  private withCommandTimeout<T>(
    command: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Redis command timed out'));
      }, timeoutMs);

      void command.then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async set(
    key: string,
    token: string,
    options: { NX: true; PX: number },
  ): Promise<string | null> {
    if (this.setFailure) {
      throw this.setFailure;
    }
    if (this.setPending) {
      return new Promise<string | null>(() => undefined);
    }

    const current = this.values.get(key);
    if (current && current.expiresAt > Date.now()) {
      return null;
    }
    this.values.set(key, {
      token,
      expiresAt: Date.now() + options.PX,
    });
    if (this.setPendingAfterWrite) {
      return new Promise<string | null>(() => undefined);
    }
    return 'OK';
  }

  async eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    if (this.evalFailure) {
      throw this.evalFailure;
    }
    if (this.evalPending) {
      return new Promise<unknown>(() => undefined);
    }
    if (this.evalResult !== undefined) {
      return this.evalResult;
    }

    const [key] = options.keys;
    const [token, ttl] = options.arguments;
    const current = this.values.get(key);
    if (!current || current.expiresAt <= Date.now()) {
      this.values.delete(key);
      return 0;
    }
    if (current.token !== token) {
      return 0;
    }
    if (script.includes('PEXPIRE')) {
      current.expiresAt = Date.now() + Number(ttl);
      return 1;
    }
    if (script.includes('DEL')) {
      this.values.delete(key);
      if (this.evalPendingAfterExecution) {
        return new Promise<unknown>(() => undefined);
      }
      return 1;
    }
    throw new Error('Unexpected lock script');
  }
}

describe('UserExportLockService', () => {
  let redis: MockRedis;
  let service: UserExportLockService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    redis = new MockRedis();
    service = new UserExportLockService(redis as unknown as RedisClient);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('acquires a lock with an unpredictable token and required TTL', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 300 });

    expect(result.acquired).toBe(true);
    expect(redis.values.get('barbearia:lgpd-export-lock:v1:user:12')).toEqual({
      token: expect.stringMatching(/^[0-9a-f]{64}$/),
      expiresAt: 300,
    });
    if (result.acquired) {
      await result.lock.release();
    }
  });

  it('returns an explicit busy result when the lock is occupied', async () => {
    const first = await service.tryAcquire(12, { ttlMs: 300 });

    await expect(service.tryAcquire(12, { ttlMs: 300 })).resolves.toEqual({
      acquired: false,
      reason: 'LOCKED',
    });
    if (first.acquired) {
      await first.lock.release();
    }
  });

  it('allows only one of two simultaneous acquisitions for the same user', async () => {
    const results = await Promise.all([
      service.tryAcquire(12, { ttlMs: 300 }),
      service.tryAcquire(12, { ttlMs: 300 }),
    ]);

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(results.filter((result) => !result.acquired)).toHaveLength(1);
    const owner = results.find((result) => result.acquired);
    if (owner?.acquired) {
      await owner.lock.release();
    }
  });

  it('allows different users to acquire independent locks', async () => {
    const first = await service.tryAcquire(12, { ttlMs: 300 });
    const second = await service.tryAcquire(13, { ttlMs: 300 });

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(true);
    if (first.acquired) await first.lock.release();
    if (second.acquired) await second.lock.release();
  });

  it('renews the lock for its owner', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 300 });
    if (!result.acquired) throw new Error('Expected lock acquisition');

    await expect(result.lock.renew()).resolves.toBeUndefined();
    expect(result.lock.lost.aborted).toBe(false);
    await result.lock.release();
  });

  it('renews automatically before the TTL and can stop the timer', async () => {
    const result = await service.tryAcquire(12, {
      ttlMs: 300,
      renewalIntervalMs: 100,
    });
    if (!result.acquired) throw new Error('Expected lock acquisition');

    await jest.advanceTimersByTimeAsync(100);

    expect(
      redis.values.get('barbearia:lgpd-export-lock:v1:user:12')?.expiresAt,
    ).toBe(400);
    await result.lock.stopRenewal();
    expect(jest.getTimerCount()).toBe(0);
    await result.lock.release();
  });

  it('rejects renewal when the stored token does not match', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 300 });
    if (!result.acquired) throw new Error('Expected lock acquisition');
    redis.values.get('barbearia:lgpd-export-lock:v1:user:12')!.token = 'other';

    await expect(result.lock.renew()).rejects.toThrow(
      'A propriedade do lock Redis foi perdida',
    );
    expect(result.lock.lost.aborted).toBe(true);
    expect(await result.lock.release()).toBe(false);
    expect(
      redis.values.get('barbearia:lgpd-export-lock:v1:user:12')?.token,
    ).toBe('other');
  });

  it('releases the lock for its owner', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 300 });
    if (!result.acquired) throw new Error('Expected lock acquisition');

    await expect(result.lock.release()).resolves.toBe(true);
    expect(redis.values.has('barbearia:lgpd-export-lock:v1:user:12')).toBe(
      false,
    );
  });

  it('fails closed when release times out and lets the lease expire', async () => {
    const result = await service.tryAcquire(12, {
      ttlMs: 30_000,
      renewalIntervalMs: 10_000,
    });
    if (!result.acquired) throw new Error('Expected lock acquisition');
    redis.evalPending = true;

    const release = result.lock.release();
    const releaseRejection = expect(release).rejects.toThrow(
      'Não foi possível confirmar a liberação do lock Redis.',
    );
    await jest.advanceTimersByTimeAsync(5_000);

    await releaseRejection;
    expect(result.lock.lost.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await expect(service.tryAcquire(12, { ttlMs: 30_000 })).resolves.toEqual({
      acquired: false,
      reason: 'LOCKED',
    });

    await jest.advanceTimersByTimeAsync(25_001);
    redis.evalPending = false;
    const retry = await service.tryAcquire(12, { ttlMs: 30_000 });
    expect(retry.acquired).toBe(true);
    if (retry.acquired) await retry.lock.release();
  });

  it('does not report success when release executed but its reply timed out', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 30_000 });
    if (!result.acquired) throw new Error('Expected lock acquisition');
    redis.evalPendingAfterExecution = true;

    const release = result.lock.release();
    const releaseRejection = expect(release).rejects.toThrow(
      'Não foi possível confirmar a liberação do lock Redis.',
    );
    await jest.advanceTimersByTimeAsync(5_000);

    await releaseRejection;
    expect(redis.values.has('barbearia:lgpd-export-lock:v1:user:12')).toBe(
      false,
    );
    expect(result.lock.lost.aborted).toBe(true);
  });

  it('does not release a lock with a different owner token', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 300 });
    if (!result.acquired) throw new Error('Expected lock acquisition');
    redis.values.get('barbearia:lgpd-export-lock:v1:user:12')!.token = 'other';

    await expect(result.lock.release()).resolves.toBe(false);
    expect(
      redis.values.get('barbearia:lgpd-export-lock:v1:user:12')?.token,
    ).toBe('other');
  });

  it('allows a new acquisition after the TTL expires', async () => {
    const first = await service.tryAcquire(12, { ttlMs: 300 });
    if (!first.acquired) throw new Error('Expected first lock acquisition');
    await first.lock.stopRenewal();
    await jest.advanceTimersByTimeAsync(301);

    const second = await service.tryAcquire(12, { ttlMs: 300 });
    expect(second.acquired).toBe(true);
    if (second.acquired) await second.lock.release();
    await first.lock.release();
  });

  it('fails closed when Redis acquisition throws', async () => {
    redis.setFailure = new Error('private connection detail');

    await expect(service.tryAcquire(12, { ttlMs: 300 })).rejects.toThrow(
      'Não foi possível confirmar a aquisição do lock Redis.',
    );
  });

  it('fails closed when acquisition times out after Redis may have set the lease', async () => {
    redis.setPendingAfterWrite = true;
    const acquisition = service.tryAcquire(12, { ttlMs: 30_000 });
    const acquisitionRejection = expect(acquisition).rejects.toThrow(
      'Não foi possível confirmar a aquisição do lock Redis.',
    );

    await jest.advanceTimersByTimeAsync(5_000);

    await acquisitionRejection;
    expect(redis.commandTimeouts).toEqual([5_000]);
    expect(
      redis.values.get('barbearia:lgpd-export-lock:v1:user:12')?.expiresAt,
    ).toBe(30_000);
    await expect(service.tryAcquire(12, { ttlMs: 30_000 })).resolves.toEqual({
      acquired: false,
      reason: 'LOCKED',
    });

    await jest.advanceTimersByTimeAsync(25_001);
    redis.setPendingAfterWrite = false;
    const retry = await service.tryAcquire(12, { ttlMs: 30_000 });
    expect(retry.acquired).toBe(true);
    if (retry.acquired) await retry.lock.release();
  });

  it('fails closed when acquisition remains pending without acquiring a lease', async () => {
    redis.setPending = true;
    const acquisition = service.tryAcquire(12, { ttlMs: 30_000 });
    const acquisitionRejection = expect(acquisition).rejects.toThrow(
      'Não foi possível confirmar a aquisição do lock Redis.',
    );

    await jest.advanceTimersByTimeAsync(5_000);

    await acquisitionRejection;
    expect(redis.values.has('barbearia:lgpd-export-lock:v1:user:12')).toBe(
      false,
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('fails closed on an invalid Redis acquisition response', async () => {
    jest.spyOn(redis, 'set').mockResolvedValue('unexpected' as 'OK');

    await expect(service.tryAcquire(12, { ttlMs: 300 })).rejects.toThrow(
      'Resposta inválida ao adquirir o lock Redis.',
    );
  });

  it('signals loss when a renewal command fails', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 300 });
    if (!result.acquired) throw new Error('Expected lock acquisition');
    redis.evalFailure = new Error('private connection detail');

    await expect(result.lock.renew()).rejects.toThrow(
      'Não foi possível confirmar a renovação',
    );
    expect(result.lock.lost.aborted).toBe(true);
    await expect(result.lock.release()).rejects.toThrow(
      'Não foi possível confirmar a liberação',
    );
  });

  it('treats an ambiguous renewal response as loss of ownership', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 300 });
    if (!result.acquired) throw new Error('Expected lock acquisition');
    redis.evalResult = null;

    await expect(result.lock.renew()).rejects.toThrow(
      'A propriedade do lock Redis foi perdida',
    );
    expect(result.lock.lost.aborted).toBe(true);
  });

  it('signals loss before TTL expiry when renewal stays pending', async () => {
    const evalSpy = jest
      .spyOn(redis, 'eval')
      .mockImplementation(() => new Promise<unknown>(() => undefined));
    const result = await service.tryAcquire(12, {
      ttlMs: 300,
      renewalIntervalMs: 100,
    });
    if (!result.acquired) throw new Error('Expected lock acquisition');

    await jest.advanceTimersByTimeAsync(100);
    let elapsedMs = 100;
    while (!result.lock.lost.aborted && elapsedMs < 300) {
      await jest.advanceTimersByTimeAsync(1);
      elapsedMs += 1;
    }

    expect(result.lock.lost.aborted).toBe(true);
    expect(elapsedMs).toBeLessThan(300);
    expect(evalSpy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('signals the abort signal when automatic renewal loses ownership', async () => {
    const result = await service.tryAcquire(12, {
      ttlMs: 300,
      renewalIntervalMs: 100,
    });
    if (!result.acquired) throw new Error('Expected lock acquisition');
    redis.evalResult = 0;

    await jest.advanceTimersByTimeAsync(100);

    expect(result.lock.lost.aborted).toBe(true);
    await result.lock.release();
  });

  it('stops automatic renewal without leaving a timer pending', async () => {
    const evalSpy = jest.spyOn(redis, 'eval');
    const result = await service.tryAcquire(12, { ttlMs: 300 });
    if (!result.acquired) throw new Error('Expected lock acquisition');

    await result.lock.stopRenewal();
    expect(jest.getTimerCount()).toBe(0);
    expect(evalSpy).not.toHaveBeenCalled();
    await result.lock.release();
  });

  it('lets a stopped lease expire naturally without deleting its Redis key', async () => {
    const first = await service.tryAcquire(12, {
      ttlMs: 300,
      renewalIntervalMs: 100,
    });
    if (!first.acquired) throw new Error('Expected first lock acquisition');

    await first.lock.stopRenewal();
    expect(jest.getTimerCount()).toBe(0);
    await expect(service.tryAcquire(12, { ttlMs: 300 })).resolves.toEqual({
      acquired: false,
      reason: 'LOCKED',
    });

    await jest.advanceTimersByTimeAsync(301);
    const second = await service.tryAcquire(12, { ttlMs: 300 });
    expect(second.acquired).toBe(true);
    if (second.acquired) await second.lock.release();
  });

  it('stops all automatic renewal timers when the service shuts down', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 300 });
    if (!result.acquired) throw new Error('Expected lock acquisition');

    await service.onModuleDestroy();

    expect(jest.getTimerCount()).toBe(0);
    await result.lock.release();
  });

  it('never deletes a lock now owned by another token', async () => {
    const result = await service.tryAcquire(12, { ttlMs: 300 });
    if (!result.acquired) throw new Error('Expected lock acquisition');
    const key = 'barbearia:lgpd-export-lock:v1:user:12';
    redis.values.get(key)!.token = 'new-owner';

    expect(await result.lock.release()).toBe(false);
    expect(redis.values.get(key)?.token).toBe('new-owner');
  });

  it('rejects invalid TTLs and external identifiers', async () => {
    await expect(service.tryAcquire(0, { ttlMs: 300 })).rejects.toThrow(
      'identificador interno',
    );
    await expect(service.tryAcquire(12, { ttlMs: 0 })).rejects.toThrow(
      'TTL ou intervalo',
    );
    await expect(
      service.tryAcquire(12, { ttlMs: 300, renewalIntervalMs: 300 }),
    ).rejects.toThrow('TTL ou intervalo');
  });
});
