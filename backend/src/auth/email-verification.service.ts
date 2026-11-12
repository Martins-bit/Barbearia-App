import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { normalizeEmail } from '../common/utils/email.util';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_VERIFICATION_MAILER } from './email-verification-mailer';
import type { EmailVerificationMailer } from './email-verification-mailer';

const TOKEN_TTL_MS = 30 * 60 * 1000;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MIN_REQUEST_INTERVAL_MS = 60 * 1000;
const TOKEN_RETENTION_MS = 24 * 60 * 60 * 1000;
const INVALID_TOKEN_MESSAGE = 'Token de confirmação inválido ou expirado.';
const GENERIC_REQUEST_RESPONSE = {
  message:
    'Solicitação recebida. Se o endereço pertencer a uma conta pendente e o envio estiver disponível, você receberá as instruções.',
};

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function hashEmail(email: string): string {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error(
      'JWT_SECRET must be defined and contain at least 32 characters.',
    );
  }
  return createHmac('sha256', secret)
    .update(normalizeEmail(email), 'utf8')
    .digest('hex');
}

interface PreparedConfirmation {
  tokenRecordId: number;
  email: string;
  token: string;
}

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_VERIFICATION_MAILER)
    private readonly mailer: EmailVerificationMailer,
  ) {}

  async requestConfirmation(userId: number): Promise<{ message: string }> {
    const prepared = await this.prepareForUser(userId);
    if (prepared && 'alreadyVerified' in prepared) {
      return { message: 'Este endereço de e-mail já está confirmado.' };
    }

    if (!prepared) {
      throw new ServiceUnavailableException(
        'O envio de e-mail ainda não está configurado.',
      );
    }

    if (!(await this.deliver(prepared))) {
      throw new ServiceUnavailableException(
        'Não foi possível enviar a confirmação de e-mail neste momento.',
      );
    }

    return { message: 'E-mail de confirmação enviado.' };
  }

  async sendRegistrationConfirmation(userId: number): Promise<boolean> {
    try {
      await this.requestConfirmation(userId);
      return true;
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        (error instanceof HttpException &&
          error.getStatus() === HttpStatus.TOO_MANY_REQUESTS)
      ) {
        return false;
      }
      this.logger.warn(
        'Registration email confirmation could not be completed.',
      );
      return false;
    }
  }

  async requestConfirmationByEmail(
    email: string,
  ): Promise<{ message: string }> {
    const prepared = await this.prepareForEmail(email);
    if (prepared) await this.deliver(prepared);
    return GENERIC_REQUEST_RESPONSE;
  }

  async confirm(token: string): Promise<{ message: string }> {
    const tokenHash = hashToken(token);
    const tokenLookup = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: { id: true, usuarioId: true },
    });
    if (!tokenLookup) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "Usuario" WHERE "id" = ${tokenLookup.usuarioId} FOR UPDATE
      `;

      const tokenRecord = await transaction.emailVerificationToken.findUnique({
        where: { id: tokenLookup.id },
      });
      const user = await transaction.usuario.findUnique({
        where: { id: tokenLookup.usuarioId },
        select: {
          id: true,
          email: true,
          emailVerificadoEm: true,
          ativo: true,
        },
      });

      if (
        !tokenRecord ||
        tokenRecord.usadoEm ||
        tokenRecord.expiraEm <= now ||
        !user ||
        !user.ativo ||
        user.email !== tokenRecord.email ||
        user.emailVerificadoEm
      ) {
        throw new BadRequestException(INVALID_TOKEN_MESSAGE);
      }

      const consumed = await transaction.emailVerificationToken.updateMany({
        where: {
          id: tokenRecord.id,
          tokenHash,
          usadoEm: null,
          expiraEm: { gt: now },
        },
        data: { usadoEm: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(INVALID_TOKEN_MESSAGE);
      }

      const verified = await transaction.usuario.updateMany({
        where: {
          id: user.id,
          email: tokenRecord.email,
          emailVerificadoEm: null,
          ativo: true,
        },
        data: {
          emailVerificadoEm: now,
          emailConfirmacaoObrigatoria: false,
        },
      });
      if (verified.count !== 1) {
        throw new BadRequestException(INVALID_TOKEN_MESSAGE);
      }

      await transaction.emailVerificationToken.updateMany({
        where: {
          usuarioId: user.id,
          id: { not: tokenRecord.id },
          usadoEm: null,
        },
        data: { usadoEm: now },
      });
    });

    return { message: 'Endereço de e-mail confirmado.' };
  }

  private async prepareForUser(
    userId: number,
  ): Promise<PreparedConfirmation | { alreadyVerified: true } | null> {
    const now = new Date();
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
      if (!user || !user.ativo) {
        throw new UnauthorizedException('Usuário não encontrado.');
      }
      if (!user.email) {
        throw new BadRequestException(
          'Cadastre um endereço de e-mail antes de solicitar a confirmação.',
        );
      }
      if (user.emailVerificadoEm) {
        return { alreadyVerified: true as const };
      }
      if (!this.mailer.isAvailable()) {
        return null;
      }

      if (!(await this.reserveEmailRequest(transaction, user.email, now))) {
        throw new HttpException(
          'Aguarde 60 segundos antes de solicitar outro e-mail.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.enforceUserRequestLimit(transaction, user.id, now, true);
      return this.createToken(transaction, user.id, user.email, now);
    });
  }

  private async prepareForEmail(
    email: string,
  ): Promise<PreparedConfirmation | null> {
    if (!this.mailer.isAvailable()) {
      return null;
    }

    const normalizedEmail = normalizeEmail(email);
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.usuario.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (!user) {
        await this.reserveEmailRequest(transaction, normalizedEmail, now);
        return null;
      }

      await transaction.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "Usuario" WHERE "id" = ${user.id} FOR UPDATE
      `;
      const currentUser = await transaction.usuario.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          emailVerificadoEm: true,
          ativo: true,
        },
      });
      if (
        !currentUser ||
        !currentUser.ativo ||
        !currentUser.email ||
        currentUser.emailVerificadoEm ||
        normalizeEmail(currentUser.email) !== normalizedEmail
      ) {
        await this.reserveEmailRequest(transaction, normalizedEmail, now);
        return null;
      }

      if (
        !(await this.reserveEmailRequest(transaction, currentUser.email, now))
      ) {
        return null;
      }
      const withinUserLimit = await this.enforceUserRequestLimit(
        transaction,
        currentUser.id,
        now,
        false,
      );
      if (!withinUserLimit) {
        return null;
      }

      return this.createToken(
        transaction,
        currentUser.id,
        currentUser.email,
        now,
      );
    });
  }

  private async reserveEmailRequest(
    transaction: Prisma.TransactionClient,
    email: string,
    now: Date,
  ): Promise<boolean> {
    const emailHash = hashEmail(email);
    const retentionCutoff = new Date(now.getTime() - TOKEN_RETENTION_MS);
    await transaction.emailVerificationRateLimit.deleteMany({
      where: { windowStartedAt: { lt: retentionCutoff } },
    });
    await transaction.$executeRaw`
      INSERT INTO "EmailVerificationRateLimit"
        ("emailHash", "windowStartedAt", "attemptCount", "lastRequestedAt", "updatedAt")
      VALUES (${emailHash}, ${now}, 0, NULL, ${now})
      ON CONFLICT ("emailHash") DO NOTHING
    `;
    const rows = await transaction.$queryRaw<
      {
        windowStartedAt: Date;
        attemptCount: number;
        lastRequestedAt: Date | null;
      }[]
    >`
      SELECT "windowStartedAt", "attemptCount", "lastRequestedAt"
      FROM "EmailVerificationRateLimit"
      WHERE "emailHash" = ${emailHash}
      FOR UPDATE
    `;
    const record = rows[0];
    if (!record) {
      throw new Error('Email verification rate limit record was not created.');
    }

    const windowExpired =
      record.windowStartedAt.getTime() <=
      now.getTime() - REQUEST_WINDOW_MS;
    const attemptCount = windowExpired ? 0 : record.attemptCount;
    const windowStartedAt = windowExpired ? now : record.windowStartedAt;
    if (
      attemptCount >= MAX_REQUESTS_PER_WINDOW ||
      (!windowExpired &&
        record.lastRequestedAt &&
        now.getTime() - record.lastRequestedAt.getTime() <
          MIN_REQUEST_INTERVAL_MS)
    ) {
      return false;
    }

    await transaction.emailVerificationRateLimit.update({
      where: { emailHash },
      data: {
        windowStartedAt,
        attemptCount: attemptCount + 1,
        lastRequestedAt: now,
        updatedAt: now,
      },
    });
    return true;
  }

  private async enforceUserRequestLimit(
    transaction: Prisma.TransactionClient,
    userId: number,
    now: Date,
    throwWhenLimited: boolean,
  ): Promise<boolean> {
    const requestCutoff = new Date(now.getTime() - REQUEST_WINDOW_MS);
    const recentRequests = await transaction.emailVerificationToken.count({
      where: {
        usuarioId: userId,
        criadoEm: { gte: requestCutoff },
      },
    });
    if (recentRequests < MAX_REQUESTS_PER_WINDOW) {
      return true;
    }
    if (throwWhenLimited) {
      throw new HttpException(
        'Limite de solicitações de confirmação excedido.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return false;
  }

  private async createToken(
    transaction: Prisma.TransactionClient,
    userId: number,
    email: string,
    now: Date,
  ): Promise<PreparedConfirmation> {
    const token = randomBytes(32).toString('base64url');
    await transaction.emailVerificationToken.updateMany({
      where: { usuarioId: userId, usadoEm: null },
      data: { usadoEm: now },
    });
    const tokenRecord = await transaction.emailVerificationToken.create({
      data: {
        usuarioId: userId,
        email,
        tokenHash: hashToken(token),
        expiraEm: new Date(now.getTime() + TOKEN_TTL_MS),
      },
      select: { id: true },
    });
    return { tokenRecordId: tokenRecord.id, email, token };
  }

  private async deliver(prepared: PreparedConfirmation): Promise<boolean> {
    try {
      await this.mailer.sendVerificationEmail(prepared.email, prepared.token);
      return true;
    } catch {
      await this.prisma.emailVerificationToken.updateMany({
        where: { id: prepared.tokenRecordId, usadoEm: null },
        data: { usadoEm: new Date() },
      });
      this.logger.warn(
        'Email verification delivery failed; token invalidated.',
      );
      return false;
    }
  }
}
