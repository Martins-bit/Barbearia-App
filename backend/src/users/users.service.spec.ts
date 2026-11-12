import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma } from '../generated/prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/**
 * Constrói um P2002 realista do Prisma 7 + @prisma/adapter-pg.
 *
 * No Prisma 7 o `meta.target` NÃO é populado; os dados da violação ficam em
 * `meta.driverAdapterError.cause`, com `kind: "UniqueConstraintViolation"`
 * e o nome do índice em `originalMessage`.
 */
function buildP2002(meta: Record<string, unknown>): unknown {
  const error = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`email`)',
    {
      code: 'P2002',
      clientVersion: '7.9.1',
      meta,
    },
  );
  return error;
}

function buildDriverAdapterCause(
  originalMessage: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    driverAdapterError: {
      name: 'PrismaClientKnownRequestError',
      originalCode: '23505',
      originalMessage,
      kind: 'UniqueConstraintViolation',
      cause: {
        originalCode: '23505',
        originalMessage,
        kind: 'UniqueConstraintViolation',
        ...extra,
      },
    },
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    $transaction: jest.Mock;
    usuario: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    emailVerificationToken: {
      updateMany: jest.Mock;
    };
    passwordResetToken: {
      updateMany: jest.Mock;
    };
    agendamento: { findMany: jest.Mock };
    listaEspera: { findMany: jest.Mock };
    mensagem: { findMany: jest.Mock };
    notificacao: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      usuario: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      emailVerificationToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      agendamento: { findMany: jest.fn().mockResolvedValue([]) },
      listaEspera: { findMany: jest.fn().mockResolvedValue([]) },
      mensagem: { findMany: jest.fn().mockResolvedValue([]) },
      notificacao: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should normalize profile e-mail before validation', async () => {
    const dto = plainToInstance(UpdateUserDto, {
      email: '  Novo@Example.com  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.email).toBe('novo@example.com');

    const invalidDto = plainToInstance(UpdateUserDto, {
      email: 'nome..sobrenome@example.com',
    });
    expect(await validate(invalidDto)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'email' })]),
    );
  });

  it('should find a user by id without exposing senhaHash', async () => {
    prisma.usuario.findUnique.mockResolvedValue({
      id: 1,
      nome: 'João',
      telefone: '11999999999',
      email: 'joao@email.com',
      senhaHash: 'hash-secreta',
      tipoUsuario: 'CLIENTE',
      ativo: true,
      dataCriacao: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.findById(1);

    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: expect.objectContaining({
        id: true,
        nome: true,
        telefone: true,
        email: true,
        emailVerificadoEm: true,
        tipoUsuario: true,
        ativo: true,
        dataCriacao: true,
        dataAtualizacao: true,
      }),
    });
    expect(result).not.toHaveProperty('senhaHash');
    expect(result).toMatchObject({
      id: 1,
      nome: 'João',
      telefone: '11999999999',
      email: 'joao@email.com',
      tipoUsuario: 'CLIENTE',
      ativo: true,
    });
  });

  it('should export only the authenticated user data and omit security and free-text content', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const emailVerifiedAt = new Date('2026-01-03T03:04:05.000Z');
    prisma.usuario.findUnique.mockResolvedValue({
      id: 21,
      nome: 'Cliente',
      telefone: '11999999999',
      email: 'cliente@example.com',
      emailVerificadoEm: emailVerifiedAt,
      emailConfirmacaoObrigatoria: false,
      senhaHash: 'secret-password-hash',
      authVersion: 12,
      tipoUsuario: 'CLIENTE',
      ativo: true,
      dataCriacao: createdAt,
      dataAtualizacao: createdAt,
      cliente: {
        id: 31,
        dataCriacao: createdAt,
        dataAtualizacao: createdAt,
      },
      barbeiro: null,
    });
    prisma.agendamento.findMany.mockResolvedValue([
      {
        data: new Date('2026-02-01T00:00:00.000Z'),
        horaInicio: new Date('2026-02-01T12:00:00.000Z'),
        horaFim: new Date('2026-02-01T12:30:00.000Z'),
        status: 'CONCLUIDO',
        dataCriacao: createdAt,
        dataAtualizacao: createdAt,
        servico: { nome: 'Corte', duracaoMinutos: 30 },
        observacoes: 'terceiro@example.com',
      },
    ]);
    prisma.mensagem.findMany.mockResolvedValue([
      {
        remetenteId: 21,
        lida: true,
        dataCriacao: createdAt,
        dataLeitura: createdAt,
        apagadaParaTodos: false,
        dataExclusao: null,
        conteudo: 'texto que não deve ser exportado',
        destinatarioId: 98,
      },
    ]);
    prisma.notificacao.findMany.mockResolvedValue([
      {
        tipo: 'AGENDAMENTO',
        titulo: 'Dados de terceiro: terceiro@example.com',
        mensagem: 'Detalhe privado de terceiro',
        lida: false,
        dataCriacao: createdAt,
        dataLeitura: null,
        claim: null,
      },
    ]);

    const result = await service.exportPersonalData(21);

    expect(prisma.usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 21 } }),
    );
    expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ clienteId: 31 }] } }),
    );
    expect(prisma.agendamento.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'observacoes',
    );
    expect(prisma.listaEspera.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ clienteId: 31 }] } }),
    );
    expect(prisma.mensagem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          apagadaParaTodos: false,
          OR: [
            expect.objectContaining({
              remetenteId: 21,
              excluidaPeloRemetente: false,
            }),
            expect.objectContaining({
              destinatarioId: 21,
              excluidaPeloDestinatario: false,
            }),
          ],
        },
      }),
    );
    expect(prisma.notificacao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usuarioId: 21, limpa: false },
      }),
    );
    expect(prisma.notificacao.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'mensagem',
    );
    expect(result.conta).toMatchObject({
      nome: 'Cliente',
      email: 'cliente@example.com',
      confirmacaoEmail: {
        confirmadoEm: emailVerifiedAt.toISOString(),
        confirmacaoObrigatoria: false,
      },
    });
    expect(result.agendamentos).toHaveLength(1);
    expect(result.mensagens.conteudoIncluido).toBe(false);
    expect(result.mensagens.registros).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('texto que não deve ser exportado');
    expect(JSON.stringify(result)).not.toContain('terceiro@example.com');
    expect(JSON.stringify(result)).not.toContain('Detalhe privado de terceiro');
    expect(JSON.stringify(result)).not.toContain('secret-password-hash');
    expect(JSON.stringify(result)).not.toContain('authVersion');
    expect(JSON.stringify(result)).not.toContain('senhaHash');
    expect(JSON.stringify(result)).not.toContain('tokenHash');
  });

  it('should not export any data when the authenticated account no longer exists', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null);

    await expect(service.exportPersonalData(404)).rejects.toThrow(
      'Usuário não encontrado.',
    );
    expect(prisma.agendamento.findMany).not.toHaveBeenCalled();
    expect(prisma.listaEspera.findMany).not.toHaveBeenCalled();
  });

  it('should scope a barber export to their own agenda and profile data', async () => {
    const date = new Date('2026-03-04T00:00:00.000Z');
    prisma.usuario.findUnique.mockResolvedValue({
      id: 22,
      nome: 'Barbeiro',
      telefone: '11888888888',
      email: null,
      emailVerificadoEm: null,
      emailConfirmacaoObrigatoria: false,
      tipoUsuario: 'BARBEIRO',
      ativo: true,
      dataCriacao: date,
      dataAtualizacao: date,
      cliente: null,
      barbeiro: {
        id: 32,
        ativo: true,
        dataCriacao: date,
        dataAtualizacao: date,
        horarios: [],
        bloqueios: [
          {
            data: date,
            horaInicio: new Date('2026-03-04T10:00:00.000Z'),
            horaFim: new Date('2026-03-04T11:00:00.000Z'),
            motivo: 'Pessoa de terceiro - 11999999999',
            ativo: true,
            dataCriacao: date,
          },
        ],
        emergencias: [
          {
            dataInicio: date,
            dataFim: date,
            motivo: 'Detalhe de terceiro',
            status: 'ATIVA',
            dataCriacao: date,
          },
        ],
      },
    });

    const result = await service.exportPersonalData(22);

    expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ barbeiroId: 32 }] } }),
    );
    expect(prisma.listaEspera.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ barbeiroId: 32 }] } }),
    );
    expect(result.conta.perfil).toMatchObject({ ativo: true, horarios: [] });
    expect(result.conta.perfil).not.toHaveProperty('usuarioId');
    expect(JSON.stringify(result)).not.toContain('11999999999');
    expect(JSON.stringify(result)).not.toContain('Detalhe de terceiro');
    const barberSelect =
      prisma.usuario.findUnique.mock.calls[0][0].select.barbeiro.select;
    expect(barberSelect.bloqueios.select).not.toHaveProperty('motivo');
    expect(barberSelect.emergencias.select).not.toHaveProperty('motivo');
  });

  it('should find a user by phone without exposing senhaHash', async () => {
    prisma.usuario.findUnique.mockResolvedValue({
      id: 2,
      nome: 'Maria',
      telefone: '11888888888',
      email: null,
      senhaHash: 'hash-secreta-2',
      tipoUsuario: 'BARBEIRO',
      ativo: true,
      dataCriacao: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.findByPhone('11888888888');

    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
      where: { telefone: '11888888888' },
      select: expect.objectContaining({
        id: true,
        nome: true,
        telefone: true,
        email: true,
        tipoUsuario: true,
        ativo: true,
        dataCriacao: true,
        dataAtualizacao: true,
      }),
    });
    expect(result).not.toHaveProperty('senhaHash');
    expect(result?.telefone).toBe('11888888888');
  });

  it('should find e-mail matches without case sensitivity', async () => {
    prisma.usuario.findFirst.mockResolvedValue({ id: 7 });

    await expect(service.findByEmail('ana@example.com')).resolves.toEqual({
      id: 7,
    });
    expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'ana@example.com', mode: 'insensitive' } },
      select: { id: true },
    });
  });

  it('should look up only active users with a verified e-mail', async () => {
    prisma.usuario.findFirst.mockResolvedValue({
      id: 3,
      nome: 'Ana',
      telefone: '11777777777',
      email: 'ana@email.com',
      senhaHash: 'hash-secreta-3',
      tipoUsuario: 'CLIENTE',
      ativo: true,
      dataCriacao: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.findByVerifiedEmail('ana@email.com');

    expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
      where: {
        email: 'ana@email.com',
        emailVerificadoEm: { not: null },
        ativo: true,
      },
      select: expect.any(Object),
    });
    expect(result).not.toHaveProperty('senhaHash');
  });

  it('should allow password recovery only for one active, verified e-mail match', async () => {
    prisma.usuario.findMany.mockResolvedValue([
      { id: 3, email: 'Ana@Email.com', tipoUsuario: 'BARBEIRO' },
    ]);

    await expect(
      service.findForPasswordRecovery('ana@email.com'),
    ).resolves.toEqual({
      id: 3,
      email: 'Ana@Email.com',
      tipoUsuario: 'BARBEIRO',
    });
    expect(prisma.usuario.findMany).toHaveBeenCalledWith({
      where: {
        email: { equals: 'ana@email.com', mode: 'insensitive' },
        emailVerificadoEm: { not: null },
        ativo: true,
      },
      select: { id: true, email: true, tipoUsuario: true },
      take: 2,
    });
  });

  it('should map a duplicate e-mail during user creation to a conflict', async () => {
    prisma.usuario.create.mockRejectedValue(
      buildP2002(buildDriverAdapterCause('Unique constraint Usuario_email_key')),
    );

    await expect(
      service.createUser({
        nome: 'João',
        telefone: '11999999999',
        email: 'joao@example.com',
        senhaHash: 'hash',
        tipoUsuario: 'CLIENTE',
      }),
    ).rejects.toThrow('Este e-mail já está em uso por outra conta.');
  });

  it('should fail closed when multiple accounts match the normalized e-mail', async () => {
    prisma.usuario.findMany.mockResolvedValue([
      { id: 3, email: 'Ana@Email.com', tipoUsuario: 'CLIENTE' },
      { id: 4, email: 'ana@email.com', tipoUsuario: 'BARBEIRO' },
    ]);

    await expect(
      service.findForPasswordRecovery('ana@email.com'),
    ).resolves.toBeNull();
  });

  it('should update only allowed user fields and exclude ativo', async () => {
    const payload: UpdateUserDto = {
      nome: 'João Atualizado',
      email: '  JOAO.NOVO@EMAIL.COM  ',
      telefone: '11999999998',
    };

    prisma.usuario.findUnique.mockResolvedValue({
      id: 1,
      nome: 'João',
      telefone: '11999999999',
      email: 'joao@email.com',
      senhaHash: 'hash-secreta',
      tipoUsuario: 'CLIENTE',
      ativo: true,
      dataCriacao: new Date(),
      dataAtualizacao: new Date(),
    });

    prisma.usuario.update.mockResolvedValue({
      id: 1,
      nome: 'João Atualizado',
      telefone: '11999999998',
      email: 'joao.novo@email.com',
      senhaHash: 'hash-secreta',
      tipoUsuario: 'CLIENTE',
      ativo: true,
      dataCriacao: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.updateUser(1, payload);

    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        ...payload,
        email: 'joao.novo@email.com',
        emailVerificadoEm: null,
        emailConfirmacaoObrigatoria: true,
      },
      select: expect.objectContaining({
        id: true,
        nome: true,
        telefone: true,
        email: true,
        tipoUsuario: true,
        ativo: true,
        dataCriacao: true,
        dataAtualizacao: true,
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: 1, usadoEm: null },
      data: { usadoEm: expect.any(Date) },
    });
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: 1, usadoEm: null },
      data: { usadoEm: expect.any(Date) },
    });
    expect(result).not.toHaveProperty('senhaHash');
    expect(result.nome).toBe('João Atualizado');
  });

  it('should prepare an internal list method without exposing it publicly', async () => {
    prisma.usuario.findMany.mockResolvedValue([
      {
        id: 1,
        nome: 'João',
        telefone: '11999999999',
        email: 'joao@email.com',
        senhaHash: 'hash-secreta',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      },
    ]);

    const result = await service.findAllInternal();

    expect(prisma.usuario.findMany).toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).not.toHaveProperty('senhaHash');
  });

  describe('updateUser — pre-check de e-mail (DEF-1)', () => {
    it('should not search for null e-mail when clearing the e-mail of a user that has one', async () => {
      // Reprodução do DEF-1: usuário COM e-mail que solicita a limpeza
      // (email: null). Como `email` é anulável, o pre-check antigo fazia
      // findFirst({ email: null }), que no banco real encontra QUALQUER
      // usuário sem e-mail (id diferente) e gerava um falso 409.
      prisma.usuario.findUnique.mockResolvedValue({
        id: 10,
        nome: 'Com E-mail',
        telefone: '11999990001',
        email: 'antes@email.com',
        senhaHash: 'hash',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      });

      prisma.usuario.update.mockResolvedValue({
        id: 10,
        nome: 'Com E-mail',
        telefone: '11999990001',
        email: null,
        senhaHash: 'hash',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      });

      // Emula o banco real: outro usuário sem e-mail seria encontrado.
      prisma.usuario.findFirst.mockResolvedValue({
        id: 777,
        nome: 'Outro Usuário Sem E-mail',
        telefone: '11999990777',
        email: null,
      });

      const result = await service.updateUser(10, { email: null });

      // O pre-check de e-mail NÃO deve ser executado para e-mail nulo.
      expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalled();
      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: {
            email: null,
            emailVerificadoEm: null,
            emailConfirmacaoObrigatoria: false,
          },
        }),
      );
      expect(result.email).toBeNull();
    });

    it('should not trigger a false conflict when another user also has a null e-mail', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        id: 11,
        nome: 'Outro Sem E-mail',
        telefone: '11999990002',
        email: null,
        senhaHash: 'hash',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      });

      prisma.usuario.update.mockResolvedValue({
        id: 11,
        nome: 'Outro Sem E-mail',
        telefone: '11999990002',
        email: null,
        senhaHash: 'hash',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      });

      // Reprodução do DEF-1: outro usuário (id 778) também sem e-mail.
      prisma.usuario.findFirst.mockResolvedValue({
        id: 778,
        nome: 'Mais Um Sem E-mail',
        telefone: '11999990778',
        email: null,
      });

      await expect(
        service.updateUser(11, { email: null, nome: 'Novo Nome' }),
      ).resolves.toBeDefined();
      expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    });

    it('should still detect a duplicate e-mail owned by another user', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        id: 12,
        nome: 'Cliente',
        telefone: '11999990003',
        email: 'antigo@email.com',
        senhaHash: 'hash',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      });

      prisma.usuario.findFirst.mockResolvedValue({
        id: 99,
        nome: 'Dono',
        telefone: '11999990004',
        email: 'usado@email.com',
      });

      await expect(
        service.updateUser(12, { email: 'USADO@EMAIL.COM' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
        where: {
          email: { equals: 'usado@email.com', mode: 'insensitive' },
          id: { not: 12 },
        },
        select: { id: true },
      });
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('should preserve the own e-mail when resubmitted with different casing', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        id: 13,
        nome: 'Cliente',
        telefone: '11999990005',
        email: 'Meu@Email.com',
        senhaHash: 'hash',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      });

      prisma.usuario.update.mockResolvedValue({
        id: 13,
        nome: 'Cliente',
        telefone: '11999990005',
        email: 'Meu@Email.com',
        senhaHash: 'hash',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      });

      await expect(
        service.updateUser(13, { email: ' MEU@EMAIL.COM ' }),
      ).resolves.toBeDefined();
      expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
        where: {
          email: { equals: 'meu@email.com', mode: 'insensitive' },
          id: { not: 13 },
        },
        select: { id: true },
      });
      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 13 },
          data: { email: 'Meu@Email.com' },
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateUser — conflito de unicidade P2002 (DEF-2)', () => {
    const existingUser = {
      id: 20,
      nome: 'Cliente',
      telefone: '11999990010',
      email: 'cliente@email.com',
      senhaHash: 'hash',
      tipoUsuario: 'CLIENTE',
      ativo: true,
      dataCriacao: new Date(),
      dataAtualizacao: new Date(),
    };

    beforeEach(() => {
      prisma.usuario.findUnique.mockResolvedValue(existingUser);
      prisma.usuario.findFirst.mockResolvedValue(null);
    });

    it('should report the e-mail when the driver adapter cause points to the e-mail index', async () => {
      prisma.usuario.update.mockRejectedValue(
        buildP2002(
          buildDriverAdapterCause(
            'duplicar valor da chave viola a restrição de unicidade "Usuario_email_key"',
          ),
        ),
      );

      await expect(
        service.updateUser(20, { email: 'novo@email.com' }),
      ).rejects.toThrow(
        new ConflictException('Este e-mail já está em uso por outra conta.'),
      );
    });

    it('should report the telefone when the driver adapter cause points to the telefone index', async () => {
      prisma.usuario.update.mockRejectedValue(
        buildP2002(
          buildDriverAdapterCause(
            'duplicar valor da chave viola a restrição de unicidade "Usuario_telefone_key"',
          ),
        ),
      );

      await expect(
        service.updateUser(20, { telefone: '11999990011' }),
      ).rejects.toThrow(
        new ConflictException('Este telefone já está em uso por outra conta.'),
      );
    });

    it('should use the constraint field when it is present', async () => {
      prisma.usuario.update.mockRejectedValue(
        buildP2002(
          buildDriverAdapterCause('mensagem genérica do postgres', {
            constraint: 'Usuario_email_key',
          }),
        ),
      );

      await expect(
        service.updateUser(20, { email: 'outro@email.com' }),
      ).rejects.toThrow(
        new ConflictException('Este e-mail já está em uso por outra conta.'),
      );
    });

    it('should use a generic message when the conflicting field cannot be determined', async () => {
      prisma.usuario.update.mockRejectedValue(
        buildP2002(buildDriverAdapterCause('violação de unicidade genérica')),
      );

      await expect(
        service.updateUser(20, { nome: 'Novo Nome' }),
      ).rejects.toThrow(
        new ConflictException(
          'Os dados informados já estão em uso por outra conta.',
        ),
      );
    });

    it('should use a generic message when meta has no usable information', async () => {
      prisma.usuario.update.mockRejectedValue(buildP2002({}));

      await expect(
        service.updateUser(20, { nome: 'Novo Nome' }),
      ).rejects.toThrow(
        new ConflictException(
          'Os dados informados já estão em uso por outra conta.',
        ),
      );
    });

    it('should not assume a field when meta.target is not an array of strings', async () => {
      prisma.usuario.update.mockRejectedValue(
        buildP2002({ target: 'email', field_name: 'Usuario_email_key' }),
      );

      await expect(
        service.updateUser(20, { nome: 'Novo Nome' }),
      ).rejects.toThrow(
        new ConflictException(
          'Os dados informados já estão em uso por outra conta.',
        ),
      );
    });

    it('should support the legacy meta.target array format for e-mail', async () => {
      prisma.usuario.update.mockRejectedValue(
        buildP2002({ target: ['email'] }),
      );

      await expect(
        service.updateUser(20, { email: 'novo@email.com' }),
      ).rejects.toThrow(
        new ConflictException('Este e-mail já está em uso por outra conta.'),
      );
    });

    it('should support the legacy meta.target array format for telefone', async () => {
      prisma.usuario.update.mockRejectedValue(
        buildP2002({ target: ['telefone'] }),
      );

      await expect(
        service.updateUser(20, { telefone: '11999990012' }),
      ).rejects.toThrow(
        new ConflictException('Este telefone já está em uso por outra conta.'),
      );
    });

    it('should not leak internal details of a non-P2002 error', async () => {
      const erro = new Error('falha interna do banco');
      prisma.usuario.update.mockRejectedValue(erro);

      await expect(
        service.updateUser(20, { nome: 'Novo Nome' }),
      ).rejects.toThrow(erro);
    });
  });
});
