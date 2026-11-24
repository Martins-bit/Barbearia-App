import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { performance } from 'node:perf_hooks';
import {
  EmailVerificationCleanupError,
  EmailVerificationCleanupService,
} from './email-verification-cleanup.service';

@Injectable()
export class EmailVerificationCleanupScheduler {
  private readonly logger = new Logger(EmailVerificationCleanupScheduler.name);

  constructor(
    private readonly cleanupService: EmailVerificationCleanupService,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'UTC' })
  async handleDailyCleanup(): Promise<void> {
    const startedAt = performance.now();
    this.logger.log('Email verification token cleanup started.');

    try {
      const result = await this.cleanupService.cleanupTerminalTokens();
      const durationMs = Math.round(performance.now() - startedAt);
      this.logger.log(
        `Email verification token cleanup completed: deletedCount=${result.deletedCount}, batchCount=${result.batchCount}, durationMs=${durationMs}.`,
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const deletedCount =
        error instanceof EmailVerificationCleanupError ? error.deletedCount : 0;
      const batchCount =
        error instanceof EmailVerificationCleanupError ? error.batchCount : 0;
      this.logger.error(
        `Email verification token cleanup failed: deletedCount=${deletedCount}, batchCount=${batchCount}, durationMs=${durationMs}; eligible records will be retried on the next daily run.`,
      );
    }
  }
}
