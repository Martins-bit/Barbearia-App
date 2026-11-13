import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailVerificationService } from './email-verification.service';
import { EmailVerificationMailer } from './email-verification-mailer';

const USER_ID = 17;
const USER_EMAIL = 'cliente@example.com';
const TOKEN = 'A'.repeat(43);

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let prisma: any;
  let mailer: jest.Mocked<EmailVerificationMailer>;
  let rateLimitRecord: {
    windowStartedAt: Date;
    attemptCount: number;
    lastRequestedAt: Date | null;
  };

  beforeEach(() => {
    process.env.JWT_SECRET ??=
      'unit-test-jwt-secret-with-at-least-32-characters';
    rateLimitRecord = {
      windowStartedAt: new Date(Date.now() - 2 * 60 * 1000),
      attemptCount: 0,
      lastRequestedAt: null,
    };
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn((query) => {
        const sql = Array.isArray(query) ? query.join('') : '';
        return sql.includes('EmailVerificationRateLimit')
          ? [rateLimitRecord]
          : [{ id: USER_ID }];
      }),
      $executeRaw: jest.fn().mockResolvedValue(1),
      usuario: {
        findUnique: jest.fn().mockResolvedValue({
          id: USER_ID,
          email: USER_EMAIL,
          emailVerificadoEm: null,
          ativo: true,
        }),
        findFirst: jest.fn().mockResolvedValue({ id: USER_ID }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      emailVerificationToken: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 31 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      emailVerificationRateLimit: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockImplementation(({ data }) => {
          Object.assign(rateLimitRecord, {
            windowStartedAt: data.windowStartedAt,
            attemptCount: data.attemptCount,
            lastRequestedAt: data.lastRequestedAt,
          });
          return Promise.resolve({});
        }),
      },
    };
    mailer = {
      isAvailable: jest.fn().mockReturnValue(true),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };
    service = new EmailVerificationService(prisma as PrismaService, mailer);
  });

  it('sends exactly one automatic registration email and persists only its token hash', async () => {
    await expect(
      service.sendRegistrationConfirmation(USER_ID),
    ).resolves.toBe(true);

    expect(mailer.sendVerificationEmail).toHaveBeenCalledTimes(1);
    const createCall = prisma.emailVerificationToken.create.mock.calls[0][0];
    const sentToken = mailer.sendVerificationEmail.mock.calls[0][1];
    expect(sentToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createCall.data.tokenHash).toBe(tokenHash(sentToken));
    expect(createCall.data).not.toHaveProperty('token');
    expect(createCall.data.email).toBe(USER_EMAIL);
    expect(createCall.data.expiraEm.getTime()).toBeGreaterThan(Date.now());
    expect(createCall.data.expiraEm.getTime()).toBeLessThanOrEqual(
      Date.now() + 30 * 60 * 1000,
    );
  });

  it('confirms the bound e-mail, consumes the token, and clears the required marker', async () => {
    const now = new Date();
    const record = {
      id: 31,
      usuarioId: USER_ID,
      email: USER_EMAIL,
      tokenHash: tokenHash(TOKEN),
      criadoEm: new Date(now.getTime() - 1000),
      expiraEm: new Date(now.getTime() + 60_000),
      usadoEm: null,
    };
    prisma.emailVerificationToken.findUnique
      .mockResolvedValueOnce({ id: record.id, usuarioId: USER_ID })
      .mockResolvedValueOnce(record);
    prisma.usuario.findUnique.mockResolvedValueOnce({
      id: USER_ID,
      email: USER_EMAIL,
      emailVerificadoEm: null,
      ativo: true,
      authVersion: 1,
    });

    await expect(service.confirm(TOKEN)).resolves.toEqual({
      message: 'Endereço de e-mail confirmado.',
    });

    expect(prisma.emailVerificationToken.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: record.id,
          tokenHash: tokenHash(TOKEN),
          usadoEm: null,
        }),
      }),
    );
    expect(prisma.usuario.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: USER_ID,
          email: USER_EMAIL,
          emailVerificadoEm: null,
          ativo: true,
        }),
        data: {
          emailVerificadoEm: expect.any(Date),
          emailConfirmacaoObrigatoria: false,
        },
      }),
    );
    expect(
      prisma.usuario.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('authVersion');
  });

  it('rejects expired tokens without marking the address verified', async () => {
    const expiredRecord = {
      id: 31,
      usuarioId: USER_ID,
      email: USER_EMAIL,
      tokenHash: tokenHash(TOKEN),
      expiraEm: new Date(Date.now() - 1),
      usadoEm: null,
    };
    prisma.emailVerificationToken.findUnique
      .mockResolvedValueOnce({ id: expiredRecord.id, usuarioId: USER_ID })
      .mockResolvedValueOnce(expiredRecord);

    await expect(service.confirm(TOKEN)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
  });

  it('rejects invalid and already-used tokens with a generic error', async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce(null);
    await expect(service.confirm(TOKEN)).rejects.toThrow(
      new BadRequestException('Token de confirmação inválido ou expirado.'),
    );

    const usedRecord = {
      id: 31,
      usuarioId: USER_ID,
      email: USER_EMAIL,
      tokenHash: tokenHash(TOKEN),
      expiraEm: new Date(Date.now() + 60_000),
      usadoEm: new Date(),
    };
    prisma.emailVerificationToken.findUnique
      .mockResolvedValueOnce({ id: usedRecord.id, usuarioId: USER_ID })
      .mockResolvedValueOnce(usedRecord);
    await expect(service.confirm(TOKEN)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a token issued for an e-mail that has since changed', async () => {
    const record = {
      id: 31,
      usuarioId: USER_ID,
      email: 'old@example.com',
      tokenHash: tokenHash(TOKEN),
      expiraEm: new Date(Date.now() + 60_000),
      usadoEm: null,
    };
    prisma.emailVerificationToken.findUnique
      .mockResolvedValueOnce({ id: record.id, usuarioId: USER_ID })
      .mockResolvedValueOnce(record);

    await expect(service.confirm(TOKEN)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
  });

  it('enforces the 60-second minimum and the three-request hourly user limit', async () => {
    rateLimitRecord.lastRequestedAt = new Date(Date.now() - 30_000);
    rateLimitRecord.attemptCount = 1;
    await expect(service.requestConfirmation(USER_ID)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    } satisfies Partial<HttpException>);
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();

    rateLimitRecord.lastRequestedAt = new Date(Date.now() - 61_000);
    prisma.emailVerificationToken.count.mockResolvedValue(3);
    await expect(service.requestConfirmation(USER_ID)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    } satisfies Partial<HttpException>);
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
  });

  it('returns the same public response for unknown and pending addresses', async () => {
    const pendingResponse = await service.requestConfirmationByEmail(
      USER_EMAIL,
    );

    prisma.usuario.findFirst.mockResolvedValue(null);
    const unknownResponse = await service.requestConfirmationByEmail(
      'missing@example.com',
    );

    expect(pendingResponse).toEqual(unknownResponse);
    expect(JSON.stringify(unknownResponse)).not.toContain('missing@example.com');
  });

  it('reserves the normalized email limit for unknown addresses without creating a token', async () => {
    prisma.usuario.findFirst.mockResolvedValue(null);

    await service.requestConfirmationByEmail(' Missing@Example.com ');

    expect(prisma.usuario.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: { equals: 'missing@example.com', mode: 'insensitive' },
        },
      }),
    );
    expect(prisma.emailVerificationRateLimit.update).toHaveBeenCalledTimes(1);
    expect(prisma.emailVerificationRateLimit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emailHash: expect.any(String) },
        data: expect.objectContaining({
          attemptCount: 1,
          lastRequestedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('limits public requests for unknown addresses by cooldown and hourly quota', async () => {
    jest.useFakeTimers();
    const start = new Date('2026-11-12T12:00:00.000Z');
    jest.setSystemTime(start);
    rateLimitRecord.windowStartedAt = start;
    prisma.usuario.findFirst.mockResolvedValue(null);

    try {
      const responses = [];
      responses.push(
        await service.requestConfirmationByEmail('unknown@example.com'),
      );
      expect(rateLimitRecord.attemptCount).toBe(1);
      expect(rateLimitRecord.lastRequestedAt).toEqual(start);

      jest.advanceTimersByTime(59_999);
      responses.push(
        await service.requestConfirmationByEmail('unknown@example.com'),
      );
      expect(rateLimitRecord.attemptCount).toBe(1);

      jest.advanceTimersByTime(1);
      responses.push(
        await service.requestConfirmationByEmail('unknown@example.com'),
      );
      expect(rateLimitRecord.attemptCount).toBe(2);
      expect(rateLimitRecord.lastRequestedAt).toEqual(
        new Date(start.getTime() + 60_000),
      );

      jest.advanceTimersByTime(60_000);
      responses.push(
        await service.requestConfirmationByEmail('unknown@example.com'),
      );
      expect(rateLimitRecord.attemptCount).toBe(3);

      jest.advanceTimersByTime(60_000);
      responses.push(
        await service.requestConfirmationByEmail('unknown@example.com'),
      );

      expect(rateLimitRecord.attemptCount).toBe(3);
      expect(prisma.emailVerificationRateLimit.update).toHaveBeenCalledTimes(3);
      expect(responses).toHaveLength(5);
      expect(
        responses.every(
          (response) => response.message === responses[0].message,
        ),
      ).toBe(true);
      expect(responses[0].message).toContain('Solicitação recebida');
      expect(JSON.stringify(responses)).not.toContain('unknown@example.com');
      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
      expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not send a public resend before the email cooldown expires', async () => {
    rateLimitRecord.lastRequestedAt = new Date(Date.now() - 30_000);
    rateLimitRecord.attemptCount = 1;

    await service.requestConfirmationByEmail(USER_EMAIL);

    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
  });

  it('applies the hourly email limit to public resend without revealing it', async () => {
    rateLimitRecord.attemptCount = 3;
    rateLimitRecord.lastRequestedAt = new Date(Date.now() - 61_000);

    await expect(
      service.requestConfirmationByEmail(USER_EMAIL),
    ).resolves.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Solicitação recebida'),
      }),
    );
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
  });

  it('does not reveal account existence when sending is unavailable', async () => {
    mailer.isAvailable.mockReturnValue(false);

    await expect(
      service.requestConfirmationByEmail(USER_EMAIL),
    ).resolves.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Solicitação recebida'),
      }),
    );
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
    await expect(
      service.sendRegistrationConfirmation(USER_ID),
    ).resolves.toBe(false);
  });

  it('invalidates a token after Brevo failure and reports registration delivery as incomplete', async () => {
    mailer.sendVerificationEmail.mockRejectedValue(
      new Error('provider credentials must not escape'),
    );
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation();

    await expect(
      service.sendRegistrationConfirmation(USER_ID),
    ).resolves.toBe(false);
    expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: { id: 31, usadoEm: null },
      data: { usadoEm: expect.any(Date) },
    });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      'Email verification delivery failed; token invalidated.',
    );
    warning.mockRestore();
  });

  it('returns incomplete and logs generically when confirmation preparation fails unexpectedly', async () => {
    prisma.$transaction.mockRejectedValue(
      new Error('sensitive database failure details'),
    );
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation();

    await expect(
      service.sendRegistrationConfirmation(USER_ID),
    ).resolves.toBe(false);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      'Registration email confirmation could not be completed.',
    );
    expect(warning.mock.calls.flat().join(' ')).not.toContain(
      'sensitive database failure details',
    );
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
    warning.mockRestore();
  });
});
