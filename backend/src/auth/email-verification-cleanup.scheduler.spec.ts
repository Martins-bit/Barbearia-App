import { Logger } from '@nestjs/common';
import { EmailVerificationCleanupScheduler } from './email-verification-cleanup.scheduler';
import {
  EmailVerificationCleanupError,
  EmailVerificationCleanupService,
} from './email-verification-cleanup.service';

describe('EmailVerificationCleanupScheduler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates cleanup and logs only aggregate results', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const cleanupService = {
      cleanupTerminalTokens: jest
        .fn()
        .mockResolvedValue({ deletedCount: 623, batchCount: 2 }),
    };
    const scheduler = new EmailVerificationCleanupScheduler(
      cleanupService as unknown as EmailVerificationCleanupService,
    );

    await scheduler.handleDailyCleanup();

    expect(cleanupService.cleanupTerminalTokens).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toContain('started');
    expect(log.mock.calls[1][0]).toContain('deletedCount=623');
    expect(log.mock.calls[1][0]).toContain('batchCount=2');
  });

  it('handles failures without logging sensitive error details', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const sensitiveDetails =
      'raw-token hash-value customer@example.com user-id-123';
    const cleanupService = {
      cleanupTerminalTokens: jest
        .fn()
        .mockRejectedValue(new Error(sensitiveDetails)),
    };
    const scheduler = new EmailVerificationCleanupScheduler(
      cleanupService as unknown as EmailVerificationCleanupService,
    );

    await expect(scheduler.handleDailyCleanup()).resolves.toBeUndefined();

    const messages = [...log.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(error).toHaveBeenCalledTimes(1);
    expect(messages).toContain('failed');
    expect(messages).toContain('deletedCount=0');
    expect(messages).toContain('batchCount=0');
    expect(messages).not.toContain(sensitiveDetails);
    expect(messages).not.toContain('raw-token');
    expect(messages).not.toContain('hash-value');
    expect(messages).not.toContain('customer@example.com');
    expect(messages).not.toContain('user-id-123');
  });

  it('logs only aggregate progress when a later batch fails', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const cleanupService = {
      cleanupTerminalTokens: jest
        .fn()
        .mockRejectedValue(new EmailVerificationCleanupError(500, 1)),
    };
    const scheduler = new EmailVerificationCleanupScheduler(
      cleanupService as unknown as EmailVerificationCleanupService,
    );

    await scheduler.handleDailyCleanup();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('deletedCount=500');
    expect(error.mock.calls[0][0]).toContain('batchCount=1');
  });
});
