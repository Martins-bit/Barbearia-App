import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';

jest.mock('../common/utils/password.util', () => ({
  hashPassword: jest.fn(async () => '$2b$10$mocked-safe-password-hash'),
  isPasswordWithinBcryptLimit: jest.fn(
    (password: string) => Buffer.byteLength(password, 'utf8') <= 72,
  ),
}));

const {
  FirstAdminProvisioningService,
  validateFirstAdminInput,
} = require('./first-admin-provisioning');
const { hashPassword } = require('../common/utils/password.util');

describe('FirstAdminProvisioningService', () => {
  let prisma: any;
  let transaction: any;
  let service: InstanceType<typeof FirstAdminProvisioningService>;

  beforeEach(() => {
    process.env.FIRST_ADMIN_PROVISIONING = 'yes';
    process.env.FIRST_ADMIN_DATABASE_NAME = 'barbearia';
    process.env.DATABASE_URL =
      'postgresql://usuario:secret@127.0.0.1:5432/barbearia';
    transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      usuario: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 100,
          tipoUsuario: TipoUsuario.ADMIN,
          ativo: true,
          emailVerificadoEm: new Date('2026-11-21T20:00:00.000Z'),
        }),
      },
    };
    prisma = {
      $transaction: jest.fn((callback) => callback(transaction)),
      getDatabaseUrl: jest.fn(
        () => process.env.DATABASE_URL,
      ),
    };
    service = new FirstAdminProvisioningService(prisma);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('blocks direct service calls without explicit operational confirmation', async () => {
    await expect(
      service.provision({
        nome: 'Responsável',
        telefone: '11999999999',
        email: 'admin@example.com',
        senha: 'senha-segura',
        confirmarSenha: 'senha-segura',
        confirmacaoOperacional: 'OUTRA',
      } as any),
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('blocks direct service calls when operational authorization is absent', async () => {
    delete process.env.FIRST_ADMIN_PROVISIONING;

    await expect(
      service.provision({
        nome: 'Responsável',
        telefone: '11999999999',
        email: 'admin@example.com',
        senha: 'senha-segura',
        confirmarSenha: 'senha-segura',
        confirmacaoOperacional: 'PROVISIONAR',
      }),
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('blocks direct service calls for remote database destinations', async () => {
    process.env.DATABASE_URL =
      'postgresql://usuario:secret@db.exemplo.com:5432/barbearia';

    await expect(
      service.provision({
        nome: 'Responsável',
        telefone: '11999999999',
        email: 'admin@example.com',
        senha: 'senha-segura',
        confirmarSenha: 'senha-segura',
        confirmacaoOperacional: 'PROVISIONAR',
      }),
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('aborts before the transaction if the Prisma URL differs from the validated URL', async () => {
    process.env.DATABASE_URL =
      'postgresql://usuario:secret@127.0.0.1:5432/barbearia';
    prisma.getDatabaseUrl.mockReturnValue(
      'postgresql://usuario:secret@127.0.0.1:5432/outro_banco',
    );

    await expect(
      service.provision({
        nome: 'Responsável',
        telefone: '11999999999',
        email: 'admin@example.com',
        senha: 'senha-segura',
        confirmarSenha: 'senha-segura',
        confirmacaoOperacional: 'PROVISIONAR',
      }),
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates the first ADMIN active and confirmed without profiles', async () => {
    const result = await service.provision({
      nome: 'Responsável',
      telefone: '11999999999',
      email: ' Admin@Example.com ',
      senha: 'senha-segura',
      confirmarSenha: 'senha-segura',
      confirmacaoOperacional: 'PROVISIONAR',
    });

    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.usuario.count).toHaveBeenCalledWith({
      where: { tipoUsuario: TipoUsuario.ADMIN },
    });
    expect(hashPassword).toHaveBeenCalledWith('senha-segura');
    expect(transaction.usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nome: 'Responsável',
          telefone: '11999999999',
          email: 'admin@example.com',
          tipoUsuario: TipoUsuario.ADMIN,
          ativo: true,
          emailConfirmacaoObrigatoria: false,
          authVersion: 0,
          emailVerificadoEm: expect.any(Date),
          senhaHash: '$2b$10$mocked-safe-password-hash',
        }),
      }),
    );
    expect(transaction.usuario.create.mock.calls[0][0].data).not.toHaveProperty(
      'cliente',
    );
    expect(transaction.usuario.create.mock.calls[0][0].data).not.toHaveProperty(
      'barbeiro',
    );
    expect(result).toMatchObject({
      id: 100,
      tipoUsuario: 'ADMIN',
      ativo: true,
    });
  });

  it('blocks repetition after an ADMIN already exists', async () => {
    transaction.usuario.count.mockResolvedValue(1);

    await expect(
      service.provision({
        nome: 'Responsável',
        telefone: '11999999999',
        email: 'admin@example.com',
        senha: 'senha-segura',
        confirmarSenha: 'senha-segura',
        confirmacaoOperacional: 'PROVISIONAR',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.usuario.create).not.toHaveBeenCalled();
  });

  it('rechecks ADMIN existence inside the transaction after advisory lock', async () => {
    await service.provision({
      nome: 'Responsável',
      telefone: '11999999999',
      email: 'admin@example.com',
      senha: 'senha-segura',
      confirmarSenha: 'senha-segura',
      confirmacaoOperacional: 'PROVISIONAR',
    });

    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.usuario.count).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate phone and email', async () => {
    transaction.usuario.findUnique.mockResolvedValue({ id: 3 });

    await expect(
      service.provision({
        nome: 'Responsável',
        telefone: '11999999999',
        email: 'admin@example.com',
        senha: 'senha-segura',
        confirmarSenha: 'senha-segura',
        confirmacaoOperacional: 'PROVISIONAR',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    transaction.usuario.findUnique.mockResolvedValue(null);
    transaction.usuario.findFirst.mockResolvedValue({ id: 4 });

    await expect(
      service.provision({
        nome: 'Responsável',
        telefone: '11888888888',
        email: 'admin@example.com',
        senha: 'senha-segura',
        confirmarSenha: 'senha-segura',
        confirmacaoOperacional: 'PROVISIONAR',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid identity and password values', () => {
    expect(() =>
      validateFirstAdminInput({
        nome: '',
        telefone: '123',
        email: 'invalid',
        senha: 'short',
        confirmarSenha: 'different',
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateFirstAdminInput({
        nome: 'Responsável',
        telefone: '11999999999',
        email: 'admin@example.com',
        senha: 'a'.repeat(73),
        confirmarSenha: 'a'.repeat(73),
      }),
    ).toThrow(BadRequestException);
  });

  it('never promotes or modifies an existing user', async () => {
    await service.provision({
      nome: 'Novo Administrador',
      telefone: '11777777777',
      email: 'novo@example.com',
      senha: 'senha-segura',
      confirmarSenha: 'senha-segura',
      confirmacaoOperacional: 'PROVISIONAR',
    });

    expect(transaction.usuario.create).toHaveBeenCalledTimes(1);
    expect(transaction.usuario.update).toBeUndefined();
  });
});
