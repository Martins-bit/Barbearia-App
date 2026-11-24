import {
  ConflictException,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { TipoUsuario } from '../generated/prisma/enums';
import { ThrottlerModule } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { Request, Response } from 'express';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrivacyRequestsService } from './privacy-requests/privacy-requests.service';
import { CategoriaSolicitacaoTitular } from '../generated/prisma/enums';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  UserExportLockService,
  type UserExportLock,
  type UserExportLockAcquisition,
} from '../common/redis/user-export-lock.service';
import type { TemporaryExportFile } from './temporary-export-storage.service';
import { PrivateResponseCacheInterceptor } from '../common/http/private-response-cache.interceptor';

jest.mock('../generated/prisma/enums', () => ({
  ...jest.requireActual('../generated/prisma/enums'),
  CategoriaSolicitacaoTitular: {
    ACESSO: 'ACESSO',
    CORRECAO: 'CORRECAO',
    EXCLUSAO: 'EXCLUSAO',
    PORTABILIDADE: 'PORTABILIDADE',
    OPOSICAO: 'OPOSICAO',
    INFORMACAO: 'INFORMACAO',
  },
}));

class MockExportResponse extends Writable {
  headersSent = false;
  statusCode = 200;
  readonly headers = new Map<string, string>();
  readonly chunks: Buffer[] = [];
  pauseWrites = false;
  private pendingWrite?: (error?: Error | null) => void;

  constructor() {
    super();
  }

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.headersSent = true;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (this.pauseWrites) {
      this.pendingWrite = callback;
    } else {
      callback();
    }
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  status(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }

  finish(): void {
    this.pauseWrites = false;
    this.pendingWrite?.();
    this.pendingWrite = undefined;
  }

  get body(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function createExportFile(content: string): TemporaryExportFile {
  const buffer = Buffer.from(content, 'utf8');
  return {
    sizeBytes: buffer.byteLength,
    write: jest.fn().mockResolvedValue(undefined),
    finalize: jest.fn().mockResolvedValue(undefined),
    openReadStream: jest.fn(async () => Readable.from([buffer])),
    cancel: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined),
  };
}

function createExportLock(
  acquisition: UserExportLockAcquisition = {
    acquired: true,
    lock: {
      lost: new AbortController().signal,
      renew: jest.fn().mockResolvedValue(undefined),
      stopRenewal: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(true),
    },
  },
) {
  const service = {
    tryAcquire: jest.fn().mockResolvedValue(acquisition),
  } as unknown as UserExportLockService;
  return { service, acquisition };
}

function createHttpMocks() {
  return {
    request: new EventEmitter() as unknown as Request,
    response: new MockExportResponse() as unknown as Response,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('UsersController', () => {
  const exportHandler = UsersController.prototype.exportMe;
  const createRequestHandler = UsersController.prototype.createPrivacyRequest;
  const listRequestsHandler = UsersController.prototype.findMyPrivacyRequests;

  function createPrivacyRequestsService() {
    return {
      create: jest.fn(),
      findMine: jest.fn(),
    } as unknown as PrivacyRequestsService;
  }

  it('exports data for the authenticated user id supplied by CurrentUser', async () => {
    const exportData = {
      formato: 'Barbearia-App personal data v1' as const,
      geradoEm: new Date().toISOString(),
    };
    const usersService = {
      exportPersonalDataToTemporaryFile: jest
        .fn()
        .mockResolvedValue(createExportFile(JSON.stringify(exportData))),
    } as unknown as UsersService;
    const exportLock = createExportLock();
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();

    await expect(controller.exportMe(42, request, response)).resolves.toBe(
      undefined,
    );
    expect(exportLock.service.tryAcquire).toHaveBeenCalledWith(42, {
      ttlMs: 60_000,
    });
    expect(usersService.exportPersonalDataToTemporaryFile).toHaveBeenCalledWith(
      42,
      expect.any(AbortSignal),
    );
    expect(
      JSON.parse((response as unknown as MockExportResponse).body),
    ).toEqual(exportData);
    expect(
      (response as unknown as MockExportResponse).headers.get('content-type'),
    ).toBe('application/json; charset=utf-8');
    expect(
      (response as unknown as MockExportResponse).headers.get('content-length'),
    ).toBe(String(Buffer.byteLength(JSON.stringify(exportData))));
    expect(exportLock.acquisition.acquired).toBe(true);
    if (exportLock.acquisition.acquired) {
      expect(exportLock.acquisition.lock.release).toHaveBeenCalledTimes(1);
    }
  });

  it('returns conflict without generating data when the titular lock is busy', async () => {
    const exportLock = createExportLock({ acquired: false, reason: 'LOCKED' });
    const usersService = {
      exportPersonalDataToTemporaryFile: jest.fn(),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();

    await expect(
      controller.exportMe(42, request, response),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      usersService.exportPersonalDataToTemporaryFile,
    ).not.toHaveBeenCalled();
  });

  it('fails closed when Redis acquisition is unavailable', async () => {
    const exportLock = createExportLock();
    jest
      .spyOn(exportLock.service, 'tryAcquire')
      .mockRejectedValue(new Error('Redis unavailable'));
    const usersService = {
      exportPersonalDataToTemporaryFile: jest.fn(),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();

    await expect(
      controller.exportMe(42, request, response),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(
      usersService.exportPersonalDataToTemporaryFile,
    ).not.toHaveBeenCalled();
  });

  it('retains the lock until the HTTP response finishes and releases it once', async () => {
    const exportLock = createExportLock();
    const usersService = {
      exportPersonalDataToTemporaryFile: jest
        .fn()
        .mockResolvedValue(createExportFile('{"formato":"v1"}')),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();
    const mockResponse = response as unknown as MockExportResponse;
    mockResponse.pauseWrites = true;

    const operation = controller.exportMe(42, request, response);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockResponse.body).toEqual('{"formato":"v1"}');
    if (exportLock.acquisition.acquired) {
      expect(exportLock.acquisition.lock.release).not.toHaveBeenCalled();
    }

    mockResponse.finish();
    await operation;

    if (exportLock.acquisition.acquired) {
      expect(exportLock.acquisition.lock.release).toHaveBeenCalledTimes(1);
    }
  });

  it('cancels data generation and returns unavailable if lock ownership is lost', async () => {
    const lostController = new AbortController();
    const lock: UserExportLock = {
      lost: lostController.signal,
      renew: jest.fn().mockResolvedValue(undefined),
      stopRenewal: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(false),
    };
    const exportLock = createExportLock({ acquired: true, lock });
    let exportSignal: AbortSignal | undefined;
    const usersService = {
      exportPersonalDataToTemporaryFile: jest.fn(
        (_userId: number, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            exportSignal = signal;
            signal.addEventListener(
              'abort',
              () => reject(new Error('generation cancelled')),
              { once: true },
            );
          }),
      ),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();

    const operation = controller.exportMe(42, request, response);
    await Promise.resolve();
    lostController.abort(new Error('lease lost'));

    await expect(operation).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(exportSignal?.aborted).toBe(true);
    expect((response as unknown as MockExportResponse).body).toBe('');
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('destroys an in-progress HTTP response if the lock is lost', async () => {
    const lostController = new AbortController();
    const lock: UserExportLock = {
      lost: lostController.signal,
      renew: jest.fn().mockResolvedValue(undefined),
      stopRenewal: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(false),
    };
    const exportLock = createExportLock({ acquired: true, lock });
    const usersService = {
      exportPersonalDataToTemporaryFile: jest
        .fn()
        .mockResolvedValue(createExportFile('{"formato":"v1"}')),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();
    const mockResponse = response as unknown as MockExportResponse;
    mockResponse.pauseWrites = true;

    const operation = controller.exportMe(42, request, response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mockResponse.headersSent).toBe(true);

    lostController.abort(new Error('lease lost'));
    await operation;

    expect(mockResponse.destroyed).toBe(true);
    expect(mockResponse.writableFinished).toBe(false);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('destroys a partial download on stream failure and still cleans up', async () => {
    const exportFile = createExportFile('{}');
    let sent = false;
    exportFile.openReadStream = jest.fn(
      async () =>
        new Readable({
          read() {
            if (sent) {
              return;
            }
            sent = true;
            this.push(Buffer.from('{"partial":'));
            setImmediate(() => this.destroy(new Error('disk read failed')));
          },
        }),
    );
    const usersService = {
      exportPersonalDataToTemporaryFile: jest
        .fn()
        .mockResolvedValue(exportFile),
    } as unknown as UsersService;
    const exportLock = createExportLock();
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();
    const mockResponse = response as unknown as MockExportResponse;

    await expect(controller.exportMe(42, request, response)).resolves.toBe(
      undefined,
    );

    expect(mockResponse.destroyed).toBe(true);
    expect(mockResponse.body).toBe('{"partial":');
    expect(exportFile.dispose).toHaveBeenCalledTimes(1);
    if (exportLock.acquisition.acquired) {
      expect(exportLock.acquisition.lock.release).toHaveBeenCalledTimes(1);
    }
  });

  it('cancels a disconnected download, cleans the file, and then releases the lock', async () => {
    const exportFile = createExportFile('{"large":"file"}');
    const usersService = {
      exportPersonalDataToTemporaryFile: jest
        .fn()
        .mockResolvedValue(exportFile),
    } as unknown as UsersService;
    const exportLock = createExportLock();
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();
    const mockResponse = response as unknown as MockExportResponse;
    mockResponse.pauseWrites = true;

    const operation = controller.exportMe(42, request, response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mockResponse.headersSent).toBe(true);

    mockResponse.destroy();
    await operation;

    expect(exportFile.dispose).toHaveBeenCalledTimes(1);
    if (exportLock.acquisition.acquired) {
      expect(exportLock.acquisition.lock.release).toHaveBeenCalledTimes(1);
    }
  });

  it('stops lock renewal without releasing the lease when file disposal fails', async () => {
    const exportFile = createExportFile('{}');
    exportFile.dispose = jest
      .fn()
      .mockRejectedValue(new Error('cleanup could not be confirmed'));
    const usersService = {
      exportPersonalDataToTemporaryFile: jest
        .fn()
        .mockResolvedValue(exportFile),
    } as unknown as UsersService;
    const lock = createExportLock();
    const lockService = {
      tryAcquire: jest.fn().mockResolvedValue(lock.acquisition),
    } as unknown as UserExportLockService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      lockService,
    );
    const { request, response } = createHttpMocks();

    await controller.exportMe(42, request, response);

    if (!lock.acquisition.acquired) {
      throw new Error('Expected the export lock to be acquired.');
    }
    expect(lock.acquisition.lock.stopRenewal).toHaveBeenCalledTimes(1);
    expect(lock.acquisition.lock.release).not.toHaveBeenCalled();
  });

  it('cancels generation on an interrupted HTTP response and releases the lock', async () => {
    const exportLock = createExportLock();
    let exportSignal: AbortSignal | undefined;
    const usersService = {
      exportPersonalDataToTemporaryFile: jest.fn(
        (_userId: number, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            exportSignal = signal;
            signal.addEventListener(
              'abort',
              () => reject(new Error('generation cancelled')),
              { once: true },
            );
          }),
      ),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();

    const operation = controller.exportMe(42, request, response);
    await Promise.resolve();
    (response as unknown as MockExportResponse).emit('close');
    await operation;

    expect(exportSignal?.aborted).toBe(true);
    expect((response as unknown as MockExportResponse).body).toBe('');
    if (exportLock.acquisition.acquired) {
      expect(exportLock.acquisition.lock.release).toHaveBeenCalledTimes(1);
    }
  });

  it('does not start an export when the request disconnected during lock acquisition', async () => {
    const exportFile = createExportFile('{"data":"private"}');
    let exportSignal: AbortSignal | undefined;
    const usersService = {
      exportPersonalDataToTemporaryFile: jest.fn(
        (_userId: number, signal: AbortSignal) => {
          exportSignal = signal;
          return Promise.resolve(exportFile);
        },
      ),
    } as unknown as UsersService;
    const exportLock = createExportLock();
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();
    Object.assign(request, { aborted: true });

    await controller.exportMe(42, request, response);

    expect(exportSignal?.aborted).toBe(true);
    expect(exportFile.openReadStream).not.toHaveBeenCalled();
    expect(exportFile.dispose).toHaveBeenCalledTimes(1);
    if (exportLock.acquisition.acquired) {
      expect(exportLock.acquisition.lock.release).toHaveBeenCalledTimes(1);
    }
  });

  it('allows different titular locks to run concurrently without interference', async () => {
    const active = new Set<number>();
    const pending = new Map<number, ReturnType<typeof deferred<unknown>>>();
    const lockService = {
      tryAcquire: jest.fn(async (userId: number) => {
        if (active.has(userId)) {
          return { acquired: false as const, reason: 'LOCKED' as const };
        }
        active.add(userId);
        const lock: UserExportLock = {
          lost: new AbortController().signal,
          renew: jest.fn().mockResolvedValue(undefined),
          stopRenewal: jest.fn().mockResolvedValue(undefined),
          release: jest.fn(async () => {
            active.delete(userId);
            return true;
          }),
        };
        return { acquired: true as const, lock };
      }),
    } as unknown as UserExportLockService;
    const usersService = {
      exportPersonalDataToTemporaryFile: jest.fn((userId: number) => {
        const task = deferred<unknown>();
        pending.set(userId, task);
        return task.promise;
      }),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      lockService,
    );
    const firstHttp = createHttpMocks();
    const secondHttp = createHttpMocks();

    const first = controller.exportMe(
      42,
      firstHttp.request,
      firstHttp.response,
    );
    const second = controller.exportMe(
      43,
      secondHttp.request,
      secondHttp.response,
    );
    await Promise.resolve();

    expect(active).toEqual(new Set([42, 43]));
    expect(lockService.tryAcquire).toHaveBeenCalledWith(42, {
      ttlMs: 60_000,
    });
    expect(lockService.tryAcquire).toHaveBeenCalledWith(43, {
      ttlMs: 60_000,
    });
    pending.get(42)!.resolve(createExportFile('{"titular":42}'));
    pending.get(43)!.resolve(createExportFile('{"titular":43}'));
    await Promise.all([first, second]);
    expect(active.size).toBe(0);
  });

  it('returns HTTP 409 for a second simultaneous export by the same JWT user', async () => {
    let app: INestApplication | undefined;
    const activeUsers = new Set<number>();
    const exportStarted = deferred<void>();
    const finishExport = deferred<unknown>();
    const lockService = {
      tryAcquire: jest.fn(async (userId: number) => {
        if (activeUsers.has(userId)) {
          return { acquired: false as const, reason: 'LOCKED' as const };
        }
        activeUsers.add(userId);
        const lock: UserExportLock = {
          lost: new AbortController().signal,
          renew: jest.fn().mockResolvedValue(undefined),
          stopRenewal: jest.fn().mockResolvedValue(undefined),
          release: jest.fn(async () => {
            activeUsers.delete(userId);
            return true;
          }),
        };
        return { acquired: true as const, lock };
      }),
    };
    const usersService = {
      exportPersonalDataToTemporaryFile: jest.fn(() => {
        exportStarted.resolve();
        return finishExport.promise;
      }),
    };

    try {
      const module = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
        controllers: [UsersController],
        providers: [
          { provide: UsersService, useValue: usersService },
          {
            provide: PrivacyRequestsService,
            useValue: createPrivacyRequestsService(),
          },
          { provide: UserExportLockService, useValue: lockService },
        ],
      })
        .overrideGuard(JwtGuard)
        .useValue({
          canActivate: (context: {
            switchToHttp: () => {
              getRequest: () => { user?: { sub: number } };
            };
          }) => {
            context.switchToHttp().getRequest().user = { sub: 42 };
            return true;
          },
        })
        .overrideGuard(RolesGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = module.createNestApplication();
      app.useLogger(false);
      await app.init();
      const server = app.getHttpServer();

      const firstExport = request(server)
        .get('/users/me/export')
        .then((r) => r);
      await exportStarted.promise;

      const duplicateResponse = await request(server).get('/users/me/export');
      expect(duplicateResponse.status).toBe(409);
      expect(
        usersService.exportPersonalDataToTemporaryFile,
      ).toHaveBeenCalledTimes(1);
      expect(lockService.tryAcquire).toHaveBeenCalledTimes(2);

      finishExport.resolve(
        createExportFile('{"formato":"Barbearia-App personal data v1"}'),
      );
      const firstResponse = await firstExport;
      expect(firstResponse.status).toBe(200);
      expect(activeUsers.size).toBe(0);
    } finally {
      await app?.close();
    }
  });

  it('passes the authenticated JWT authVersion to profile updates', async () => {
    const dto: UpdateUserDto = { email: 'novo@example.com' };
    const usersService = {
      updateUser: jest.fn().mockResolvedValue({ id: 42 }),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      createExportLock().service,
    );

    await controller.updateMe(42, 3, dto);

    expect(usersService.updateUser).toHaveBeenCalledWith(42, dto, 3);
  });

  it('requires authenticated client or barber access and applies a throttler', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UsersController)).toEqual(
      expect.arrayContaining([JwtGuard, RolesGuard]),
    );
    expect(Reflect.getMetadata(ROLES_KEY, UsersController)).toEqual([
      TipoUsuario.CLIENTE,
      TipoUsuario.BARBEIRO,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, exportHandler)).toContain(
      ThrottlerGuard,
    );
    expect(Reflect.getMetadata(PATH_METADATA, exportHandler)).toBe('me/export');
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', exportHandler)).toBe(
      3,
    );
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', exportHandler)).toBe(
      60_000,
    );
    expect(Reflect.getMetadata(PATH_METADATA, createRequestHandler)).toBe(
      'me/requests',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, createRequestHandler),
    ).toContain(ThrottlerGuard);
    expect(
      Reflect.getMetadata('THROTTLER:LIMITdefault', createRequestHandler),
    ).toBe(5);
    expect(
      Reflect.getMetadata('THROTTLER:TTLdefault', createRequestHandler),
    ).toBe(60_000);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, createRequestHandler)).toBe(
      201,
    );
    expect(Reflect.getMetadata(PATH_METADATA, listRequestsHandler)).toBe(
      'me/requests',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, listRequestsHandler)).toContain(
      ThrottlerGuard,
    );
    expect(
      Reflect.getMetadata('THROTTLER:LIMITdefault', listRequestsHandler),
    ).toBe(30);
    expect(
      Reflect.getMetadata('THROTTLER:TTLdefault', listRequestsHandler),
    ).toBe(60_000);
    expect(
      Reflect.getMetadata(
        'THROTTLER:TRACKERdefault',
        exportHandler,
      )({ user: { sub: 42 } }),
    ).toBe('usuario:42');
    expect(
      Reflect.getMetadata(
        'THROTTLER:TRACKERdefault',
        createRequestHandler,
      )({ user: { sub: 42 } }),
    ).toBe('usuario:42');
    expect(
      Reflect.getMetadata(
        'THROTTLER:TRACKERdefault',
        listRequestsHandler,
      )({ user: { sub: 42 } }),
    ).toBe('usuario:42');
  });

  it('sets safe download headers with a fixed non-personal filename', () => {
    const headers = Reflect.getMetadata(
      HEADERS_METADATA,
      exportHandler,
    ) as Array<{
      name: string;
      value: string;
    }>;

    expect(headers).toEqual(
      expect.arrayContaining([
        {
          name: 'Content-Disposition',
          value: 'attachment; filename="dados-pessoais.json"',
        },
        { name: 'X-Content-Type-Options', value: 'nosniff' },
      ]),
    );
  });

  it('does not accept an account id as an export route parameter', () => {
    expect(Reflect.getMetadata(PATH_METADATA, exportHandler)).toBe('me/export');
    expect(exportHandler.length).toBe(3);
  });

  it('hides unexpected service errors and logs only a generic message', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const usersService = {
      exportPersonalDataToTemporaryFile: jest
        .fn()
        .mockRejectedValue(new Error('private database details')),
    } as unknown as UsersService;
    const exportLock = createExportLock();
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
      exportLock.service,
    );
    const { request, response } = createHttpMocks();

    await expect(controller.exportMe(42, request, response)).rejects.toEqual(
      new InternalServerErrorException(
        'Não foi possível gerar a exportação de dados pessoais.',
      ),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      'Falha ao gerar exportação de dados pessoais.',
    );
    expect(loggerSpy.mock.calls.flat().join(' ')).not.toContain(
      'private database details',
    );
    if (exportLock.acquisition.acquired) {
      expect(exportLock.acquisition.lock.release).toHaveBeenCalledTimes(1);
    }
    loggerSpy.mockRestore();
  });

  it('serves JSON download headers and throttles repeated requests without a database', async () => {
    let app: INestApplication | undefined;
    let authenticatedUserId = 42;
    const exportData = { formato: 'Barbearia-App personal data v1' };
    const usersService = {
      exportPersonalDataToTemporaryFile: jest
        .fn()
        .mockRejectedValueOnce(new Error('sensitive internal database details'))
        .mockResolvedValue(createExportFile(JSON.stringify(exportData))),
    };
    const requestData = {
      id: 21,
      categoria: CategoriaSolicitacaoTitular.CORRECAO,
      status: 'RECEBIDA',
      dataCriacao: new Date('2026-11-12T10:00:00.000Z').toISOString(),
    };
    const privacyRequestsService = {
      create: jest.fn().mockResolvedValue(requestData),
      findMine: jest.fn().mockResolvedValue({
        solicitacoes: [requestData],
        proximoCursor: null,
      }),
    };

    try {
      const module = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
        controllers: [UsersController],
        providers: [
          { provide: UsersService, useValue: usersService },
          {
            provide: PrivacyRequestsService,
            useValue: privacyRequestsService,
          },
          {
            provide: UserExportLockService,
            useValue: createExportLock().service,
          },
        ],
      })
        .overrideGuard(JwtGuard)
        .useValue({
          canActivate: (context: {
            switchToHttp: () => {
              getRequest: () => { user?: { sub: number } };
            };
          }) => {
            context.switchToHttp().getRequest().user = {
              sub: authenticatedUserId,
            };
            return true;
          },
        })
        .overrideGuard(RolesGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = module.createNestApplication();
      app.useLogger(false);
      app.useGlobalInterceptors(
        new PrivateResponseCacheInterceptor(new Reflector()),
      );
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      await app.init();

      const server = app.getHttpServer();
      const errorResponse = await request(server).get('/users/me/export');
      expect(errorResponse.status).toBe(500);
      expect(JSON.stringify(errorResponse.body)).not.toContain(
        'sensitive internal database details',
      );

      authenticatedUserId = 43;
      const firstResponse = await request(server).get('/users/me/export');
      expect(firstResponse.status).toBe(200);
      expect((await request(server).get('/users/me/export')).status).toBe(200);
      expect((await request(server).get('/users/me/export')).status).toBe(200);
      expect((await request(server).get('/users/me/export')).status).toBe(429);
      expect(firstResponse.headers['content-type']).toMatch(
        /application\/json/,
      );
      expect(firstResponse.headers['content-disposition']).toBe(
        'attachment; filename="dados-pessoais.json"',
      );
      expect(firstResponse.headers['cache-control']).toBe('no-store');
      expect(firstResponse.headers.pragma).toBe('no-cache');
      expect(firstResponse.headers['x-content-type-options']).toBe('nosniff');
      expect(
        usersService.exportPersonalDataToTemporaryFile,
      ).toHaveBeenCalledTimes(4);
      expect(
        usersService.exportPersonalDataToTemporaryFile,
      ).toHaveBeenNthCalledWith(1, 42, expect.any(AbortSignal));
      expect(
        usersService.exportPersonalDataToTemporaryFile,
      ).toHaveBeenNthCalledWith(2, 43, expect.any(AbortSignal));

      const requestResponse = await request(server)
        .post('/users/me/requests')
        .set('Idempotency-Key', '9c1e39b2-e675-4e29-a0de-4e4c15c3b64c')
        .send({ categoria: CategoriaSolicitacaoTitular.CORRECAO });
      expect(requestResponse.status).toBe(201);
      expect(requestResponse.body).toEqual(requestData);
      expect(requestResponse.body).not.toHaveProperty('chaveIdempotencia');
      expect(privacyRequestsService.create).toHaveBeenCalledWith(
        43,
        { categoria: CategoriaSolicitacaoTitular.CORRECAO },
        '9c1e39b2-e675-4e29-a0de-4e4c15c3b64c',
      );

      const listResponse = await request(server)
        .get('/users/me/requests')
        .query({ limit: '1' });
      expect(listResponse.status).toBe(200);
      expect(privacyRequestsService.findMine).toHaveBeenCalledWith(
        43,
        expect.objectContaining({ limit: 1 }),
      );

      const forbiddenFieldsResponse = await request(server)
        .post('/users/me/requests')
        .set('Idempotency-Key', '9c1e39b2-e675-4e29-a0de-4e4c15c3b64d')
        .send({
          categoria: CategoriaSolicitacaoTitular.CORRECAO,
          titularId: 42,
          status: 'ENCERRADA',
        });
      expect(forbiddenFieldsResponse.status).toBe(400);

      const invalidKeyResponse = await request(server)
        .post('/users/me/requests')
        .set('Idempotency-Key', 'not-a-uuid')
        .send({ categoria: CategoriaSolicitacaoTitular.CORRECAO });
      expect(invalidKeyResponse.status).toBe(400);

      expect(
        (
          await request(server).patch('/users/me/requests/21').send({
            status: 'ENCERRADA',
          })
        ).status,
      ).toBe(404);
    } finally {
      await app?.close();
    }
  });

  it('rate limits privacy request creation and pagination by authenticated user', async () => {
    let app: INestApplication | undefined;
    let authenticatedUserId = 51;
    const requestData = {
      id: 21,
      categoria: CategoriaSolicitacaoTitular.CORRECAO,
      status: 'RECEBIDA',
      dataCriacao: new Date('2026-11-12T10:00:00.000Z').toISOString(),
    };
    const privacyRequestsService = {
      create: jest.fn().mockResolvedValue(requestData),
      findMine: jest.fn().mockResolvedValue({
        solicitacoes: [requestData],
        proximoCursor: null,
      }),
    };

    try {
      const module = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
        controllers: [UsersController],
        providers: [
          {
            provide: UsersService,
            useValue: { exportPersonalDataToTemporaryFile: jest.fn() },
          },
          {
            provide: PrivacyRequestsService,
            useValue: privacyRequestsService,
          },
          {
            provide: UserExportLockService,
            useValue: createExportLock().service,
          },
        ],
      })
        .overrideGuard(JwtGuard)
        .useValue({
          canActivate: (context: {
            switchToHttp: () => {
              getRequest: () => { user?: { sub: number } };
            };
          }) => {
            context.switchToHttp().getRequest().user = {
              sub: authenticatedUserId,
            };
            return true;
          },
        })
        .overrideGuard(RolesGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = module.createNestApplication();
      app.useLogger(false);
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      await app.init();

      const server = app.getHttpServer();
      const createRequest = (index: number) =>
        request(server)
          .post('/users/me/requests')
          .set(
            'Idempotency-Key',
            `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          )
          .send({ categoria: CategoriaSolicitacaoTitular.CORRECAO });

      for (let index = 1; index <= 5; index += 1) {
        expect((await createRequest(index)).status).toBe(201);
      }
      expect((await createRequest(6)).status).toBe(429);

      authenticatedUserId = 52;
      expect((await createRequest(7)).status).toBe(201);

      authenticatedUserId = 51;
      for (let index = 0; index < 30; index += 1) {
        expect((await request(server).get('/users/me/requests')).status).toBe(
          200,
        );
      }
      expect((await request(server).get('/users/me/requests')).status).toBe(
        429,
      );

      authenticatedUserId = 53;
      expect((await request(server).get('/users/me/requests')).status).toBe(
        200,
      );
      expect(privacyRequestsService.create).toHaveBeenCalledTimes(6);
      expect(privacyRequestsService.findMine).toHaveBeenCalledTimes(31);
    } finally {
      await app?.close();
    }
  });
});
