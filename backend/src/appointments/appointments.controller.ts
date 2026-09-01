import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  /**
   * API.md §9.1 — criação de agendamento, exclusiva do CLIENTE.
   * usuarioId vem SEMPRE do JWT; clienteId/status nunca são aceitos.
   * Toda validação de regra de negócio pertence ao AppointmentsService.
   */
  @Post()
  @HttpCode(201)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.CLIENTE)
  async create(
    @CurrentUser() userId: number,
    @Body() dto: CreateAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.create(userId, dto);
  }

  /**
   * API.md §9.2 — lista SOMENTE os agendamentos do cliente autenticado,
   * ordenados cronologicamente (mais próximos primeiro).
   */
  @Get('my')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.CLIENTE)
  async findMy(
    @CurrentUser() userId: number,
  ): Promise<AppointmentResponseDto[]> {
    return this.appointmentsService.findMyAppointments(userId);
  }
}
