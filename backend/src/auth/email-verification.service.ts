import {
  BadRequestException,
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_VERIFICATION_MAILER,
} from './email-verification-mailer';
import type { EmailVerificationMailer } from './email-verification-mailer';

const TOKEN_TTL_MS = 30 * 60 * 1000;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const TOKEN_RETENTION_MS = 24 * 60 * 60 * 1000;
const INVALID_TOKEN_MESSAGE = 'Token de confirmação inválido ou expirado.';

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_VERIFICATION_MAILER)
    private readonly mailer: EmailVerificationMailer,
  ) {}

  async requestConfirmation(userId: number): Promise<{ message: string }> {
    const now = new Date();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);

    const result = await this.prisma.$transaction(async (transaction) => {
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
        throw new ServiceUnavailableException(
          'O envio de e-mail ainda não está configurado.',
        );
      }

      const retentionCutoff = new Date(now.getTime() - TOKEN_RETENTION_MS);
      await transaction.emailVerificationToken.deleteMany({
        where: {
          usuarioId: userId,
          criadoEm: { lt: retentionCutoff },
        },
      });

      const requestCutoff = new Date(now.getTime() - REQUEST_WINDOW_MS);
      const recentRequests =
        await transaction.emailVerificationToken.count({
          where: {
            usuarioId: userId,
            criadoEm: { gte: requestCutoff },
          },
        });
      if (recentRequests >= MAX_REQUESTS_PER_WINDOW) {
        throw new HttpException(
          'Limite de solicitações de confirmação excedido.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await transaction.emailVerificationToken.updateMany({
        where: { usuarioId: userId, usadoEm: null },
        data: { usadoEm: now },
      });

      const tokenRecord = await transaction.emailVerificationToken.create({
        data: {
          usuarioId: userId,
          email: user.email,
          tokenHash,
          expiraEm: new Date(now.getTime() + TOKEN_TTL_MS),
        },
        select: { id: true },
      });

      return {
        alreadyVerified: false as const,
        tokenRecordId: tokenRecord.id,
        email: user.email,
      };
    });

    if (result.alreadyVerified) {
      return { message: 'Este endereço de e-mail já está confirmado.' };
    }

    try {
      await this.mailer.sendVerificationEmail(result.email, token);
    } catch {
      await this.prisma.emailVerificationToken.updateMany({
        where: { id: result.tokenRecordId, usadoEm: null },
        data: { usadoEm: new Date() },
      });
      throw new ServiceUnavailableException(
        'Não foi possível enviar a confirmação de e-mail neste momento.',
      );
    }

    return { message: 'E-mail de confirmação enviado.' };
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
        data: { emailVerificadoEm: now },
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
}