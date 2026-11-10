import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { JWT_CONFIG } from '../common/config/jwt.config';
import { hashPassword, isPasswordWithinBcryptLimit } from '../common/utils/password.util';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { normalizeEmail } from '../common/utils/email.util';
import { EMAIL_VERIFICATION_MAILER } from './email-verification-mailer';
import type { EmailVerificationMailer } from './email-verification-mailer';

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const IDENTIFIER_WINDOW_MS = 60 * 60 * 1000;
const IDENTIFIER_MAX_ATTEMPTS = 3;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const GENERIC_RECOVERY_RESPONSE = {
  message: 'Se houver uma conta elegível, as instruções serão enviadas.',
};
const INVALID_RESET_MESSAGE = 'Token de redefinição inválido ou expirado.';

function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function hashIdentifier(email: string): string {
  return createHmac('sha256', JWT_CONFIG.secret)
    .update(normalizeEmail(email), 'utf8')
    .digest('hex');
}

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    @Inject(EMAIL_VERIFICATION_MAILER)
    private readonly mailer: EmailVerificationMailer,
  ) {}

  async requestRecovery(email: string): Promise<{ message: string }> {
    const normalizedEmail = normalizeEmail(email);
    const identifierHash = hashIdentifier(normalizedEmail);
    const allowed = await this.consumeIdentifierAttempt(identifierHash);

    if (!allowed) {
      return GENERIC_RECOVERY_RESPONSE;
    }
    if (!this.mailer.isAvailable()) {
      throw new ServiceUnavailableException(
        'Não foi possível processar a solicitação neste momento.',
      );
    }

    const user = await this.usersService.findForPasswordRecovery(
      normalizedEmail,
    );
    if (!user?.email) {
      return GENERIC_RECOVERY_RESPONSE;
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashResetToken(token);
    const now = new Date();
    const tokenId = await this.createTokenIfStillEligible(
      user.id,
      normalizedEmail,
      tokenHash,
      now,
    );
    if (tokenId === null) {
      return GENERIC_RECOVERY_RESPONSE;
    }

    try {
      await this.mailer.sendPasswordResetEmail(user.email, token);
    } catch {
      await this.prisma.passwordResetToken.updateMany({
        where: { id: tokenId, usadoEm: null },
        data: { usadoEm: new Date() },
      });
      this.logger.warn(
        'Password recovery email delivery failed; reset token invalidated.',
      );
    }

    return GENERIC_RECOVERY_RESPONSE;
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    if (newPassword.length < 8 || !isPasswordWithinBcryptLimit(newPassword)) {
      throw new BadRequestException(
        'A senha deve ter no mínimo 8 caracteres e no máximo 72 bytes UTF-8.',
      );
    }

    const tokenHash = hashResetToken(token);
    const tokenLookup = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, usuarioId: true },
    });
    if (!tokenLookup) {
      throw new BadRequestException(INVALID_RESET_MESSAGE);
    }

    const passwordHash = await hashPassword(newPassword);
    const now = new Date();

    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "Usuario" WHERE "id" = ${tokenLookup.usuarioId} FOR UPDATE
      `;

      const [resetToken, user] = await Promise.all([
        transaction.passwordResetToken.findUnique({
          where: { id: tokenLookup.id },
        }),
        transaction.usuario.findUnique({
          where: { id: tokenLookup.usuarioId },
          select: {
            id: true,
            email: true,
            emailVerificadoEm: true,
            ativo: true,
            authVersion: true,
          },
        }),
      ]);

      if (
        !resetToken ||
        resetToken.usadoEm ||
        resetToken.expiraEm <= now ||
        !user ||
        !user.ativo ||
        !user.emailVerificadoEm ||
        user.email !== resetToken.email
      ) {
        throw new BadRequestException(INVALID_RESET_MESSAGE);
      }

      const consumed = await transaction.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          tokenHash,
          usadoEm: null,
          expiraEm: { gt: now },
        },
        data: { usadoEm: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(INVALID_RESET_MESSAGE);
      }

      const updated = await transaction.usuario.updateMany({
        where: {
          id: user.id,
          email: resetToken.email,
          emailVerificadoEm: { not: null },
          ativo: true,
          authVersion: user.authVersion,
        },
        data: {
          senhaHash: passwordHash,
          authVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new BadRequestException(INVALID_RESET_MESSAGE);
      }

      await transaction.passwordResetToken.updateMany({
        where: { usuarioId: user.id, usadoEm: null },
        data: { usadoEm: now },
      });
    });

    return { message: 'Senha redefinida. Entre novamente com a nova senha.' };
  }

  private async consumeIdentifierAttempt(identifierHash: string): Promise<boolean> {
    const now = new Date();
    const windowCutoff = new Date(now.getTime() - IDENTIFIER_WINDOW_MS);
    const retentionCutoff = new Date(now.getTime() - RATE_LIMIT_RETENTION_MS);

    return this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetRateLimit.deleteMany({
        where: { windowStartedAt: { lt: retentionCutoff } },
      });

      const rows = await transaction.$queryRaw<
        { attemptCount: number }[]
      >`INSERT INTO "PasswordResetRateLimit"
        ("identifierHash", "windowStartedAt", "attemptCount", "updatedAt")
        VALUES (${identifierHash}, ${now}, 1, ${now})
        ON CONFLICT ("identifierHash") DO UPDATE SET
          "attemptCount" = CASE
            WHEN "PasswordResetRateLimit"."windowStartedAt" <= ${windowCutoff}
              THEN 1
            ELSE "PasswordResetRateLimit"."attemptCount" + 1
          END,
          "windowStartedAt" = CASE
            WHEN "PasswordResetRateLimit"."windowStartedAt" <= ${windowCutoff}
              THEN ${now}
            ELSE "PasswordResetRateLimit"."windowStartedAt"
          END,
          "updatedAt" = ${now}
        RETURNING "attemptCount"`;

      return (rows[0]?.attemptCount ?? IDENTIFIER_MAX_ATTEMPTS + 1) <=
        IDENTIFIER_MAX_ATTEMPTS;
    });
  }

  private async createTokenIfStillEligible(
    userId: number,
    normalizedEmail: string,
    tokenHash: string,
    now: Date,
  ): Promise<number | null> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "Usuario" WHERE "id" = ${userId} FOR UPDATE
      `;

      const user = await transaction.usuario.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          emailVerificadoEm: true,
          ativo: true,
        },
      });
      if (
        !user ||
        !user.ativo ||
        !user.emailVerificadoEm ||
        !user.email ||
        normalizeEmail(user.email) !== normalizedEmail
      ) {
        return null;
      }

      await transaction.passwordResetToken.updateMany({
        where: { usuarioId: userId, usadoEm: null },
        data: { usadoEm: now },
      });

      const record = await transaction.passwordResetToken.create({
        data: {
          usuarioId: userId,
          email: user.email,
          tokenHash,
          expiraEm: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
        },
        select: { id: true },
      });
      return record.id;
    });
  }
}