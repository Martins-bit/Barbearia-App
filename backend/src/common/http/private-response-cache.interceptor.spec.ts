process.env.JWT_SECRET ??= 'unit-test-jwt-secret-with-at-least-32-characters';

import { UseGuards, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { of, lastValueFrom } from 'rxjs';
import { AuthController } from '../../auth/auth.controller';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { PushController } from '../../notifications/push.controller';
import { UsersController } from '../../users/users.controller';
import { PrivateResponseCacheInterceptor } from './private-response-cache.interceptor';

@UseGuards(JwtGuard)
class ClassGuardedController {
  handle(): void {}
}

class PublicController {
  handle(): void {}
}

type Handler = (...args: never[]) => unknown;

function getHandler(target: object, name: string): Handler {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (typeof descriptor?.value !== 'function') {
    throw new Error(`Handler ${name} was not found.`);
  }
  return descriptor.value as Handler;
}

describe('PrivateResponseCacheInterceptor', () => {
  const interceptor = new PrivateResponseCacheInterceptor(new Reflector());

  async function intercept(
    controller: Type<unknown>,
    handler: Handler,
    authorization?: string,
  ) {
    const setHeader = jest.fn();
    const context = {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: authorization ? { authorization } : {},
        }),
        getResponse: () => ({ setHeader }),
      }),
    };

    await lastValueFrom(
      interceptor.intercept(context as never, { handle: () => of('response') }),
    );
    return setHeader;
  }

  it('prevents caching responses from JWT-protected route handlers', async () => {
    const setHeader = await intercept(
      UsersController,
      getHandler(UsersController.prototype, 'findMyPrivacyRequests'),
    );

    expect(setHeader).toHaveBeenNthCalledWith(1, 'Cache-Control', 'no-store');
    expect(setHeader).toHaveBeenNthCalledWith(2, 'Pragma', 'no-cache');
  });

  it('recognizes JWT guards declared at controller level', async () => {
    const setHeader = await intercept(
      ClassGuardedController,
      getHandler(ClassGuardedController.prototype, 'handle'),
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('prevents caching all authentication flow responses', async () => {
    const setHeader = await intercept(
      AuthController,
      getHandler(AuthController.prototype, 'login'),
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
  });

  it('does not impose no-store on a public endpoint without authentication', async () => {
    const setHeader = await intercept(
      PushController,
      getHandler(PushController.prototype, 'getPublicKey'),
    );

    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        getHandler(PushController.prototype, 'getPublicKey'),
      ),
    ).toBeDefined();
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('prevents caching a response when an Authorization header is present', async () => {
    const setHeader = await intercept(
      PublicController,
      getHandler(PublicController.prototype, 'handle'),
      'Bearer token',
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
