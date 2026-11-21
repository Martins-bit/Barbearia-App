import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import {
  PersonalDataExportCancelledError,
  UsersService,
} from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma } from '../generated/prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { TemporaryExportFile } from './temporary-export-storage.service';
import {
  TemporaryExportCleanupError,
  TemporaryExportStorageService,
} from './temporary-export-storage.service';

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

function exportUserFixture(userId = 21) {
  const date = new Date('2026-01-02T03:04:05.000Z');
  return {
    id: userId,
    nome: 'Cliente',
    telefone: '11999999999',
    email: null,
    emailVerificadoEm: null,
    emailConfirmacaoObrigatoria: false,
    tipoUsuario: 'CLIENTE',
    ativo: true,
    dataCriacao: date,
    dataAtualizacao: date,
    cliente: {
      id: userId + 10,
      dataCriacao: date,
      dataAtualizacao: date,
    },
    barbeiro: null,
  };
}

async function readExportJson(file: TemporaryExportFile): Promise<any> {
  const stream = await file.openReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('UsersService', () => {
  let service: UsersService;
  let moduleRef: { get: jest.Mock };
  let sessionRevoker: { revokeUserSessions: jest.Mock };
  let temporaryStorage: { create: jest.Mock };
  let createdFile: (TemporaryExportFile & { chunks: Buffer[] }) | undefined;
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
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
    solicitacaoTitular: { findMany: jest.Mock };
    waitlistClaim: { findMany: jest.Mock };
    horarioFuncionamento: { findMany: jest.Mock };
    bloqueioAgenda: { findMany: jest.Mock };
    emergencia: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    sessionRevoker = { revokeUserSessions: jest.fn() };
    moduleRef = { get: jest.fn().mockReturnValue(sessionRevoker) };
    createdFile = undefined;
    temporaryStorage = {
      create: jest.fn(async (signal?: AbortSignal) => {
        const chunks: Buffer[] = [];
        let finalized = false;
        const file = {
          get sizeBytes() {
            return chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
          },
          chunks,
          write: jest.fn(async (chunk: Uint8Array) => {
            if (signal?.aborted) {
              throw new Error('cancelled');
            }
            chunks.push(Buffer.from(chunk));
          }),
          finalize: jest.fn(async () => {
            finalized = true;
          }),
          openReadStream: jest.fn(async () => {
            if (!finalized) {
              throw new Error('not finalized');
            }
            return Readable.from(chunks);
          }),
          cancel: jest.fn(async () => undefined),
          dispose: jest.fn(async () => undefined),
        };
        createdFile = file;
        return file;
      }),
    };
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
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
      solicitacaoTitular: { findMany: jest.fn().mockResolvedValue([]) },
      waitlistClaim: { findMany: jest.fn().mockResolvedValue([]) },
      horarioFuncionamento: { findMany: jest.fn().mockResolvedValue([]) },
      bloqueioAgenda: { findMany: jest.fn().mockResolvedValue([]) },
      emergencia: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: TemporaryExportStorageService,
          useValue: temporaryStorage,
        },
        { provide: ModuleRef, useValue: moduleRef },
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
    prisma.solicitacaoTitular.findMany.mockResolvedValue([
      {
        titularId: 21,
        chaveIdempotencia: '9c1e39b2-e675-4e29-a0de-4e4c15c3b64c',
        categoria: 'CORRECAO',
        status: 'RECEBIDA',
        dataCriacao: createdAt,
      },
    ]);

    const result = await readExportJson(await service.exportPersonalData(21));

    expect(prisma.usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 21 } }),
    );
    expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ clienteId: 31 }] } }),
    );
    expect(
      prisma.agendamento.findMany.mock.calls[0][0].select,
    ).not.toHaveProperty('observacoes');
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
    expect(
      prisma.notificacao.findMany.mock.calls[0][0].select,
    ).not.toHaveProperty('mensagem');
    expect(prisma.solicitacaoTitular.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { titularId: 21 },
        select: expect.objectContaining({
          categoria: true,
          status: true,
          dataCriacao: true,
        }),
      }),
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
    expect(result.solicitacoes).toEqual([
      {
        categoria: 'CORRECAO',
        status: 'RECEBIDA',
        dataCriacao: createdAt.toISOString(),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(
      'texto que não deve ser exportado',
    );
    expect(JSON.stringify(result)).not.toContain('terceiro@example.com');
    expect(JSON.stringify(result)).not.toContain('Detalhe privado de terceiro');
    expect(JSON.stringify(result)).not.toContain('secret-password-hash');
    expect(JSON.stringify(result)).not.toContain('authVersion');
    expect(JSON.stringify(result)).not.toContain('senhaHash');
    expect(JSON.stringify(result)).not.toContain('tokenHash');
    expect(JSON.stringify(result)).not.toContain('chaveIdempotencia');
    expect(JSON.stringify(result)).not.toContain(
      '9c1e39b2-e675-4e29-a0de-4e4c15c3b64c',
    );
  });

  it('should not export any data when the authenticated account no longer exists', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null);

    await expect(service.exportPersonalData(404)).rejects.toThrow(
      'Usuário não encontrado.',
    );
    expect(prisma.agendamento.findMany).not.toHaveBeenCalled();
    expect(prisma.listaEspera.findMany).not.toHaveBeenCalled();
  });

  it('does not continue the export after cancellation during data queries', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    prisma.usuario.findUnique.mockResolvedValue({
      id: 21,
      nome: 'Cliente',
      telefone: '11999999999',
      email: null,
      emailVerificadoEm: null,
      emailConfirmacaoObrigatoria: false,
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

    let resolveAppointments!: (value: never[]) => void;
    prisma.agendamento.findMany.mockReturnValue(
      new Promise((resolve) => {
        resolveAppointments = resolve;
      }),
    );

    const cancellation = new AbortController();
    const exportPromise = service.exportPersonalData(21, cancellation.signal);
    await Promise.resolve();
    cancellation.abort();
    resolveAppointments([]);

    await expect(exportPromise).rejects.toBeInstanceOf(
      PersonalDataExportCancelledError,
    );
  });

  it('uses one RepeatableRead transaction client for every export query', async () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    const tx = {
      usuario: {
        findUnique: jest.fn().mockResolvedValue({
          ...exportUserFixture(27),
          cliente: null,
          barbeiro: {
            id: 37,
            ativo: true,
            dataCriacao: date,
            dataAtualizacao: date,
          },
        }),
      },
      agendamento: { findMany: jest.fn().mockResolvedValue([]) },
      listaEspera: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 57,
            dataDesejada: date,
            horaInicio: null,
            horaFim: null,
            status: 'ATIVA',
            dataEntrada: date,
            dataAtualizacao: date,
            servico: { nome: 'Corte' },
          },
        ]),
      },
      waitlistClaim: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 67,
            data: date,
            horaInicio: '07:00',
            horaFim: '07:30',
            status: 'ATIVO',
            expiraEm: date,
            dataCriacao: date,
          },
        ]),
      },
      mensagem: { findMany: jest.fn().mockResolvedValue([]) },
      notificacao: { findMany: jest.fn().mockResolvedValue([]) },
      solicitacaoTitular: { findMany: jest.fn().mockResolvedValue([]) },
      horarioFuncionamento: { findMany: jest.fn().mockResolvedValue([]) },
      bloqueioAgenda: { findMany: jest.fn().mockResolvedValue([]) },
      emergencia: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma.$transaction.mockImplementation((callback, options) => {
      expect(options).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 60_000,
      });
      return callback(tx);
    });

    const result = await readExportJson(await service.exportPersonalData(27));

    expect(tx.usuario.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.agendamento.findMany).toHaveBeenCalled();
    expect(tx.listaEspera.findMany).toHaveBeenCalled();
    expect(tx.waitlistClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { listaEsperaId: 57 } }),
    );
    expect(tx.mensagem.findMany).toHaveBeenCalled();
    expect(tx.notificacao.findMany).toHaveBeenCalled();
    expect(tx.solicitacaoTitular.findMany).toHaveBeenCalled();
    expect(tx.horarioFuncionamento.findMany).toHaveBeenCalled();
    expect(tx.bloqueioAgenda.findMany).toHaveBeenCalled();
    expect(tx.emergencia.findMany).toHaveBeenCalled();
    for (const findMany of [
      prisma.agendamento.findMany,
      prisma.listaEspera.findMany,
      prisma.waitlistClaim.findMany,
      prisma.mensagem.findMany,
      prisma.notificacao.findMany,
      prisma.solicitacaoTitular.findMany,
      prisma.horarioFuncionamento.findMany,
      prisma.bloqueioAgenda.findMany,
      prisma.emergencia.findMany,
    ]) {
      expect(findMany).not.toHaveBeenCalled();
    }
    for (const findMany of [
      tx.agendamento.findMany,
      tx.listaEspera.findMany,
      tx.waitlistClaim.findMany,
      tx.mensagem.findMany,
      tx.notificacao.findMany,
      tx.solicitacaoTitular.findMany,
      tx.horarioFuncionamento.findMany,
      tx.bloqueioAgenda.findMany,
      tx.emergencia.findMany,
    ]) {
      expect(findMany.mock.calls[0][0].take).toBe(100);
      expect(findMany.mock.calls[0][0].skip).toBeUndefined();
    }
    expect(tx.horarioFuncionamento.findMany.mock.calls[0][0].where).toEqual({
      barbeiroId: 37,
    });
    expect(tx.bloqueioAgenda.findMany.mock.calls[0][0].where).toEqual({
      barbeiroId: 37,
    });
    expect(tx.emergencia.findMany.mock.calls[0][0].where).toEqual({
      barbeiroId: 37,
    });
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(result.listaEspera[0].claims).toHaveLength(1);
  });

  it('exports a customer profile with valid empty collections', async () => {
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture(27));

    const result = await readExportJson(await service.exportPersonalData(27));

    expect(result.conta.perfil).toEqual({
      criadoEm: '2026-01-02T03:04:05.000Z',
      atualizadoEm: '2026-01-02T03:04:05.000Z',
    });
    expect(result.agendamentos).toEqual([]);
    expect(result.listaEspera).toEqual([]);
    expect(result.mensagens).toEqual({
      conteudoIncluido: false,
      registros: [],
    });
    expect(result.notificacoes).toEqual([]);
    expect(result.solicitacoes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('undefined');
  });

  it('writes valid JSON progressively across pages without exposing internal IDs', async () => {
    const date = new Date('2026-03-04T00:00:00.000Z');
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      data: date,
      horaInicio: new Date(
        new Date('2026-03-04T10:00:00.000Z').getTime() + index * 60_000,
      ),
      horaFim: new Date(
        new Date('2026-03-04T10:30:00.000Z').getTime() + index * 60_000,
      ),
      status: 'CONCLUIDO',
      dataCriacao: new Date(date.getTime() + index),
      dataAtualizacao: date,
      servico: { nome: 'Corte', duracaoMinutos: 30 },
    }));
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    prisma.agendamento.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        {
          ...firstPage[99],
          id: 101,
          horaInicio: new Date('2026-03-04T11:40:00.000Z'),
          horaFim: new Date('2026-03-04T12:10:00.000Z'),
          dataCriacao: new Date(date.getTime() + 100),
        },
      ]);

    const file = await service.exportPersonalDataToTemporaryFile(21);
    const json = Buffer.concat(createdFile!.chunks).toString('utf8');
    const result = JSON.parse(json) as {
      formato: string;
      agendamentos: unknown[];
      listaEspera: unknown[];
      solicitacoes: unknown[];
    };

    expect(temporaryStorage.create).toHaveBeenCalledTimes(1);
    expect(createdFile!.write.mock.calls.length).toBeGreaterThan(10);
    expect(file.sizeBytes).toBe(Buffer.byteLength(json));
    expect(result.formato).toBe('Barbearia-App personal data v1');
    expect(result.agendamentos).toHaveLength(101);
    expect(
      new Set(result.agendamentos.map(({ horaInicio }) => horaInicio)).size,
    ).toBe(101);
    expect(result.listaEspera).toEqual([]);
    expect(result.solicitacoes).toEqual([]);
    expect(json).not.toContain('"id"');
    expect(createdFile!.finalize).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60_000,
    });
  });

  it('generates, finalizes, and rereads a complete JSON file using real storage', async () => {
    const rootDirectory = await mkdtemp(
      join(tmpdir(), 'barbearia-export-service-integration-'),
    );
    const realStorage = new TemporaryExportStorageService({
      rootDirectory,
      maxFileSizeBytes: 1024 * 1024,
      maxTotalSizeBytes: 2 * 1024 * 1024,
    });
    let exportFile: TemporaryExportFile | undefined;

    try {
      await realStorage.onModuleInit();
      prisma.usuario.findUnique.mockResolvedValue(exportUserFixture(27));
      prisma.agendamento.findMany.mockResolvedValue([
        {
          id: 101,
          data: new Date('2026-03-04T00:00:00.000Z'),
          horaInicio: new Date('2026-03-04T10:00:00.000Z'),
          horaFim: new Date('2026-03-04T10:30:00.000Z'),
          status: 'CONCLUIDO',
          dataCriacao: new Date('2026-03-04T11:00:00.000Z'),
          dataAtualizacao: new Date('2026-03-04T11:30:00.000Z'),
          servico: { nome: 'Corte', duracaoMinutos: 30 },
        },
      ]);

      const realService = new UsersService(
        prisma as unknown as PrismaService,
        realStorage,
        moduleRef as unknown as ModuleRef,
      );
      exportFile = await realService.exportPersonalDataToTemporaryFile(27);
      const result = await readExportJson(exportFile);

      expect(exportFile.sizeBytes).toBeGreaterThan(0);
      expect(result).toMatchObject({
        formato: 'Barbearia-App personal data v1',
        conta: { nome: 'Cliente', perfil: expect.any(Object) },
        agendamentos: [
          {
            data: '2026-03-04',
            horaInicio: '07:00',
            horaFim: '07:30',
            status: 'CONCLUIDO',
            servico: { nome: 'Corte', duracaoMinutos: 30 },
          },
        ],
        listaEspera: [],
        mensagens: { conteudoIncluido: false, registros: [] },
        notificacoes: [],
        solicitacoes: [],
      });
    } finally {
      await exportFile?.dispose();
      await realStorage.onModuleDestroy();
      await rm(rootDirectory, { recursive: true, force: true });
    }
  });

  it('cancels the partial file and does not start another page after cancellation', async () => {
    const cancellation = new AbortController();
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      data: new Date('2026-03-04T00:00:00.000Z'),
      horaInicio: new Date('2026-03-04T10:00:00.000Z'),
      horaFim: new Date('2026-03-04T10:30:00.000Z'),
      status: 'CONCLUIDO',
      dataCriacao: new Date('2026-03-04T00:00:00.000Z'),
      dataAtualizacao: new Date('2026-03-04T00:00:00.000Z'),
      servico: { nome: 'Corte', duracaoMinutos: 30 },
    }));
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    prisma.agendamento.findMany.mockImplementationOnce(() => {
      cancellation.abort();
      return Promise.resolve(firstPage);
    });

    await expect(
      service.exportPersonalDataToTemporaryFile(21, cancellation.signal),
    ).rejects.toBeInstanceOf(PersonalDataExportCancelledError);
    expect(prisma.agendamento.findMany).toHaveBeenCalledTimes(1);
    expect(createdFile!.finalize).not.toHaveBeenCalled();
    expect(createdFile!.cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the partial file when a write fails', async () => {
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    temporaryStorage.create.mockImplementationOnce(async () => {
      const file = {
        sizeBytes: 0,
        write: jest.fn().mockRejectedValue(new Error('disk full')),
        finalize: jest.fn(),
        openReadStream: jest.fn(),
        cancel: jest.fn().mockResolvedValue(undefined),
        dispose: jest.fn(),
      };
      createdFile = file as typeof createdFile;
      return file;
    });

    await expect(service.exportPersonalDataToTemporaryFile(21)).rejects.toThrow(
      'disk full',
    );
    expect(createdFile!.finalize).not.toHaveBeenCalled();
    expect(createdFile!.cancel).toHaveBeenCalledTimes(1);
  });

  it('preserves both generation and cleanup errors when cancellation also fails', async () => {
    const writeError = new Error('disk full');
    const cleanupError = new Error('cleanup denied');
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    temporaryStorage.create.mockImplementationOnce(async () => {
      const file = {
        sizeBytes: 0,
        write: jest.fn().mockRejectedValue(writeError),
        finalize: jest.fn(),
        openReadStream: jest.fn(),
        cancel: jest.fn().mockRejectedValue(cleanupError),
        dispose: jest.fn(),
      };
      createdFile = file as typeof createdFile;
      return file;
    });

    let thrown: unknown;
    try {
      await service.exportPersonalDataToTemporaryFile(21);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TemporaryExportCleanupError);
    if (thrown instanceof TemporaryExportCleanupError) {
      expect(thrown.errors).toEqual([writeError, cleanupError]);
    }
    expect(createdFile!.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not expose the file if finalization fails after the transaction', async () => {
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    temporaryStorage.create.mockImplementationOnce(async () => {
      const file = {
        sizeBytes: 0,
        write: jest.fn().mockResolvedValue(undefined),
        finalize: jest.fn().mockRejectedValue(new Error('finalize failed')),
        openReadStream: jest.fn(),
        cancel: jest.fn().mockResolvedValue(undefined),
        dispose: jest.fn(),
      };
      createdFile = file as typeof createdFile;
      return file;
    });

    await expect(service.exportPersonalDataToTemporaryFile(21)).rejects.toThrow(
      'finalize failed',
    );
    expect(createdFile!.openReadStream).not.toHaveBeenCalled();
    expect(createdFile!.cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the partial file when the interactive transaction times out', async () => {
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    prisma.$transaction.mockRejectedValueOnce(new Error('transaction timeout'));

    await expect(service.exportPersonalDataToTemporaryFile(21)).rejects.toThrow(
      'transaction timeout',
    );
    expect(createdFile!.finalize).not.toHaveBeenCalled();
    expect(createdFile!.cancel).toHaveBeenCalledTimes(1);
  });

  it('finalizes the file only after the transaction has committed', async () => {
    const lifecycle: string[] = [];
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    prisma.$transaction.mockImplementation(async (callback, options) => {
      expect(options).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 60_000,
      });
      await callback(prisma);
      lifecycle.push('committed');
      return undefined;
    });
    temporaryStorage.create.mockImplementationOnce(async () => {
      const file = {
        sizeBytes: 0,
        write: jest.fn().mockResolvedValue(undefined),
        finalize: jest.fn(async () => {
          lifecycle.push('finalized');
        }),
        openReadStream: jest.fn(),
        cancel: jest.fn().mockResolvedValue(undefined),
        dispose: jest.fn(),
      };
      createdFile = file as typeof createdFile;
      return file;
    });

    await service.exportPersonalDataToTemporaryFile(21);

    expect(lifecycle).toEqual(['committed', 'finalized']);
  });

  it('waits for each file write before starting the next write', async () => {
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    const firstWrite = deferred<void>();
    const firstWriteStarted = deferred<void>();
    let writeCount = 0;
    temporaryStorage.create.mockImplementationOnce(async () => {
      const file = {
        sizeBytes: 0,
        write: jest.fn(() => {
          writeCount += 1;
          if (writeCount === 1) {
            firstWriteStarted.resolve();
          }
          return writeCount === 1
            ? firstWrite.promise
            : Promise.resolve(undefined);
        }),
        finalize: jest.fn().mockResolvedValue(undefined),
        openReadStream: jest.fn(),
        cancel: jest.fn().mockResolvedValue(undefined),
        dispose: jest.fn(),
      };
      createdFile = file as typeof createdFile;
      return file;
    });

    const exportPromise = service.exportPersonalDataToTemporaryFile(21);
    await firstWriteStarted.promise;
    expect(writeCount).toBe(1);
    firstWrite.resolve();
    await exportPromise;
    expect(writeCount).toBeGreaterThan(1);
  });

  it('uses keyset pages with an ID tie-breaker and no growing offset', async () => {
    const date = new Date('2026-03-04T00:00:00.000Z');
    const horaInicio = new Date('2026-03-04T10:00:00.000Z');
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      data: date,
      horaInicio,
      horaFim: new Date('2026-03-04T10:30:00.000Z'),
      status: 'CONCLUIDO',
      dataCriacao: new Date(date.getTime() + index),
      dataAtualizacao: date,
      servico: { nome: 'Corte', duracaoMinutos: 30 },
    }));
    const lastRecord = {
      ...firstPage[99],
      id: 101,
      dataCriacao: new Date(date.getTime() + 100),
    };
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    prisma.agendamento.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([lastRecord]);

    const result = await readExportJson(await service.exportPersonalData(21));
    const calls = prisma.agendamento.findMany.mock.calls;

    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({
      take: 100,
      orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }, { id: 'asc' }],
    });
    expect(calls[1][0].skip).toBeUndefined();
    expect(calls[1][0].take).toBe(100);
    expect(calls[1][0].where.AND[1].OR).toEqual([
      { data: { gt: date } },
      { data: date, horaInicio: { gt: horaInicio } },
      { data: date, horaInicio, id: { gt: 100 } },
    ]);
    expect(result.agendamentos).toHaveLength(101);
    expect(
      new Set(result.agendamentos.map(({ criadoEm }) => criadoEm)).size,
    ).toBe(101);
    expect(JSON.stringify(result)).not.toContain('"id"');
  });

  it('paginates waitlist claims by creation date and ID within their parent list', async () => {
    const date = new Date('2026-03-04T00:00:00.000Z');
    const entry = {
      id: 58,
      dataDesejada: date,
      horaInicio: null,
      horaFim: null,
      status: 'ATIVA',
      dataEntrada: date,
      dataAtualizacao: date,
      servico: { nome: 'Corte' },
    };
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      data: date,
      horaInicio: '10:00',
      horaFim: '10:30',
      status: 'ATIVO',
      expiraEm: date,
      dataCriacao: new Date(date.getTime() + index),
    }));
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    prisma.listaEspera.findMany.mockResolvedValue([entry]);
    prisma.waitlistClaim.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        {
          ...firstPage[99],
          id: 101,
          dataCriacao: new Date(date.getTime() + 100),
        },
      ]);

    const result = await readExportJson(await service.exportPersonalData(21));
    const calls = prisma.waitlistClaim.findMany.mock.calls;

    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({
      where: { listaEsperaId: 58 },
      orderBy: [{ dataCriacao: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    const lastPageCreatedAt = new Date(date.getTime() + 99);
    expect(calls[1][0].where).toMatchObject({
      listaEsperaId: 58,
      OR: [
        { dataCriacao: { gt: lastPageCreatedAt } },
        { dataCriacao: lastPageCreatedAt, id: { gt: 100 } },
      ],
    });
    expect(calls[1][0].skip).toBeUndefined();
    expect(result.listaEspera[0].claims).toHaveLength(101);
    expect(JSON.stringify(result)).not.toContain('"id"');
  });

  it('checks cancellation between pages before starting another query', async () => {
    const cancellation = new AbortController();
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      data: new Date('2026-03-04T00:00:00.000Z'),
      horaInicio: new Date('2026-03-04T10:00:00.000Z'),
      horaFim: new Date('2026-03-04T10:30:00.000Z'),
      status: 'CONCLUIDO',
      dataCriacao: new Date('2026-03-04T00:00:00.000Z'),
      dataAtualizacao: new Date('2026-03-04T00:00:00.000Z'),
      servico: { nome: 'Corte', duracaoMinutos: 30 },
    }));
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    prisma.agendamento.findMany.mockImplementationOnce(() => {
      cancellation.abort();
      return Promise.resolve(firstPage);
    });

    await expect(
      service.exportPersonalData(21, cancellation.signal),
    ).rejects.toBeInstanceOf(PersonalDataExportCancelledError);
    expect(prisma.agendamento.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.mensagem.findMany).not.toHaveBeenCalled();
  });

  it('does not open a transaction when already cancelled', async () => {
    const cancellation = new AbortController();
    cancellation.abort();

    await expect(
      service.exportPersonalData(21, cancellation.signal),
    ).rejects.toBeInstanceOf(PersonalDataExportCancelledError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('propagates query failures from the transaction without returning partial data', async () => {
    const failure = new Error('query failed');
    prisma.usuario.findUnique.mockResolvedValue(exportUserFixture());
    prisma.agendamento.findMany.mockRejectedValue(failure);

    await expect(service.exportPersonalData(21)).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.mensagem.findMany).not.toHaveBeenCalled();
    expect(prisma.notificacao.findMany).not.toHaveBeenCalled();
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
      },
    });
    prisma.bloqueioAgenda.findMany.mockResolvedValue([
      {
        id: 51,
        data: date,
        horaInicio: new Date('2026-03-04T10:00:00.000Z'),
        horaFim: new Date('2026-03-04T11:00:00.000Z'),
        motivo: 'Pessoa de terceiro - 11999999999',
        ativo: true,
        dataCriacao: date,
      },
    ]);
    prisma.emergencia.findMany.mockResolvedValue([
      {
        id: 52,
        dataInicio: date,
        dataFim: date,
        motivo: 'Detalhe de terceiro',
        status: 'ATIVA',
        dataCriacao: date,
      },
    ]);
    prisma.horarioFuncionamento.findMany.mockResolvedValue([
      {
        id: 53,
        diaSemana: 'SEGUNDA',
        horaInicio: '09:00',
        horaFim: '18:00',
        ativo: true,
      },
    ]);

    const result = await readExportJson(await service.exportPersonalData(22));

    expect(prisma.agendamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ barbeiroId: 32 }] } }),
    );
    expect(prisma.listaEspera.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ barbeiroId: 32 }] } }),
    );
    expect(result.conta.perfil).toMatchObject({
      ativo: true,
      horarios: [
        {
          diaSemana: 'SEGUNDA',
          horaInicio: '09:00',
          horaFim: '18:00',
          ativo: true,
        },
      ],
      bloqueios: [{ ativo: true }],
      emergencias: [{ status: 'ATIVA' }],
    });
    expect(Array.isArray(result.agendamentos)).toBe(true);
    expect(Array.isArray(result.listaEspera)).toBe(true);
    expect(Array.isArray(result.notificacoes)).toBe(true);
    expect(result.conta.perfil).not.toHaveProperty('usuarioId');
    expect(JSON.stringify(result)).not.toContain('11999999999');
    expect(JSON.stringify(result)).not.toContain('Detalhe de terceiro');
    const barberSelect =
      prisma.usuario.findUnique.mock.calls[0][0].select.barbeiro.select;
    expect(barberSelect).not.toHaveProperty('horarios');
    expect(
      prisma.bloqueioAgenda.findMany.mock.calls[0][0].select,
    ).not.toHaveProperty('motivo');
    expect(
      prisma.emergencia.findMany.mock.calls[0][0].select,
    ).not.toHaveProperty('motivo');
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
      buildP2002(
        buildDriverAdapterCause('Unique constraint Usuario_email_key'),
      ),
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
        authVersion: { increment: 1 },
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
    expect(sessionRevoker.revokeUserSessions).toHaveBeenCalledWith(1);
    expect(result).not.toHaveProperty('senhaHash');
    expect(result.nome).toBe('João Atualizado');
  });

  it.each<[string, Partial<UpdateUserDto>]>([
    ['name', { nome: 'João Atualizado' }],
    ['phone', { telefone: '11999999998' }],
  ])(
    'does not revoke sessions when only the %s changes',
    async (_, updates) => {
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
        ...updates,
        telefone: updates.telefone ?? '11999999999',
        email: 'joao@email.com',
        senhaHash: 'hash-secreta',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      });

      await service.updateUser(1, updates);

      const updateData = prisma.usuario.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('authVersion');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.emailVerificationToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(sessionRevoker.revokeUserSessions).not.toHaveBeenCalled();
    },
  );

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
            authVersion: { increment: 1 },
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
      expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 13 },
          data: { email: 'Meu@Email.com' },
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(sessionRevoker.revokeUserSessions).not.toHaveBeenCalled();
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

  describe('updateUser — concorrência e revogação WebSocket', () => {
    const existingUser = {
      id: 30,
      nome: 'Cliente',
      telefone: '11999990030',
      email: 'cliente@email.com',
      authVersion: 0,
      senhaHash: 'hash',
      tipoUsuario: 'CLIENTE',
      ativo: true,
      dataCriacao: new Date(),
      dataAtualizacao: new Date(),
    };

    it('serializes competing email changes and rejects the stale request', async () => {
      let currentUser = { ...existingUser };
      let reads = 0;
      let transactionTail: Promise<unknown> = Promise.resolve();

      prisma.usuario.findUnique.mockImplementation(async () => {
        reads += 1;
        return reads <= 2 ? { ...existingUser } : { ...currentUser };
      });
      prisma.usuario.findFirst.mockResolvedValue(null);
      prisma.usuario.update.mockImplementation(async ({ data }) => {
        currentUser = {
          ...currentUser,
          ...data,
          authVersion:
            currentUser.authVersion + (data.authVersion?.increment ?? 0),
        };
        return { ...currentUser };
      });
      prisma.$transaction.mockImplementation((callback) => {
        const transaction = transactionTail.then(() => callback(prisma));
        transactionTail = transaction.then(
          () => undefined,
          () => undefined,
        );
        return transaction;
      });

      const outcomes = await Promise.allSettled([
        service.updateUser(30, { email: 'primeiro@email.com' }),
        service.updateUser(30, { email: 'segundo@email.com' }),
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = outcomes.find(
        (outcome) => outcome.status === 'rejected',
      );
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: expect.any(ConflictException),
      });
      expect(currentUser.email).not.toBe('cliente@email.com');
      expect(currentUser.authVersion).toBe(1);
      expect(sessionRevoker.revokeUserSessions).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prisma.usuario.update).toHaveBeenCalledTimes(1);
    });

    it('rejects an update admitted with a JWT version made stale before service execution', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        ...existingUser,
        email: 'concorrente@email.com',
        authVersion: 1,
      });

      await expect(
        service.updateUser(30, { email: 'cliente@email.com' }, 0),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(sessionRevoker.revokeUserSessions).not.toHaveBeenCalled();
    });

    it('revokes sockets only after the email transaction commits', async () => {
      let transactionCommitted = false;
      prisma.usuario.findUnique.mockResolvedValue(existingUser);
      prisma.usuario.findFirst.mockResolvedValue(null);
      prisma.usuario.update.mockResolvedValue({
        ...existingUser,
        email: 'novo@email.com',
        authVersion: 1,
      });
      prisma.$transaction.mockImplementation(async (callback) => {
        const result = await callback(prisma);
        transactionCommitted = true;
        return result;
      });
      sessionRevoker.revokeUserSessions.mockImplementation(() => {
        expect(transactionCommitted).toBe(true);
      });

      await service.updateUser(30, { email: 'novo@email.com' }, 0);

      expect(sessionRevoker.revokeUserSessions).toHaveBeenCalledWith(30);
    });

    it('does not revoke sockets when the email transaction fails', async () => {
      const transactionError = new Error('transaction failed');
      let persistedUser = { ...existingUser };
      let stagedUser = { ...existingUser };
      const transactionalPrisma = {
        ...prisma,
        usuario: {
          ...prisma.usuario,
          findUnique: jest.fn().mockImplementation(async () => ({
            ...stagedUser,
          })),
          update: jest.fn().mockImplementation(async ({ data }) => {
            stagedUser = {
              ...stagedUser,
              ...data,
              authVersion:
                stagedUser.authVersion + (data.authVersion?.increment ?? 0),
            };
            return { ...stagedUser };
          }),
        },
        passwordResetToken: {
          ...prisma.passwordResetToken,
          updateMany: jest.fn().mockRejectedValue(transactionError),
        },
      };
      prisma.usuario.findUnique.mockResolvedValue(existingUser);
      prisma.usuario.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (callback) => {
        const result = await callback(transactionalPrisma);
        persistedUser = { ...stagedUser };
        return result;
      });

      await expect(
        service.updateUser(30, { email: 'novo@email.com' }, 0),
      ).rejects.toBe(transactionError);

      expect(persistedUser).toMatchObject({
        email: 'cliente@email.com',
        authVersion: 0,
      });
      expect(stagedUser).toMatchObject({
        email: 'novo@email.com',
        authVersion: 1,
      });
      expect(sessionRevoker.revokeUserSessions).not.toHaveBeenCalled();
    });
  });
});
