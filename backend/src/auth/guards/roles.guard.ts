import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TipoUsuario } from '../../generated/prisma/enums';
import { UsersService } from '../../users/users.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

interface AuthenticatedRequest {
  user?: {
    sub?: number;
  };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.sub;

    if (typeof userId !== 'number') {
      throw new UnauthorizedException();
    }

    const authorizationState =
      await this.usersService.findAuthorizationStateById(userId);

    if (!authorizationState || !authorizationState.ativo) {
      throw new UnauthorizedException();
    }

    const allowedRoles = this.reflector.getAllAndOverride<TipoUsuario[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (allowedRoles === undefined) {
      return true;
    }

    if (!allowedRoles.includes(authorizationState.tipoUsuario)) {
      throw new ForbiddenException();
    }

    if (
      allowedRoles.includes(TipoUsuario.BARBEIRO) &&
      authorizationState.tipoUsuario === TipoUsuario.BARBEIRO &&
      (!authorizationState.barbeiro || !authorizationState.barbeiro.ativo)
    ) {
      throw new ForbiddenException();
    }

    return true;
  }
}