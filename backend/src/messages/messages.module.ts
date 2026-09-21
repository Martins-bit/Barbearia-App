import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';
import { MessagesSocketRegistry } from './messages.socket-registry';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesSocketRegistry, MessagesGateway],
  exports: [MessagesService, MessagesSocketRegistry],
})
export class MessagesModule {}
