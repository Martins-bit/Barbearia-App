import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface CurrentUserClaims {
  sub: number;
  authVersion: number;
}

/**
 * Extrai uma claim validada do usuário autenticado.
 * Uso: @CurrentUser() userId: number ou
 * @CurrentUser('authVersion') version: number
 */
export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserClaims | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return data ? request.user?.[data] : request.user?.sub;
  },
);
