import {
  ExecutionContext,
  ForbiddenException,
  Reflector,
  UnauthorizedException,
} from '@nestjs/common';
import { TipoUsuario } from '../../generated/prisma/enums';
import { UsersService } from '../../users/users.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let usersService: { findAuthorizationStateById: jest.Mock };
  let context: ExecutionContext;
  let request: { user?: { sub?: number; tipoUsuario?: TipoUsuario } };

  const createAuthorizationState = (
    overrides: Partial<{
      id: number;
      ativo: boolean;
      tipoUsuario: TipoUsuario;
      barbeiro: { ativo: boolean } | null;
    }> = {},
  ) => ({
    id: 1,
    ativo: true,
    tipoUsuario: TipoUsuario.BARBEIRO,
    barbeiro: { ativo: true },
    ...overrides,
  });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    usersService = { findAuthorizationStateById: jest.fn() };
    request = { user: { sub: 1 } };
    context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as unknown as ExecutionContext;
    guard = new RolesGuard(
      reflector as unknown as Reflector,
      usersService as unknown as UsersService,
    );
  });

  it('permite BARBEIRO ativo com registro ativo', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState(),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejeita CLIENTE ativo em rota de BARBEIRO', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState({
        tipoUsuario: TipoUsuario.CLIENTE,
        barbeiro: null,
      }),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejeita BARBEIRO com registro inativo', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState({ barbeiro: { ativo: false } }),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejeita BARBEIRO sem registro relacionado', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState({ barbeiro: null }),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejeita usuário inativo com 401', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState({ ativo: false }),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita usuário inexistente com 401', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    usersService.findAuthorizationStateById.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('usa o banco, ignorando tipoUsuario falso no JWT', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    request.user = { sub: 1, tipoUsuario: TipoUsuario.CLIENTE };
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState(),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(usersService.findAuthorizationStateById).toHaveBeenCalledWith(1);
  });

  it('ignora tipoUsuario enviado pelo frontend', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    request = {
      user: { sub: 1, tipoUsuario: TipoUsuario.BARBEIRO },
      tipoUsuario: TipoUsuario.CLIENTE,
    } as typeof request & { tipoUsuario: TipoUsuario };
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState(),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(usersService.findAuthorizationStateById).toHaveBeenCalledWith(1);
  });

  it('invalida token antigo quando BARBEIRO vira CLIENTE no banco', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    request.user = { sub: 1, tipoUsuario: TipoUsuario.BARBEIRO };
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState({
        tipoUsuario: TipoUsuario.CLIENTE,
        barbeiro: null,
      }),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('invalida token antigo quando o usuário é desativado', async () => {
    reflector.getAllAndOverride.mockReturnValue([TipoUsuario.BARBEIRO]);
    request.user = { sub: 1, tipoUsuario: TipoUsuario.BARBEIRO };
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState({ ativo: false }),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('permite usuário ativo sem roles, sem conceder privilégio administrativo', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    usersService.findAuthorizationStateById.mockResolvedValue(
      createAuthorizationState({ tipoUsuario: TipoUsuario.CLIENTE }),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      ROLES_KEY,
      expect.any(Array),
    );
  });

  it('rejeita requisição sem sub com 401', async () => {
    request = { user: { tipoUsuario: TipoUsuario.BARBEIRO } };

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(usersService.findAuthorizationStateById).not.toHaveBeenCalled();
  });
});