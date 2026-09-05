import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findMine(@CurrentUser() userId: number) {
    return this.notificationsService.findMine(userId);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() userId: number) {
    return this.notificationsService.unreadCount(userId);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) notificationId: number,
  ) {
    return this.notificationsService.markAsRead(userId, notificationId);
  }

  @Patch('read-all')
  async markAllAsRead(@CurrentUser() userId: number) {
    return this.notificationsService.markAllAsRead(userId);
  }
}