import { Module } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Os guards são PROVIDERS locais (e não importados do AuthModule) para
 * evitar o ciclo AuthModule -> UsersModule -> AuthModule. A estratégia
 * passport 'jwt' é registrada globalmente pelo AuthModule (carregado pelo
 * AppModule); RolesGuard resolve UsersService deste próprio módulo.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService, JwtGuard, RolesGuard],
  exports: [UsersService],
})
export class UsersModule {}
