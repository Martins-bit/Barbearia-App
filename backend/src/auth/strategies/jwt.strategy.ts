import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JWT_CONFIG } from '../../common/config/jwt.config';

interface JwtPayload {
  sub: number;
  telefone: string;
  tipoUsuario: 'CLIENTE' | 'BARBEIRO';
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_CONFIG.secret,
    } as any);
  }

  async validate(payload: JwtPayload) {
    return {
      sub: payload.sub,
      telefone: payload.telefone,
      tipoUsuario: payload.tipoUsuario,
    };
  }
}
