import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}