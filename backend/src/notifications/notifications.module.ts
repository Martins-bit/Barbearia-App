import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, PushService, ReminderSchedulerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
