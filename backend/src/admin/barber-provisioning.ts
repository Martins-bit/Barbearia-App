import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { TipoUsuario } from '../generated/prisma/enums';
import { normalizeEmail } from '../common/utils/email.util';
import {
  hashPassword,
  isPasswordWithinBcryptLimit,
} from '../common/utils/password.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  BarberProvisioningSafetyError,
  inspectSafeBarberDatabaseDestination,
  isExplicitBarberProvisioningConfirmation,
} from './barber-provisioning-safety';

export interface BarberProvisioningInput {
  nome: string;
  telefone: string;
  email: string;
  senha: string;
  confirmarSenha: string;
  confirmacaoOperacional: string;
}

export interface ProvisionedBarber {
  id: number;
  barbeiroId: number;
  tipoUsuario: 'BARBEIRO';
  ativo: true;
  emailConfirmacaoObrigatoria: true;
}

export function validateBarberProvisioningInput(
  input: BarberProvisioningInput,
): { nome: string; telefone: string; email: string } {
  const nome = typeof input.nome === 'string' ? input.nome.trim() : '';
  const telefone =
    typeof input.telefone === 'string' ? input.telefone.trim() : '';
  const email =
    typeof input.email === 'string' ? normalizeEmail(input.email) : '';

  if (nome.length < 2 || nome.length > 120) {
    throw new BadRequestException(
      'Nome deve possuir entre 2 e 120 caracteres.',
    );
  }
  if (!/^\d{10,11}$/.test(telefone)) {
    throw new BadRequestException('Telefone deve conter 10 ou 11 dígitos.');
  }
  if (
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new BadRequestException('E-mail inválido.');
  }
  if (typeof input.senha !== 'string' || input.senha.length < 8) {
    throw new BadRequestException('Senha deve possuir no mínimo 8 caracteres.');
  }
  if (!isPasswordWithinBcryptLimit(input.senha)) {
    throw new BadRequestException(
      'Senha deve possuir no máximo 72 bytes UTF-8.',
    );
  }
  if (
    typeof input.confirmarSenha !== 'string' ||
    input.senha !== input.confirmarSenha
  ) {
    throw new BadRequestException('A confirmação da senha não corresponde.');
  }

  return { nome, telefone, email };
}

@Injectable()
export class BarberProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  async provision(input: BarberProvisioningInput): Promise<ProvisionedBarber> {
    const destination = inspectSafeBarberDatabaseDestination(process.env);
    if (
      typeof this.prisma.getDatabaseUrl !== 'function' ||
      this.prisma.getDatabaseUrl() !== destination.connectionString
    ) {
      throw new BarberProvisioningSafetyError(
        'DATABASE_DESTINATION_UNEXPECTED',
        'A configuração efetiva do banco divergiu do destino validado.',
      );
    }
    if (
      !isExplicitBarberProvisioningConfirmation(
        input.confirmacaoOperacional,
        destination.database,
      )
    ) {
      throw new BarberProvisioningSafetyError(
        'BARBER_PROVISIONING_CANCELLED',
        'Confirmação operacional ausente.',
      );
    }

    const validated = validateBarberProvisioningInput(input);
    const senhaHash = await hashPassword(input.senha);

    try {
      return await this.prisma.$transaction(async (transaction) => {
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

        const created = await transaction.usuario.create({
          data: {
            nome: validated.nome,
            telefone: validated.telefone,
            email: validated.email,
            senhaHash,
            tipoUsuario: TipoUsuario.BARBEIRO,
            ativo: true,
            emailVerificadoEm: null,
            emailConfirmacaoObrigatoria: true,
            authVersion: 0,
            barbeiro: {
              create: { ativo: true },
            },
          },
          select: {
            id: true,
            tipoUsuario: true,
            ativo: true,
            emailConfirmacaoObrigatoria: true,
            barbeiro: {
              select: { id: true, ativo: true },
            },
          },
        });

        if (
          created.tipoUsuario !== TipoUsuario.BARBEIRO ||
          !created.ativo ||
          !created.emailConfirmacaoObrigatoria ||
          !created.barbeiro?.ativo
        ) {
          throw new Error('Falha ao confirmar o provisionamento do barbeiro.');
        }

        return {
          id: created.id,
          barbeiroId: created.barbeiro.id,
          tipoUsuario: 'BARBEIRO',
          ativo: true,
          emailConfirmacaoObrigatoria: true,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Telefone, e-mail ou perfil já cadastrado.',
        );
      }
      throw error;
    }
  }
}
