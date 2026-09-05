import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { WaitlistService } from './waitlist.service';

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.CLIENTE)
  async create(
    @CurrentUser() userId: number,
    @Body() dto: CreateWaitlistDto,
  ) {
    return this.waitlistService.create(userId, dto);
  }

  @Get('my')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.CLIENTE)
  async findMy(@CurrentUser() userId: number) {
    return this.waitlistService.findMyWaitlist(userId);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.CLIENTE)
  async cancel(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) waitlistId: number,
  ) {
    return this.waitlistService.cancel(userId, waitlistId);
  }

  @Post('claims/:id/accept')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.CLIENTE)
  async acceptClaim(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) claimId: number,
  ) {
    return this.waitlistService.acceptClaim(userId, claimId);
  }

  @Post('claims/:id/reject')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.CLIENTE)
  async rejectClaim(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) claimId: number,
  ) {
    return this.waitlistService.rejectClaim(userId, claimId);
  }
}
