import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CategoriaSolicitacaoTitular } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePrivacyRequestDto } from './dto/create-privacy-request.dto';
import { PrivacyRequestsService } from './privacy-requests.service';

const idempotencyKey = '9c1e39b2-e675-4e29-a0de-4e4c15c3b64c';
const createdAt = new Date('2026-11-12T10:00:00.000Z');

function requestRecord(
  overrides: Partial<{
    id: number;
    categoria: CategoriaSolicitacaoTitular;
    dataCriacao: Date;
  }> = {},
) {
  return {
    id: 21,
    categoria: CategoriaSolicitacaoTitular.CORRECAO,
    status: 'RECEBIDA' as const,
    dataCriacao: createdAt,
    ...overrides,
  };
}

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.9.1',
  });
}

describe('PrivacyRequestsService', () => {
  let service: PrivacyRequestsService;
  let prisma: {
    solicitacaoTitular: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      solicitacaoTitular: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    };
    service = new PrivacyRequestsService(prisma as unknown as PrismaService);
  });

  it('creates a request using only the authenticated owner and category', async () => {
    prisma.solicitacaoTitular.findFirst.mockResolvedValue(null);
    prisma.solicitacaoTitular.create.mockResolvedValue(requestRecord());

    const result = await service.create(
      42,
      { categoria: CategoriaSolicitacaoTitular.CORRECAO },
      idempotencyKey,
    );

    expect(prisma.solicitacaoTitular.create).toHaveBeenCalledWith({
      data: {
        titularId: 42,
        chaveIdempotencia: idempotencyKey,
        categoria: CategoriaSolicitacaoTitular.CORRECAO,
      },
      select: {
        id: true,
        categoria: true,
        status: true,
        dataCriacao: true,
      },
    });
    expect(result).toEqual({
      id: 21,
      categoria: CategoriaSolicitacaoTitular.CORRECAO,
      status: 'RECEBIDA',
      dataCriacao: createdAt.toISOString(),
    });
    expect(result).not.toHaveProperty('chaveIdempotencia');
    expect(result).not.toHaveProperty('titularId');
  });

  it('returns an existing request for the same owner, key, and category', async () => {
    prisma.solicitacaoTitular.findFirst.mockResolvedValue(requestRecord());

    const result = await service.create(
      42,
      { categoria: CategoriaSolicitacaoTitular.CORRECAO },
      idempotencyKey,
    );

    expect(result.id).toBe(21);
    expect(prisma.solicitacaoTitular.create).not.toHaveBeenCalled();
    expect(prisma.solicitacaoTitular.findFirst).toHaveBeenCalledWith({
      where: { titularId: 42, chaveIdempotencia: idempotencyKey },
      select: {
        id: true,
        categoria: true,
        status: true,
        dataCriacao: true,
      },
    });
  });

  it('rejects reusing a key for another category for the same owner', async () => {
    prisma.solicitacaoTitular.findFirst.mockResolvedValue(requestRecord());

    await expect(
      service.create(
        42,
        { categoria: CategoriaSolicitacaoTitular.OUTRA },
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.solicitacaoTitular.create).not.toHaveBeenCalled();
  });

  it('recovers a concurrent duplicate by re-reading the owner-scoped row', async () => {
    prisma.solicitacaoTitular.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(requestRecord());
    prisma.solicitacaoTitular.create.mockRejectedValue(uniqueConstraintError());

    const result = await service.create(
      42,
      { categoria: CategoriaSolicitacaoTitular.CORRECAO },
      idempotencyKey,
    );

    expect(result.id).toBe(21);
    expect(prisma.solicitacaoTitular.findFirst).toHaveBeenLastCalledWith({
      where: { titularId: 42, chaveIdempotencia: idempotencyKey },
      select: {
        id: true,
        categoria: true,
        status: true,
        dataCriacao: true,
      },
    });
  });

  it('returns conflict when a concurrent duplicate used another category', async () => {
    prisma.solicitacaoTitular.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        requestRecord({ categoria: CategoriaSolicitacaoTitular.CORRECAO }),
      );
    prisma.solicitacaoTitular.create.mockRejectedValue(uniqueConstraintError());

    await expect(
      service.create(
        42,
        { categoria: CategoriaSolicitacaoTitular.OUTRA },
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not share the same key across different owners', async () => {
    prisma.solicitacaoTitular.findFirst.mockResolvedValue(null);
    prisma.solicitacaoTitular.create
      .mockResolvedValueOnce(requestRecord({ id: 21 }))
      .mockResolvedValueOnce(requestRecord({ id: 22 }));

    await service.create(
      42,
      { categoria: CategoriaSolicitacaoTitular.CORRECAO },
      idempotencyKey,
    );
    const secondResult = await service.create(
      43,
      { categoria: CategoriaSolicitacaoTitular.CORRECAO },
      idempotencyKey,
    );

    expect(prisma.solicitacaoTitular.findFirst.mock.calls).toEqual([
      [
        expect.objectContaining({
          where: { titularId: 42, chaveIdempotencia: idempotencyKey },
        }),
      ],
      [
        expect.objectContaining({
          where: { titularId: 43, chaveIdempotencia: idempotencyKey },
        }),
      ],
    ]);
    expect(secondResult.id).toBe(22);
  });

  it('lists only the authenticated owner records and returns a bounded cursor', async () => {
    prisma.solicitacaoTitular.findMany.mockResolvedValue([
      requestRecord({ id: 22 }),
      requestRecord({ id: 21 }),
    ]);

    const result = await service.findMine(42, { limit: 1 });

    expect(prisma.solicitacaoTitular.findMany).toHaveBeenCalledWith({
      where: { titularId: 42 },
      orderBy: [{ dataCriacao: 'desc' }, { id: 'desc' }],
      take: 2,
      select: {
        id: true,
        categoria: true,
        status: true,
        dataCriacao: true,
      },
    });
    expect(result.solicitacoes).toHaveLength(1);
    expect(result.proximoCursor).toBe(22);
    expect(JSON.stringify(result)).not.toContain('chaveIdempotencia');
  });

  it('rejects a cursor belonging to another owner without listing requests', async () => {
    prisma.solicitacaoTitular.findFirst.mockResolvedValue(null);

    await expect(service.findMine(42, { cursor: 99 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.solicitacaoTitular.findFirst).toHaveBeenCalledWith({
      where: { id: 99, titularId: 42 },
      select: { id: true, dataCriacao: true },
    });
    expect(prisma.solicitacaoTitular.findMany).not.toHaveBeenCalled();
  });

  it('uses the default page size when no limit is provided', async () => {
    prisma.solicitacaoTitular.findMany.mockResolvedValue([]);

    await service.findMine(42, {});

    expect(prisma.solicitacaoTitular.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 21, where: { titularId: 42 } }),
    );
  });
});
