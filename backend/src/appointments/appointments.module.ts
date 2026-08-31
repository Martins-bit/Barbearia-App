import { Module } from '@nestjs/common';
import { ScheduleModule } from '../schedule/schedule.module';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [ScheduleModule],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
