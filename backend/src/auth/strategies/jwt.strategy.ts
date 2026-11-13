import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JWT_CONFIG } from '../../common/config/jwt.config';
import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: number;
  telefone: string;
  tipoUsuario: 'CLIENTE' | 'BARBEIRO';
  authVersion?: number;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_CONFIG.secret,
    });
  }

  async validate(payload: JwtPayload) {
    const userId = Number(payload?.sub);
    const tokenVersion = payload?.authVersion ?? 0;
    if (
      !Number.isInteger(userId) ||
      userId < 1 ||
      !Number.isInteger(tokenVersion) ||
      tokenVersion < 0
    ) {
      throw new UnauthorizedException();
    }

    const current = await this.usersService.findAuthVersionById(userId);
    if (
      !current ||
      current.authVersion !== tokenVersion ||
      current.emailConfirmacaoObrigatoria
    ) {
      throw new UnauthorizedException();
    }

    return {
      sub: userId,
      telefone: payload.telefone,
      tipoUsuario: payload.tipoUsuario,
      authVersion: tokenVersion,
    };
  }
}
