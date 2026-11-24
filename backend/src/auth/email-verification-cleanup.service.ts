import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const EMAIL_VERIFICATION_TOKEN_CLEANUP_BATCH_SIZE = 500;

export interface EmailVerificationTokenCleanupResult {
  deletedCount: number;
  batchCount: number;
}

export class EmailVerificationCleanupError extends Error {
  constructor(
    readonly deletedCount: number,
    readonly batchCount: number,
  ) {
    super('Email verification token cleanup failed.');
    this.name = EmailVerificationCleanupError.name;
  }
}

@Injectable()
export class EmailVerificationCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  async cleanupTerminalTokens(): Promise<EmailVerificationTokenCleanupResult> {
    let deletedCount = 0;
    let batchCount = 0;

    while (true) {
      let deletedInBatch: number;
      try {
        deletedInBatch = await this.deleteBatch();
      } catch {
        throw new EmailVerificationCleanupError(deletedCount, batchCount);
      }

      if (deletedInBatch === 0) {
        return { deletedCount, batchCount };
      }

      deletedCount += deletedInBatch;
      batchCount += 1;
    }
  }

  private deleteBatch(): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        { deletedCount: number }[]
      >`WITH cutoff AS (
          SELECT clock_timestamp() - INTERVAL '24 hours' AS "cutoffAt"
        ),
        candidates AS (
          SELECT token."id"
          FROM "EmailVerificationToken" AS token
          CROSS JOIN cutoff
          WHERE token."expiraEm" < cutoff."cutoffAt"
            AND (
              token."usadoEm" IS NULL
              OR token."usadoEm" < cutoff."cutoffAt"
            )
          ORDER BY token."expiraEm" ASC, token."id" ASC
          FOR UPDATE OF token SKIP LOCKED
          LIMIT ${EMAIL_VERIFICATION_TOKEN_CLEANUP_BATCH_SIZE}
        ),
        deleted AS (
          DELETE FROM "EmailVerificationToken" AS token
          USING candidates
          WHERE token."id" = candidates."id"
          RETURNING 1
        )
        SELECT COUNT(*)::integer AS "deletedCount"
        FROM deleted`;

      const deletedCount = rows[0]?.deletedCount;
      if (
        !Number.isInteger(deletedCount) ||
        deletedCount < 0 ||
        deletedCount > EMAIL_VERIFICATION_TOKEN_CLEANUP_BATCH_SIZE
      ) {
        throw new Error(
          'Email verification token cleanup returned an invalid batch count.',
        );
      }

      return deletedCount;
    });
  }
}
