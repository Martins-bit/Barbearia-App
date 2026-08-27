import { Body, Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BusinessHourResponseDto } from './dto/business-hour-response.dto';
import { ReplaceBusinessHoursDto } from './dto/replace-business-hours.dto';
import { ScheduleService } from './schedule.service';

@Controller('business-hours')
export class BusinessHoursController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.BARBEIRO)
  async findOwn(
    @CurrentUser() userId: number,
  ): Promise<BusinessHourResponseDto[]> {
    return this.scheduleService.findOwnBusinessHours(userId);
  }

  /**
   * PUT substitui INTEGRALMENTE a configuração semanal do barbeiro autenticado.
   * Dias omitidos no payload não permanecem da configuração anterior.
   */
  @Put()
  @HttpCode(200)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.BARBEIRO)
  async replaceAll(
    @CurrentUser() userId: number,
    @Body() dto: ReplaceBusinessHoursDto,
  ): Promise<BusinessHourResponseDto[]> {
    return this.scheduleService.replaceOwnBusinessHours(userId, dto);
  }
}
