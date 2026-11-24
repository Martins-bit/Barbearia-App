import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_VERIFICATION_TOKEN_CLEANUP_BATCH_SIZE,
  EmailVerificationCleanupService,
} from './email-verification-cleanup.service';

describe('EmailVerificationCleanupService', () => {
  let transaction: { $queryRaw: jest.Mock };
  let prisma: { $transaction: jest.Mock };
  let service: EmailVerificationCleanupService;
  let rolledBackBatches: number;

  beforeEach(() => {
    transaction = { $queryRaw: jest.fn() };
    rolledBackBatches = 0;
    prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) => {
          try {
            return await callback(transaction);
          } catch (error) {
            rolledBackBatches += 1;
            throw error;
          }
        },
      ),
    };
    service = new EmailVerificationCleanupService(
      prisma as unknown as PrismaService,
    );
  });

  async function runEmptyBatchAndReadSql(): Promise<{
    sql: string;
    values: unknown[];
  }> {
    transaction.$queryRaw.mockResolvedValueOnce([{ deletedCount: 0 }]);
    await service.cleanupTerminalTokens();

    const [template, ...values] = transaction.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return { sql: template.raw.join(' '), values };
  }

  it('uses a strict PostgreSQL 24-hour expiration cutoff', async () => {
    const { sql } = await runEmptyBatchAndReadSql();

    expect(sql).toContain("clock_timestamp() - INTERVAL '24 hours'");
    expect(sql).toContain('token."expiraEm" < cutoff."cutoffAt"');
  });

  it('allows old expired tokens with no use timestamp and retains recent use timestamps', async () => {
    const { sql } = await runEmptyBatchAndReadSql();

    expect(sql).toContain('token."usadoEm" IS NULL');
    expect(sql).toContain('token."usadoEm" < cutoff."cutoffAt"');
  });

  it('orders and locks candidates with SKIP LOCKED before deleting in the same statement', async () => {
    const { sql, values } = await runEmptyBatchAndReadSql();

    expect(sql).toContain('ORDER BY token."expiraEm" ASC, token."id" ASC');
    expect(sql).toContain('FOR UPDATE OF token SKIP LOCKED');
    expect(sql).toContain('DELETE FROM "EmailVerificationToken"');
    expect(sql).toContain('RETURNING 1');
    expect(values).toEqual([EMAIL_VERIFICATION_TOKEN_CLEANUP_BATCH_SIZE]);
  });

  it('processes successive batches until there are no eligible records', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ deletedCount: 500 }])
      .mockResolvedValueOnce([{ deletedCount: 123 }])
      .mockResolvedValueOnce([{ deletedCount: 0 }]);

    const result = await service.cleanupTerminalTokens();

    expect(result).toEqual({ deletedCount: 623, batchCount: 2 });
    expect(Object.keys(result).sort()).toEqual(['batchCount', 'deletedCount']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('returns zero counts when no records are eligible', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ deletedCount: 0 }]);

    await expect(service.cleanupTerminalTokens()).resolves.toEqual({
      deletedCount: 0,
      batchCount: 0,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid batch counts without exposing query details', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ deletedCount: 501 }]);
    await expect(service.cleanupTerminalTokens()).rejects.toMatchObject({
      name: 'EmailVerificationCleanupError',
      message: 'Email verification token cleanup failed.',
      deletedCount: 0,
      batchCount: 0,
    });
    expect(rolledBackBatches).toBe(1);
  });

  it('reports only completed aggregate progress when a later batch fails', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ deletedCount: 10 }])
      .mockRejectedValueOnce(new Error('sensitive database details'));

    await expect(service.cleanupTerminalTokens()).rejects.toMatchObject({
      name: 'EmailVerificationCleanupError',
      message: 'Email verification token cleanup failed.',
      deletedCount: 10,
      batchCount: 1,
    });
    expect(rolledBackBatches).toBe(1);
  });
});
