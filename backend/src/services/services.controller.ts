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
import { CreateServiceDto } from './dto/create-service.dto';
import { ServiceResponseDto } from './dto/service-response.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceStatusDto } from './dto/update-service-status.dto';
import { ServicesService } from './services.service';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  @UseGuards(JwtGuard)
  async findActiveServices(): Promise<ServiceResponseDto[]> {
    return this.servicesService.findActiveServices();
  }

  @Get('admin')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.BARBEIRO)
  async findOwnServices(
    @CurrentUser() userId: number,
  ): Promise<ServiceResponseDto[]> {
    return this.servicesService.findOwnServicesByUserId(userId);
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  async findActiveServiceById(
    @Param('id', ParseIntPipe) serviceId: number,
  ): Promise<ServiceResponseDto> {
    return this.servicesService.findActiveServiceById(serviceId);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.BARBEIRO)
  async createService(
    @CurrentUser() userId: number,
    @Body() data: CreateServiceDto,
  ): Promise<ServiceResponseDto> {
    return this.servicesService.createService(userId, data);
  }

  @Patch(':id/status')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.BARBEIRO)
  async updateServiceStatus(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) serviceId: number,
    @Body() data: UpdateServiceStatusDto,
  ): Promise<ServiceResponseDto> {
    return this.servicesService.updateOwnServiceStatus(
      userId,
      serviceId,
      data.ativo,
    );
  }

  @Patch(':id')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.BARBEIRO)
  async updateService(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) serviceId: number,
    @Body() data: UpdateServiceDto,
  ): Promise<ServiceResponseDto> {
    return this.servicesService.updateOwnService(userId, serviceId, data);
  }
}