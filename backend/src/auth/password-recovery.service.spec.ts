import {
  BadRequestException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

process.env.JWT_SECRET ??= 'unit-test-jwt-secret-with-at-least-32-characters';

const { PasswordRecoveryService } = require('./password-recovery.service');

const USER_ID = 17;
const EMAIL = 'cliente@example.com';
const TOKEN = 'A'.repeat(43);
const TOKEN_HASH = createHash('sha256').update(TOKEN, 'utf8').digest('hex');
const GENERIC_RESPONSE = {
  message: 'Se houver uma conta elegível, as instruções serão enviadas.',
};

function makeResetToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 44,
    usuarioId: USER_ID,
    email: EMAIL,
    tokenHash: TOKEN_HASH,
    criadoEm: new Date(Date.now() - 1000),
    expiraEm: new Date(Date.now() + 60_000),
    usadoEm: null,
    ...overrides,
  };
}

describe('PasswordRecoveryService', () => {
  let service: InstanceType<typeof PasswordRecoveryService>;
  let prisma: any;
  let usersService: any;
  let mailer: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join(' ');
        if (sql.includes('INSERT INTO "PasswordResetRateLimit"')) {
          return Promise.resolve([{ attemptCount: 1 }]);
        }
        return Promise.resolve([{ id: USER_ID }]);
      }),
      passwordResetRateLimit: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      passwordResetToken: {
        create: jest.fn().mockResolvedValue({ id: 44 }),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue({
          id: USER_ID,
          email: EMAIL,
          emailVerificadoEm: new Date(),
          ativo: true,
          authVersion: 0,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    usersService = {
      findForPasswordRecovery: jest.fn().mockResolvedValue({
        id: USER_ID,
        email: EMAIL,
        tipoUsuario: 'CLIENTE',
      }),
    };
    mailer = {
      isAvailable: jest.fn().mockReturnValue(true),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };
    service = new PasswordRecoveryService(prisma, usersService, mailer);
  });

  it.each(['CLIENTE', 'BARBEIRO'])('%s pode solicitar recuperação', async (tipoUsuario) => {
    usersService.findForPasswordRecovery.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      tipoUsuario,
    });

    await expect(service.requestRecovery(` ${EMAIL.toUpperCase()} `)).resolves.toEqual(
      GENERIC_RESPONSE,
    );

    expect(usersService.findForPasswordRecovery).toHaveBeenCalledWith(EMAIL);
    expect(mailer.sendPasswordResetEmail).toHaveBeenCalledWith(
      EMAIL,
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    );
  });

  it('stores only a SHA-256 token hash and returns no account details', async () => {
    await service.requestRecovery(EMAIL);
    const sentToken = mailer.sendPasswordResetEmail.mock.calls[0][1];
    const createCall = prisma.passwordResetToken.create.mock.calls[0][0];
    const storedHash = createHash('sha256')
      .update(sentToken, 'utf8')
      .digest('hex');

    expect(createCall.data.tokenHash).toBe(storedHash);
    expect(createCall.data).not.toHaveProperty('token');
    expect(createCall.data.expiraEm.getTime()).toBeGreaterThan(Date.now());
    expect(createCall.data.expiraEm.getTime()).toBeLessThanOrEqual(
      Date.now() + 15 * 60 * 1000,
    );
    expect(JSON.stringify(GENERIC_RESPONSE)).not.toContain(EMAIL);
    expect(JSON.stringify(GENERIC_RESPONSE)).not.toContain(sentToken);
  });

  it('returns the same response when no active verified account matches', async () => {
    usersService.findForPasswordRecovery.mockResolvedValue(null);

    await expect(service.requestRecovery('unknown@example.com')).resolves.toEqual(
      GENERIC_RESPONSE,
    );
    expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('does not look up an account or create a token while mail is unavailable', async () => {
    mailer.isAvailable.mockReturnValue(false);

    await expect(service.requestRecovery(EMAIL)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(usersService.findForPasswordRecovery).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('uses the normalized identifier for a shared hourly limit', async () => {
    let callCount = 0;
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = Array.from(strings).join(' ');
      if (sql.includes('INSERT INTO "PasswordResetRateLimit"')) {
        callCount += 1;
        return Promise.resolve([{ attemptCount: callCount }]);
      }
      return Promise.resolve([{ id: USER_ID }]);
    });
    usersService.findForPasswordRecovery.mockResolvedValue(null);

    await service.requestRecovery(EMAIL);
    await service.requestRecovery(` ${EMAIL.toUpperCase()} `);
    await service.requestRecovery(EMAIL);
    await service.requestRecovery(EMAIL);

    expect(usersService.findForPasswordRecovery).toHaveBeenCalledTimes(3);
    const rateCalls = prisma.$queryRaw.mock.calls.filter(([strings]) =>
      Array.from(strings).join(' ').includes('INSERT INTO "PasswordResetRateLimit"'),
    );
    expect(rateCalls).toHaveLength(4);
    expect(rateCalls[0][1]).toBe(rateCalls[1][1]);
    expect(rateCalls[0][1]).not.toBe(EMAIL);
    expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('returns a generic response and invalidates the token if provider delivery fails', async () => {
    mailer.sendPasswordResetEmail.mockRejectedValue(
      new Error('provider credential details'),
    );
    const warn = jest.spyOn(service.logger, 'warn');

    await expect(service.requestRecovery(EMAIL)).resolves.toEqual(
      GENERIC_RESPONSE,
    );
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: 44, usadoEm: null },
      data: { usadoEm: expect.any(Date) },
    });
    expect(warn).toHaveBeenCalledWith(
      'Password recovery email delivery failed; reset token invalidated.',
    );
    expect(warn.mock.calls.flat().join(' ')).not.toContain(EMAIL);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(TOKEN);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(
      'provider credential details',
    );
  });

  it('rejects unknown reset tokens generically', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);

    await expect(service.resetPassword(TOKEN, 'password123')).rejects.toThrow(
      new BadRequestException('Token de redefinição inválido ou expirado.'),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', makeResetToken({ expiraEm: new Date(Date.now() - 1) })],
    ['used', makeResetToken({ usadoEm: new Date() })],
    ['changed e-mail', makeResetToken({ email: 'old@example.com' })],
  ])('rejects a %s reset token', async (_label, record) => {
    prisma.passwordResetToken.findUnique
      .mockResolvedValueOnce({ id: 44, usuarioId: USER_ID })
      .mockResolvedValueOnce(record);

    await expect(service.resetPassword(TOKEN, 'password123')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['unverified', { emailVerificadoEm: null, ativo: true }],
    ['inactive', { emailVerificadoEm: new Date(), ativo: false }],
  ])('rejects an %s account during reset', async (_label, overrides) => {
    prisma.passwordResetToken.findUnique
      .mockResolvedValueOnce({ id: 44, usuarioId: USER_ID })
      .mockResolvedValueOnce(makeResetToken());
    prisma.usuario.findUnique.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      authVersion: 0,
      ...overrides,
    });

    await expect(service.resetPassword(TOKEN, 'password123')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
  });

  it('rejects passwords over bcrypt byte limit before hashing or consuming a token', async () => {
    const longUtf8Password = 'é'.repeat(37);

    await expect(
      service.resetPassword(TOKEN, longUtf8Password),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it('updates the password and increments authVersion atomically', async () => {
    prisma.passwordResetToken.findUnique
      .mockResolvedValueOnce({ id: 44, usuarioId: USER_ID })
      .mockResolvedValueOnce(makeResetToken());

    await expect(service.resetPassword(TOKEN, 'new-password-123')).resolves.toEqual({
      message: 'Senha redefinida. Entre novamente com a nova senha.',
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 44, usadoEm: null }),
        data: { usadoEm: expect.any(Date) },
      }),
    );
    expect(prisma.usuario.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: USER_ID,
          email: EMAIL,
          authVersion: 0,
        }),
        data: {
          senhaHash: expect.any(String),
          authVersion: { increment: 1 },
        },
      }),
    );
  });

  it('allows only one of two concurrent consumers to reset the same token', async () => {
    let transactionTail = Promise.resolve();
    let tokenUsed = false;
    prisma.$transaction.mockImplementation((callback: (tx: any) => unknown) => {
      const current = transactionTail.then(() => callback(prisma));
      transactionTail = current.then(() => undefined, () => undefined);
      return current;
    });
    prisma.passwordResetToken.findUnique.mockImplementation(async () =>
      tokenUsed
        ? { id: 44, usuarioId: USER_ID }
        : makeResetToken(),
    );
    prisma.passwordResetToken.updateMany.mockImplementation(async (args: any) => {
      if (args.where.id === 44 && args.where.usadoEm === null) {
        if (tokenUsed) return { count: 0 };
        tokenUsed = true;
        return { count: 1 };
      }
      return { count: 0 };
    });

    const results = await Promise.allSettled([
      service.resetPassword(TOKEN, 'new-password-123'),
      service.resetPassword(TOKEN, 'new-password-456'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(prisma.usuario.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects an account whose current authVersion changes during reset transaction', async () => {
    prisma.passwordResetToken.findUnique
      .mockResolvedValueOnce({ id: 44, usuarioId: USER_ID })
      .mockResolvedValueOnce(makeResetToken());
    prisma.usuario.findUnique.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      emailVerificadoEm: new Date(),
      ativo: true,
      authVersion: 0,
    });
    prisma.usuario.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.resetPassword(TOKEN, 'new-password-123')).rejects.toThrow(
      new BadRequestException('Token de redefinição inválido ou expirado.'),
    );
  });
});
