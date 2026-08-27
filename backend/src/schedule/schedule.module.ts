import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AvailabilityController } from './availability.controller';
import { BusinessHoursController } from './business-hours.controller';
import { ScheduleBlocksController } from './schedule-blocks.controller';
import { ScheduleService } from './schedule.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [
    BusinessHoursController,
    ScheduleBlocksController,
    AvailabilityController,
  ],
  providers: [ScheduleService],
})
export class ScheduleModule {}
