import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard JWT que valida o token de autenticação.
 * Uso: @UseGuards(JwtGuard)
 */
@Injectable()
export class JwtGuard extends AuthGuard('jwt') {}
