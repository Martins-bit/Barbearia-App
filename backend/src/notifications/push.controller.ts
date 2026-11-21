import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TipoUsuario } from '../generated/prisma/enums';
import { PushSubscriptionDto } from './push-subscription.dto';
import { PushService } from './push.service';

function userThrottleTracker(req: { user?: { sub?: unknown } }): string {
  const userId = req?.user?.sub;
  return typeof userId === 'number' && Number.isSafeInteger(userId)
    ? `usuario:${userId}`
    : 'anon';
}

@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('public-key')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getPublicKey(): { publicKey: string } {
    return this.pushService.getPublicKey();
  }

  @Post('subscriptions')
  @UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
  @Roles(TipoUsuario.CLIENTE, TipoUsuario.BARBEIRO)
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
      getTracker: userThrottleTracker,
    },
  })
  register(
    @CurrentUser() userId: number,
    @Body() subscription: PushSubscriptionDto,
  ): never {
    return this.pushService.registerSubscription(userId, subscription);
  }

  @Get('subscriptions')
  @UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
  @Roles(TipoUsuario.CLIENTE, TipoUsuario.BARBEIRO)
  @Throttle({
    default: {
      limit: 30,
      ttl: 60_000,
      getTracker: userThrottleTracker,
    },
  })
  findMine(@CurrentUser() userId: number) {
    return this.pushService.findMine(userId);
  }

  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
  @Roles(TipoUsuario.CLIENTE, TipoUsuario.BARBEIRO)
  @Throttle({
    default: {
      limit: 20,
      ttl: 60_000,
      getTracker: userThrottleTracker,
    },
  })
  revokeMine(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) subscriptionId: number,
  ): Promise<void> {
    return this.pushService.revokeMine(userId, subscriptionId);
  }
}
