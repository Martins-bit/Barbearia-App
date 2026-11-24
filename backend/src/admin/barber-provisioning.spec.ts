import { BadRequestException, ConflictException } from '@nestjs/common';
import { userInfo } from 'node:os';
import { Prisma } from '../generated/prisma/client';
import { TipoUsuario } from '../generated/prisma/enums';
import { hashPassword } from '../common/utils/password.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  BarberProvisioningService,
  validateBarberProvisioningInput,
} from './barber-provisioning';

type CreatedBarberUser = {
  id: number;
  tipoUsuario: TipoUsuario;
  ativo: boolean;
  emailConfirmacaoObrigatoria: boolean;
  barbeiro: { id: number; ativo: boolean };
};

type UserCreateArgs = {
  data: Record<string, unknown> & {
    nome: string;
    telefone: string;
    email: string;
    senhaHash: string;
    tipoUsuario: TipoUsuario;
    ativo: boolean;
    emailVerificadoEm: null;
    emailConfirmacaoObrigatoria: boolean;
    authVersion: number;
    barbeiro: { create: { ativo: boolean } };
  };
  select: Record<string, unknown>;
};

jest.mock('../common/utils/password.util', () => ({
  hashPassword: jest.fn(() =>
    Promise.resolve('$2b$10$mocked-safe-password-hash'),
  ),
  isPasswordWithinBcryptLimit: jest.fn(
    (password: string) => Buffer.byteLength(password, 'utf8') <= 72,
  ),
}));

describe('BarberProvisioningService', () => {
  const environmentKeys = [
    'BARBER_PROVISIONING',
    'BARBER_PROVISIONING_OPERATOR',
    'BARBER_DATABASE_NAME',
    'DATABASE_URL',
    'NODE_ENV',
  ] as const;
  let previousEnvironment: Partial<
    Record<(typeof environmentKeys)[number], string>
  >;
  let prisma: {
    $transaction: jest.Mock;
    getDatabaseUrl: jest.Mock;
  };
  let transaction: {
    usuario: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock<Promise<CreatedBarberUser>, [UserCreateArgs]>;
    };
  };
  let service: BarberProvisioningService;

  const validInput = {
    nome: 'Bruno',
    telefone: '11999999999',
    email: ' Bruno@Example.com ',
    senha: 'senha-segura',
    confirmarSenha: 'senha-segura',
    confirmacaoOperacional: 'PROVISIONAR BARBEIRO barbearia',
  };

  beforeEach(() => {
    previousEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    process.env.BARBER_PROVISIONING = 'yes';
    process.env.BARBER_PROVISIONING_OPERATOR = userInfo().username;
    process.env.BARBER_DATABASE_NAME = 'barbearia';
    process.env.DATABASE_URL =
      'postgresql://local:secret@127.0.0.1:5432/barbearia';
    process.env.NODE_ENV = 'development';

    transaction = {
      usuario: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn<Promise<CreatedBarberUser>, [UserCreateArgs]>()
          .mockResolvedValue({
            id: 12,
            tipoUsuario: TipoUsuario.BARBEIRO,
            ativo: true,
            emailConfirmacaoObrigatoria: true,
            barbeiro: { id: 34, ativo: true },
          }),
      },
    };
    prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      getDatabaseUrl: jest.fn(() => process.env.DATABASE_URL),
    };
    service = new BarberProvisioningService(prisma as unknown as PrismaService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    for (const key of environmentKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('creates an active BARBEIRO and profile pending email confirmation atomically', async () => {
    const result = await service.provision(validInput);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const createArgs = transaction.usuario.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      nome: 'Bruno',
      telefone: '11999999999',
      email: 'bruno@example.com',
      senhaHash: '$2b$10$mocked-safe-password-hash',
      tipoUsuario: TipoUsuario.BARBEIRO,
      ativo: true,
      emailVerificadoEm: null,
      emailConfirmacaoObrigatoria: true,
      authVersion: 0,
      barbeiro: { create: { ativo: true } },
    });
    expect(createArgs.data).not.toHaveProperty('cliente');
    expect(hashPassword).toHaveBeenCalledWith(validInput.senha);
    expect(result).toEqual({
      id: 12,
      barbeiroId: 34,
      tipoUsuario: 'BARBEIRO',
      ativo: true,
      emailConfirmacaoObrigatoria: true,
    });
  });

  it('does not start a transaction without operator authorization', async () => {
    process.env.BARBER_PROVISIONING_OPERATOR = 'another-operator';

    await expect(service.provision(validInput)).rejects.toThrow(
      'A conta do sistema operacional não está autorizada.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not start a transaction outside development', async () => {
    process.env.NODE_ENV = 'production';

    await expect(service.provision(validInput)).rejects.toThrow(
      'O provisionamento de barbeiro só é permitido em development.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a mismatched Prisma destination and confirmation phrase', async () => {
    prisma.getDatabaseUrl.mockReturnValue(
      'postgresql://local:secret@127.0.0.1:5432/other',
    );
    await expect(service.provision(validInput)).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    prisma.getDatabaseUrl.mockReturnValue(process.env.DATABASE_URL);
    await expect(
      service.provision({
        ...validInput,
        confirmacaoOperacional: 'PROVISIONAR',
      }),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['nome', { nome: ' ' }],
    ['telefone', { telefone: '123' }],
    ['e-mail', { email: 'inválido' }],
    ['senha curta', { senha: '123', confirmarSenha: '123' }],
    ['senha longa', { senha: 'a'.repeat(73), confirmarSenha: 'a'.repeat(73) }],
    ['confirmação da senha', { confirmarSenha: 'outra-senha' }],
  ])('rejects invalid %s', (_label, override) => {
    expect(() =>
      validateBarberProvisioningInput({ ...validInput, ...override }),
    ).toThrow(BadRequestException);
  });

  it('rejects existing phone or case-insensitive email without modifying accounts', async () => {
    transaction.usuario.findUnique.mockResolvedValue({ id: 2 });
    await expect(service.provision(validInput)).rejects.toBeInstanceOf(
      ConflictException,
    );

    transaction.usuario.findUnique.mockResolvedValue(null);
    transaction.usuario.findFirst.mockResolvedValue({ id: 3 });
    await expect(service.provision(validInput)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(transaction.usuario.create).not.toHaveBeenCalled();
    expect(transaction.usuario).not.toHaveProperty('update');
  });

  it('converts a concurrent unique-constraint collision to a conflict', async () => {
    transaction.usuario.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );

    await expect(service.provision(validInput)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
