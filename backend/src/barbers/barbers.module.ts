import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { BarbersController } from './barbers.controller';
import { BarbersService } from './barbers.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [BarbersController],
  providers: [BarbersService],
})
export class BarbersModule {}
