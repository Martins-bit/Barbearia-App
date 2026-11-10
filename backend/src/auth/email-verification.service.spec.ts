import {
  BadRequestException,
  HttpException,
  HttpStatus,
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

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: USER_ID }]),
      usuario: {
        findUnique: jest.fn().mockResolvedValue({
          id: USER_ID,
          email: USER_EMAIL,
          emailVerificadoEm: null,
          ativo: true,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      emailVerificationToken: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 31 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mailer = {
      isAvailable: jest.fn().mockReturnValue(true),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };
    service = new EmailVerificationService(
      prisma as PrismaService,
      mailer,
    );
  });

  it('creates a random token and persists only its SHA-256 hash', async () => {
    const response = await service.requestConfirmation(USER_ID);
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
    expect(response).not.toHaveProperty('email');
    expect(JSON.stringify(response)).not.toContain(sentToken);
  });

  it('confirms the bound e-mail and atomically consumes the token', async () => {
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
        data: { emailVerificadoEm: expect.any(Date) },
      }),
    );
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

  it('rejects already-used tokens with the same generic error', async () => {
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
      new BadRequestException('Token de confirmação inválido ou expirado.'),
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
    prisma.usuario.findUnique.mockResolvedValue({
      id: USER_ID,
      email: USER_EMAIL,
      emailVerificadoEm: null,
      ativo: true,
    });

    await expect(service.confirm(TOKEN)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
  });

  it('limits repeated confirmation requests for the same account', async () => {
    prisma.emailVerificationToken.count.mockResolvedValue(
      3,
    );

    await expect(service.requestConfirmation(USER_ID)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    } satisfies Partial<HttpException>);
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('does not create a token or report success while delivery is unconfigured', async () => {
    mailer.isAvailable.mockReturnValue(false);

    await expect(service.requestConfirmation(USER_ID)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('invalidates an unsent token and returns a sanitized error when delivery fails', async () => {
    mailer.sendVerificationEmail.mockRejectedValue(
      new Error('provider credentials must not escape'),
    );

    await expect(service.requestConfirmation(USER_ID)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(prisma.emailVerificationToken.updateMany).toHaveBeenLastCalledWith({
      where: { id: 31, usadoEm: null },
      data: { usadoEm: expect.any(Date) },
    });
    expect(mailer.sendVerificationEmail.mock.calls[0][1]).not.toBe(
      prisma.emailVerificationToken.create.mock.calls[0][0].data.tokenHash,
    );
  });

  it('does not disclose the address or token in successful responses', async () => {
    const response = await service.requestConfirmation(USER_ID);

    expect(response).toEqual({ message: 'E-mail de confirmação enviado.' });
    expect(JSON.stringify(response)).not.toContain(USER_EMAIL);
    expect(JSON.stringify(response)).not.toContain(
      mailer.sendVerificationEmail.mock.calls[0][1],
    );
  });
});