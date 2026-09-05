import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { WaitlistOpportunityService } from './waitlist-opportunity.service';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    ScheduleModule,
    AppointmentsModule,
    NotificationsModule,
  ],
  controllers: [WaitlistController],
  providers: [
    WaitlistService,
    WaitlistOpportunityService,
    {
      provide: 'WAITLIST_OPPORTUNITY_SERVICE',
      useExisting: WaitlistOpportunityService,
    },
  ],
  exports: [WaitlistService],
})
export class WaitlistModule {}
