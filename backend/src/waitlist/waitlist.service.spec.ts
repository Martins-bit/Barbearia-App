import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatusListaEspera } from '../generated/prisma/enums';
import { WaitlistService } from './waitlist.service';

function buildPrismaMock() {
  const listaEspera = {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    listaEspera,
  };

  return {
    cliente: { findUnique: jest.fn() },
    barbeiro: { findUnique: jest.fn() },
    servico: { findFirst: jest.fn() },
    listaEspera,
    $transaction: jest.fn(async (callback: any) => callback(tx)),
    $executeRaw: jest.fn().mockResolvedValue(undefined),
  };
}

describe('WaitlistService', () => {
  let prisma: any;
  let service: WaitlistService;

  const validDto = {
    barbeiroId: 10,
    servicoId: 20,
    data: '2099-01-12',
    horaInicio: '10:00',
    horaFim: '10:30',
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new WaitlistService(prisma as unknown as PrismaService);
  });

  it('cria entrada ativa válida', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });
    prisma.listaEspera.findFirst.mockResolvedValue(null);
    prisma.listaEspera.create.mockResolvedValue({
      id: 7,
      clienteId: 99,
      barbeiroId: 10,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.create(1, validDto);

    expect(result.status).toBe(StatusListaEspera.ATIVA);
    expect(result.servicoId).toBe(20);
    expect(prisma.listaEspera.create).toHaveBeenCalled();
  });

  it('resolve cliente pelo usuario autenticado', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });
    prisma.listaEspera.findFirst.mockResolvedValue(null);
    prisma.listaEspera.create.mockResolvedValue({
      id: 8,
      clienteId: 99,
      barbeiroId: 10,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });

    await service.create(123, validDto);

    expect(prisma.cliente.findUnique).toHaveBeenCalledWith({
      where: { usuarioId: 123 },
      select: { id: true },
    });
  });

  it('rejeita barbeiro inexistente/inativo', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue(null);
    prisma.servico.findFirst.mockResolvedValue(null);

    await expect(service.create(1, validDto)).rejects.toThrow(
      new NotFoundException('Barbeiro não encontrado.'),
    );
  });

  it('rejeita serviço inexistente/inativo/de outro barbeiro', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: false,
      barbeiroId: 99,
      nome: 'Corte',
    });

    await expect(service.create(1, validDto)).rejects.toThrow(
      new NotFoundException('Serviço não encontrado.'),
    );
  });

  it('rejeita data no passado', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });

    await expect(
      service.create(1, { ...validDto, data: '2020-01-06' }),
    ).rejects.toThrow(new BadRequestException('Data inválida.'));
  });

  it('rejeita faixa inválida', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });

    await expect(
      service.create(1, { ...validDto, horaInicio: '10:30', horaFim: '10:00' }),
    ).rejects.toThrow(new BadRequestException('horaFim deve ser posterior a horaInicio.'));
  });

  it('rejeita duplicidade ativa do mesmo cliente, serviço e data', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });
    prisma.listaEspera.findFirst.mockResolvedValue({
      id: 1,
      clienteId: 99,
      barbeiroId: 10,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
    });

    await expect(service.create(1, validDto)).rejects.toThrow(
      new ConflictException('Já existe uma entrada ativa para este cliente, serviço e data.'),
    );
  });

  it('permite nova entrada após cancelamento', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.barbeiro.findUnique.mockResolvedValue({ id: 10, ativo: true });
    prisma.servico.findFirst.mockResolvedValue({
      id: 20,
      ativo: true,
      barbeiroId: 10,
      nome: 'Corte',
    });
    prisma.listaEspera.findFirst.mockResolvedValue(null);
    prisma.listaEspera.create.mockResolvedValue({
      id: 11,
      clienteId: 99,
      barbeiroId: 10,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.create(1, validDto);
    expect(result.status).toBe(StatusListaEspera.ATIVA);
  });

  it('lista somente as entradas do cliente autenticado', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.listaEspera.findMany.mockResolvedValue([
      {
        id: 1,
        clienteId: 99,
        servicoId: 20,
        dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
        status: StatusListaEspera.ATIVA,
        dataEntrada: new Date('2099-01-01T00:00:00.000Z'),
        dataAtualizacao: new Date('2099-01-02T00:00:00.000Z'),
        servico: { id: 20, nome: 'Corte', barbeiro: { id: 10, usuario: { nome: 'Barbeiro A' } } },
      },
    ]);

    const result = await service.findMyWaitlist(1);
    expect(result).toHaveLength(1);
    expect(result[0].clienteId).toBeUndefined();
  });

  it('cancelamento do próprio cliente funciona e marca status CANCELADA', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.listaEspera.findUnique.mockResolvedValue({
      id: 3,
      clienteId: 99,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });
    prisma.listaEspera.update.mockResolvedValue({
      id: 3,
      clienteId: 99,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.CANCELADA,
      dataEntrada: new Date(),
      dataAtualizacao: new Date(),
    });

    const result = await service.cancel(1, 3);
    expect(result.status).toBe(StatusListaEspera.CANCELADA);
  });

  it('cancelar entrada de outro cliente retorna 404 genérico', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.listaEspera.findUnique.mockResolvedValue({
      id: 5,
      clienteId: 555,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.ATIVA,
    });

    await expect(service.cancel(1, 5)).rejects.toThrow(
      new NotFoundException('Entrada de lista de espera não encontrada.'),
    );
  });

  it('cancelamento repetido retorna 409', async () => {
    prisma.cliente.findUnique.mockResolvedValue({ id: 99 });
    prisma.listaEspera.findUnique.mockResolvedValue({
      id: 9,
      clienteId: 99,
      servicoId: 20,
      dataDesejada: new Date('2099-01-12T00:00:00.000Z'),
      status: StatusListaEspera.CANCELADA,
    });

    await expect(service.cancel(1, 9)).rejects.toThrow(
      new ConflictException('Esta entrada já está cancelada.'),
    );
  });
});
