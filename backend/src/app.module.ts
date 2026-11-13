import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { RedisThrottlerStorage } from './common/throttling/redis-throttler-storage';
import { RedisThrottlerStorageModule } from './common/throttling/redis-throttler-storage.module';
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
import { BarbersModule } from './barbers/barbers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // O guard continua aplicado somente nas rotas que usam @UseGuards.
    // Storage Redis compartilhado evita contadores independentes por instância.
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottlerStorageModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage,
      }),
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
    BarbersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
