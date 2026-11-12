import { InternalServerErrorException, Logger } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
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

describe('UsersController', () => {
  const exportHandler = UsersController.prototype.exportMe;

  it('exports data for the authenticated user id supplied by CurrentUser', async () => {
    const exportData = {
      formato: 'Barbearia-App personal data v1' as const,
      geradoEm: new Date().toISOString(),
    };
    const usersService = {
      exportPersonalData: jest.fn().mockResolvedValue(exportData),
    } as unknown as UsersService;
    const controller = new UsersController(usersService);

    await expect(controller.exportMe(42)).resolves.toBe(exportData);
    expect(usersService.exportPersonalData).toHaveBeenCalledWith(42);
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
    expect(
      Reflect.getMetadata('THROTTLER:TRACKERdefault', exportHandler)(
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
    const controller = new UsersController(usersService);

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

    try {
      const module = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
        controllers: [UsersController],
        providers: [{ provide: UsersService, useValue: usersService }],
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
    } finally {
      await app?.close();
    }
  });
});
