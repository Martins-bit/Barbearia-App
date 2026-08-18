import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator para extrair o ID do usuário autenticado a partir do JWT.
 * Uso: @CurrentUser() userId: number
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.sub;
  },
);
