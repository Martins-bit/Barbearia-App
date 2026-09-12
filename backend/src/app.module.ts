import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ServicesModule } from './services/services.module';
import { ScheduleModule } from './schedule/schedule.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MessagesModule } from './messages/messages.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Scheduler oficial do Nest (alias NestScheduleModule para não colidir
    // com o ScheduleModule de domínio da agenda). Habilita o job periódico
    // de lembretes definido em NotificationsModule.
    NestScheduleModule.forRoot(),
    PrismaModule,
    UsersModule,
    AuthModule,
    ServicesModule,
    ScheduleModule,
    AppointmentsModule,
    WaitlistModule,
    NotificationsModule,
    MessagesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
