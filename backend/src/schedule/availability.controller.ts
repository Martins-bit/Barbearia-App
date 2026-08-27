import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { AvailabilityResponseDto } from './dto/availability-response.dto';
import { ScheduleService } from './schedule.service';

/**
 * Consulta de disponibilidade (API.md §8). Autenticação obrigatória;
 * CLIENTE consulta informando barbeiroId, BARBEIRO pode omitir (próprio).
 */
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  @UseGuards(JwtGuard)
  async getAvailability(
    @CurrentUser() userId: number,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    return this.scheduleService.getAvailability(userId, query);
  }
}
