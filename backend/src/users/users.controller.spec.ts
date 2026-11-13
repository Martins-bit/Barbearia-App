import {
  InternalServerErrorException,
  Logger,
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
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrivacyRequestsService } from './privacy-requests/privacy-requests.service';
import { CategoriaSolicitacaoTitular } from '../generated/prisma/enums';
import { UpdateUserDto } from './dto/update-user.dto';

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
      exportPersonalData: jest.fn().mockResolvedValue(exportData),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
    );

    await expect(controller.exportMe(42)).resolves.toBe(exportData);
    expect(usersService.exportPersonalData).toHaveBeenCalledWith(42);
  });

  it('passes the authenticated JWT authVersion to profile updates', async () => {
    const dto: UpdateUserDto = { email: 'novo@example.com' };
    const usersService = {
      updateUser: jest.fn().mockResolvedValue({ id: 42 }),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
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
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', exportHandler)).toBe(3);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', exportHandler)).toBe(
      60_000,
    );
    expect(Reflect.getMetadata(PATH_METADATA, createRequestHandler)).toBe(
      'me/requests',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, createRequestHandler)).toContain(
      ThrottlerGuard,
    );
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
      Reflect.getMetadata('THROTTLER:TRACKERdefault', exportHandler)(
        { user: { sub: 42 } },
      ),
    ).toBe('usuario:42');
    expect(
      Reflect.getMetadata('THROTTLER:TRACKERdefault', createRequestHandler)(
        { user: { sub: 42 } },
      ),
    ).toBe('usuario:42');
    expect(
      Reflect.getMetadata('THROTTLER:TRACKERdefault', listRequestsHandler)(
        { user: { sub: 42 } },
      ),
    ).toBe('usuario:42');
  });

  it('sets non-cacheable download headers with a fixed non-personal filename', () => {
    const headers = Reflect.getMetadata(HEADERS_METADATA, exportHandler) as Array<{
      name: string;
      value: string;
    }>;

    expect(headers).toEqual(
      expect.arrayContaining([
        {
          name: 'Content-Disposition',
          value: 'attachment; filename="dados-pessoais.json"',
        },
        { name: 'Cache-Control', value: 'no-store' },
        { name: 'Pragma', value: 'no-cache' },
        { name: 'X-Content-Type-Options', value: 'nosniff' },
      ]),
    );
  });

  it('does not accept an account id as an export route parameter', () => {
    expect(Reflect.getMetadata(PATH_METADATA, exportHandler)).toBe('me/export');
    expect(exportHandler.length).toBe(1);
  });

  it('hides unexpected service errors and logs only a generic message', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const usersService = {
      exportPersonalData: jest
        .fn()
        .mockRejectedValue(new Error('private database details')),
    } as unknown as UsersService;
    const controller = new UsersController(
      usersService,
      createPrivacyRequestsService(),
    );

    await expect(controller.exportMe(42)).rejects.toEqual(
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
    loggerSpy.mockRestore();
  });

  it('serves JSON download headers and throttles repeated requests without a database', async () => {
    let app: INestApplication | undefined;
    let authenticatedUserId = 42;
    const exportData = { formato: 'Barbearia-App personal data v1' };
    const usersService = {
      exportPersonalData: jest
        .fn()
        .mockRejectedValueOnce(new Error('sensitive internal database details'))
        .mockResolvedValue(exportData),
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
      expect(firstResponse.headers['content-type']).toMatch(/application\/json/);
      expect(firstResponse.headers['content-disposition']).toBe(
        'attachment; filename="dados-pessoais.json"',
      );
      expect(firstResponse.headers['cache-control']).toBe('no-store');
      expect(firstResponse.headers.pragma).toBe('no-cache');
      expect(firstResponse.headers['x-content-type-options']).toBe('nosniff');
      expect(usersService.exportPersonalData).toHaveBeenCalledTimes(4);
      expect(usersService.exportPersonalData).toHaveBeenNthCalledWith(1, 42);
      expect(usersService.exportPersonalData).toHaveBeenNthCalledWith(2, 43);

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
        (await request(server).patch('/users/me/requests/21').send({
          status: 'ENCERRADA',
        })).status,
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
            useValue: { exportPersonalData: jest.fn() },
          },
          {
            provide: PrivacyRequestsService,
            useValue: privacyRequestsService,
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
