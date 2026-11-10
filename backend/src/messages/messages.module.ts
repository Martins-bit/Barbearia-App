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
  providers: [
    MessagesService,
    MessagesSocketRegistry,
    MessagesGateway,
    {
      provide: 'MESSAGES_GATEWAY',
      useExisting: MessagesGateway,
    },
  ],
  exports: [MessagesService, MessagesSocketRegistry, MessagesGateway],
})
export class MessagesModule {}
