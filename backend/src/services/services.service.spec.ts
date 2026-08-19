import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServicesService } from './services.service';

describe('ServicesService', () => {
  let service: ServicesService;
  let prisma: {
    barbeiro: { findUnique: jest.Mock };
    servico: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  };

  const serviceRecord = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 1,
    nome: 'Corte',
    descricao: 'Corte tradicional',
    duracaoMinutos: 30,
    preco: new Prisma.Decimal('35.00'),
    ativo: true,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      barbeiro: { findUnique: jest.fn() },
      servico: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new ServicesService(prisma as unknown as PrismaService);
  });

  it('lista somente serviços ativos', async () => {
    prisma.servico.findMany.mockResolvedValue([serviceRecord()]);

    const result = await service.findActiveServices();

    expect(prisma.servico.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ativo: true },
    }));
    expect(result[0]).toMatchObject({ preco: '35.00', ativo: true });
  });

  it('não retorna serviço inativo por id', async () => {
    prisma.servico.findFirst.mockResolvedValue(null);

    await expect(service.findActiveServiceById(1)).rejects.toThrow(NotFoundException);
    expect(prisma.servico.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1, ativo: true },
    }));
  });

  it('converte Usuario.id para Barbeiro.id', async () => {
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 8 });

    await expect(service.findBarberIdByUserId(4)).resolves.toBe(8);
    expect(prisma.barbeiro.findUnique).toHaveBeenCalledWith({
      where: { usuarioId: 4 },
      select: { id: true },
    });
  });

  it('lista ativos e inativos somente do barbeiro autenticado', async () => {
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 8 });
    prisma.servico.findMany.mockResolvedValue([
      serviceRecord({ ativo: true }),
      serviceRecord({ id: 2, ativo: false }),
    ]);

    const result = await service.findOwnServicesByUserId(4);

    expect(prisma.servico.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { barbeiroId: 8 },
    }));
    expect(result).toHaveLength(2);
    expect(result[1].ativo).toBe(false);
  });

  it('cria serviço usando o barbeiro derivado do usuário', async () => {
    const data: CreateServiceDto = {
      nome: 'Corte',
      descricao: 'Corte tradicional',
      duracaoMinutos: 30,
      preco: '35.00',
    };
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 8 });
    prisma.servico.create.mockResolvedValue(serviceRecord());

    await expect(service.createService(4, data)).resolves.toMatchObject({
      preco: '35.00',
    });
    expect(prisma.servico.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ barbeiroId: 8, preco: new Prisma.Decimal('35.00') }),
    }));
  });

  it('restringe atualização ao serviço do barbeiro autenticado', async () => {
    const data: UpdateServiceDto = { nome: 'Corte atualizado' };
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 8 });
    prisma.servico.findFirst.mockResolvedValue(null);

    await expect(service.updateOwnService(4, 99, data)).rejects.toThrow(NotFoundException);
    expect(prisma.servico.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 99, barbeiroId: 8 },
    }));
    expect(prisma.servico.update).not.toHaveBeenCalled();
  });

  it('altera o status sem excluir o serviço', async () => {
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 8 });
    prisma.servico.findFirst.mockResolvedValue(serviceRecord());
    prisma.servico.update.mockResolvedValue(serviceRecord({ ativo: false }));

    await expect(service.updateOwnServiceStatus(4, 1, false)).resolves.toMatchObject({
      ativo: false,
    });
    expect(prisma.servico.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { ativo: false },
    }));
  });

  it('rejeita atualização vazia', async () => {
    await expect(service.updateOwnService(4, 1, {})).rejects.toThrow(BadRequestException);
    expect(prisma.barbeiro.findUnique).not.toHaveBeenCalled();
  });

  it('serializa preço decimal com duas casas', async () => {
    prisma.servico.findFirst.mockResolvedValue(
      serviceRecord({ preco: new Prisma.Decimal('7') }),
    );

    const result = await service.findActiveServiceById(1);

    expect(result.preco).toBe('7.00');
  });
});