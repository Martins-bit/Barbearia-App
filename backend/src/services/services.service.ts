import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { ServiceResponseDto } from './dto/service-response.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

type ServiceRecord = {
  id: number;
  nome: string;
  descricao: string | null;
  duracaoMinutos: number;
  preco: Prisma.Decimal;
  ativo: boolean;
};

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly serviceSelect = {
    id: true,
    nome: true,
    descricao: true,
    duracaoMinutos: true,
    preco: true,
    ativo: true,
  } as const;

  private toResponse(service: ServiceRecord): ServiceResponseDto {
    return {
      id: service.id,
      nome: service.nome,
      descricao: service.descricao,
      duracaoMinutos: service.duracaoMinutos,
      preco: new Prisma.Decimal(service.preco).toFixed(2),
      ativo: service.ativo,
    };
  }

  async findBarberIdByUserId(userId: number): Promise<number | null> {
    const barber = await this.prisma.barbeiro.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    return barber?.id ?? null;
  }

  async findActiveServices(): Promise<ServiceResponseDto[]> {
    const services = await this.prisma.servico.findMany({
      where: { ativo: true },
      select: this.serviceSelect,
      orderBy: { id: 'asc' },
    });

    return services.map((service) => this.toResponse(service as ServiceRecord));
  }

  async findActiveServiceById(serviceId: number): Promise<ServiceResponseDto> {
    const service = await this.prisma.servico.findFirst({
      where: { id: serviceId, ativo: true },
      select: this.serviceSelect,
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    return this.toResponse(service as ServiceRecord);
  }

  async findOwnServicesByUserId(userId: number): Promise<ServiceResponseDto[]> {
    const barberId = await this.findBarberIdByUserId(userId);

    if (barberId === null) {
      return [];
    }

    const services = await this.prisma.servico.findMany({
      where: { barbeiroId: barberId },
      select: this.serviceSelect,
      orderBy: { id: 'asc' },
    });

    return services.map((service) => this.toResponse(service as ServiceRecord));
  }

  async createService(
    userId: number,
    data: CreateServiceDto,
  ): Promise<ServiceResponseDto> {
    const barberId = await this.findBarberIdByUserId(userId);

    if (barberId === null) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    const service = await this.prisma.servico.create({
      data: {
        barbeiroId: barberId,
        nome: data.nome,
        descricao: data.descricao ?? null,
        duracaoMinutos: data.duracaoMinutos,
        preco: new Prisma.Decimal(data.preco),
      },
      select: this.serviceSelect,
    });

    return this.toResponse(service as ServiceRecord);
  }

  async updateOwnService(
    userId: number,
    serviceId: number,
    data: UpdateServiceDto,
  ): Promise<ServiceResponseDto> {
    const updateData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('Informe ao menos um campo para atualizar.');
    }

    const barberId = await this.findBarberIdByUserId(userId);

    if (barberId === null) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    const service = await this.prisma.servico.findFirst({
      where: { id: serviceId, barbeiroId: barberId },
      select: this.serviceSelect,
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    const prismaData = {
      ...updateData,
      ...(data.preco !== undefined
        ? { preco: new Prisma.Decimal(data.preco) }
        : {}),
    };

    const updatedService = await this.prisma.servico.update({
      where: { id: service.id },
      data: prismaData,
      select: this.serviceSelect,
    });

    return this.toResponse(updatedService as ServiceRecord);
  }

  async updateOwnServiceStatus(
    userId: number,
    serviceId: number,
    ativo: boolean,
  ): Promise<ServiceResponseDto> {
    const barberId = await this.findBarberIdByUserId(userId);

    if (barberId === null) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    const service = await this.prisma.servico.findFirst({
      where: { id: serviceId, barbeiroId: barberId },
      select: this.serviceSelect,
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    const updatedService = await this.prisma.servico.update({
      where: { id: service.id },
      data: { ativo },
      select: this.serviceSelect,
    });

    return this.toResponse(updatedService as ServiceRecord);
  }
}