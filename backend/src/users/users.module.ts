import { Module } from '@nestjs/common';
import { RedisModule } from '../common/redis/redis.module';
import { UserExportLockService } from '../common/redis/user-export-lock.service';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrivacyRequestsService } from './privacy-requests/privacy-requests.service';
import { TemporaryExportStorageService } from './temporary-export-storage.service';

/**
 * Os guards são PROVIDERS locais (e não importados do AuthModule) para
 * evitar o ciclo AuthModule -> UsersModule -> AuthModule. A estratégia
 * passport 'jwt' é registrada globalmente pelo AuthModule (carregado pelo
 * AppModule); RolesGuard resolve UsersService deste próprio módulo.
 */
@Module({
  imports: [RedisModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    PrivacyRequestsService,
    TemporaryExportStorageService,
    UserExportLockService,
    JwtGuard,
    RolesGuard,
  ],
  exports: [UsersService],
})
export class UsersModule {}
