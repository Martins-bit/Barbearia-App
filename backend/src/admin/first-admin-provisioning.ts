import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { normalizeEmail } from '../common/utils/email.util';
import {
  hashPassword,
  isPasswordWithinBcryptLimit,
} from '../common/utils/password.util';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  FirstAdminSafetyError,
  inspectSafeDatabaseDestination,
  isExplicitDestinationConfirmation,
} from './admin-provisioning-safety';

export const FIRST_ADMIN_LOCK_NAMESPACE = 7;

export interface FirstAdminProvisioningInput {
  nome: string;
  telefone: string;
  email: string;
  senha: string;
  confirmarSenha: string;
  confirmacaoOperacional: 'PROVISIONAR';
}

export interface ProvisionedAdmin {
  id: number;
  tipoUsuario: 'ADMIN';
  ativo: true;
  emailVerificadoEm: Date;
}

export function validateFirstAdminInput(
  input: FirstAdminProvisioningInput,
): { nome: string; telefone: string; email: string } {
  const nome = input.nome.trim();
  const telefone = input.telefone.trim();
  const email = normalizeEmail(input.email);

  if (nome.length < 2 || nome.length > 120) {
    throw new BadRequestException(
      'Nome deve possuir entre 2 e 120 caracteres.',
    );
  }
  if (!/^\d{10,11}$/.test(telefone)) {
    throw new BadRequestException(
      'Telefone deve conter 10 ou 11 dígitos.',
    );
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('E-mail inválido.');
  }
  if (input.senha.length < 8) {
    throw new BadRequestException(
      'Senha deve possuir no mínimo 8 caracteres.',
    );
  }
  if (!isPasswordWithinBcryptLimit(input.senha)) {
    throw new BadRequestException(
      'Senha deve possuir no máximo 72 bytes UTF-8.',
    );
  }
  if (input.senha !== input.confirmarSenha) {
    throw new BadRequestException(
      'A confirmação da senha não corresponde.',
    );
  }

  return { nome, telefone, email };
}

@Injectable()
export class FirstAdminProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  async provision(
    input: FirstAdminProvisioningInput,
  ): Promise<ProvisionedAdmin> {
    if (!isExplicitDestinationConfirmation(input.confirmacaoOperacional)) {
      throw new FirstAdminSafetyError(
        'ADMIN_PROVISIONING_CANCELLED',
        'Confirmação operacional ausente.',
      );
    }
    const destination = inspectSafeDatabaseDestination(process.env);
    if (
      typeof this.prisma.getDatabaseUrl === 'function' &&
      this.prisma.getDatabaseUrl() !== destination.connectionString
    ) {
      throw new FirstAdminSafetyError(
        'DATABASE_DESTINATION_UNEXPECTED',
        'A configuração efetiva do banco divergiu da configuração validada.',
      );
    }
    const validated = validateFirstAdminInput(input);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(
            ${FIRST_ADMIN_LOCK_NAMESPACE}::int,
            0::int
          )
        `;

        const adminCount = await transaction.usuario.count({
          where: { tipoUsuario: TipoUsuario.ADMIN },
        });
        if (adminCount > 0) {
          throw new ConflictException(
            'O primeiro administrador já foi provisionado.',
          );
        }

        const phoneOwner = await transaction.usuario.findUnique({
          where: { telefone: validated.telefone },
          select: { id: true },
        });
        if (phoneOwner) {
          throw new ConflictException('Telefone já cadastrado.');
        }

        const emailOwner = await transaction.usuario.findFirst({
          where: {
            email: { equals: validated.email, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (emailOwner) {
          throw new ConflictException('E-mail já cadastrado.');
        }

        const senhaHash = await hashPassword(input.senha);
        const verifiedAt = new Date();
        const created = await transaction.usuario.create({
          data: {
            nome: validated.nome,
            telefone: validated.telefone,
            email: validated.email,
            senhaHash,
            tipoUsuario: TipoUsuario.ADMIN,
            ativo: true,
            emailVerificadoEm: verifiedAt,
            emailConfirmacaoObrigatoria: false,
            authVersion: 0,
          },
          select: {
            id: true,
            tipoUsuario: true,
            ativo: true,
            emailVerificadoEm: true,
          },
        });

        if (
          created.tipoUsuario !== TipoUsuario.ADMIN ||
          !created.ativo ||
          !created.emailVerificadoEm
        ) {
          throw new Error(
            'Falha ao confirmar o provisionamento do administrador.',
          );
        }

        return {
          id: created.id,
          tipoUsuario: 'ADMIN',
          ativo: true,
          emailVerificadoEm: created.emailVerificadoEm,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Telefone ou e-mail já cadastrado.',
        );
      }
      throw error;
    }
  }
}
