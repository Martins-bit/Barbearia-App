import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { JwtGuard } from '../../auth/guards/jwt.guard';

export const NO_STORE_RESPONSE_METADATA = 'no-store-response';

export const NoStoreResponse = () =>
  SetMetadata(NO_STORE_RESPONSE_METADATA, true);

interface RequestWithHeaders {
  headers?: {
    authorization?: string | string[];
  };
}

interface ResponseWithHeaders {
  setHeader(name: string, value: string): unknown;
}

@Injectable()
export class PrivateResponseCacheInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const guards =
      this.reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, targets) ?? [];
    const isJwtProtected = guards.includes(JwtGuard);
    const explicitlyPrivate =
      this.reflector.getAllAndOverride<boolean>(
        NO_STORE_RESPONSE_METADATA,
        targets,
      ) ?? false;
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();

    if (
      isJwtProtected ||
      explicitlyPrivate ||
      Boolean(request.headers?.authorization)
    ) {
      const response = context
        .switchToHttp()
        .getResponse<ResponseWithHeaders>();
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
    }

    return next.handle();
  }
}
