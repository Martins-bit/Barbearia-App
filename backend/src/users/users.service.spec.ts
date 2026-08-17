import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    usuario: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      usuario: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
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

  it('should update only allowed user fields and exclude ativo', async () => {
    const payload: UpdateUserDto = {
      nome: 'João Atualizado',
      email: 'joao.novo@email.com',
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
      data: payload,
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
});
