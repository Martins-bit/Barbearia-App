import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateScheduleBlockDto } from './dto/create-schedule-block.dto';
import { ScheduleBlockResponseDto } from './dto/schedule-block-response.dto';
import { ScheduleService } from './schedule.service';

@Controller('schedule-blocks')
export class ScheduleBlocksController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.BARBEIRO)
  async create(
    @CurrentUser() userId: number,
    @Body() dto: CreateScheduleBlockDto,
  ): Promise<ScheduleBlockResponseDto> {
    return this.scheduleService.createOwnBlock(userId, dto);
  }

  @Get()
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.BARBEIRO)
  async findOwn(
    @CurrentUser() userId: number,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ): Promise<ScheduleBlockResponseDto[]> {
    return this.scheduleService.findOwnBlocks(userId, dataInicio, dataFim);
  }

  /**
   * DELETE previsto em API.md §15.3. Sempre valida ownership: bloqueio de
   * outro barbeiro retorna 404 genérico (sem revelar existência).
   */
  @Delete(':id')
  @HttpCode(200)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.BARBEIRO)
  async remove(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) blockId: number,
  ): Promise<{ removido: true }> {
    await this.scheduleService.deleteOwnBlock(userId, blockId);
    return { removido: true };
  }
}
