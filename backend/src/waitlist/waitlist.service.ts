import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { StatusListaEspera } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { getZonedParts, isValidDateKey, prismaDateFilter } from '../schedule/tz.util';

export type WaitlistDbClient = PrismaClient | Prisma.TransactionClient;

export const WAITLIST_LOCK_NS = 3;

export async function acquireWaitlistLock(
  client: WaitlistDbClient,
  clienteId: number,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(
    ${WAITLIST_LOCK_NS}::int,
    ${clienteId}::int
  )`;
}

export interface WaitlistCreateDto {
  barbeiroId: number;
  servicoId: number;
  data: string;
  horaInicio?: string;
  horaFim?: string;
}

@Injectable()
export class WaitlistService {
  constructor(private readonly prisma: PrismaService) {}

  private parseHHmm(hhmm: string): number {
    const [hour, minute] = hhmm.split(':').map(Number);
    return hour * 60 + minute;
  }

  private async resolveClienteId(userId: number): Promise<number> {
    const cliente = await this.prisma.cliente.findUnique({
      where: { usuarioId: userId },
      select: { id: true },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    return cliente.id;
  }

  private async ensureBarberAndService(
    barbeiroId: number,
    servicoId: number,
  ): Promise<void> {
    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { id: barbeiroId },
      select: { id: true, ativo: true },
    });

    if (!barbeiro || !barbeiro.ativo) {
      throw new NotFoundException('Barbeiro não encontrado.');
    }

    const servico = await this.prisma.servico.findFirst({
      where: { id: servicoId, barbeiroId, ativo: true },
      select: { id: true, ativo: true },
    });

    if (!servico || !servico.ativo) {
      throw new NotFoundException('Serviço não encontrado.');
    }
  }

  private validateWindow(horaInicio?: string, horaFim?: string): void {
    if (horaInicio === undefined && horaFim === undefined) {
      return;
    }

    if (horaInicio === undefined || horaFim === undefined) {
      throw new BadRequestException(
        'Se informar horaInicio ou horaFim, deve informar ambos.',
      );
    }

    const hhmmPattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!hhmmPattern.test(horaInicio) || !hhmmPattern.test(horaFim)) {
      throw new BadRequestException('Horários devem estar no formato HH:mm.');
    }

    const start = this.parseHHmm(horaInicio);
    const end = this.parseHHmm(horaFim);
    if (end <= start) {
      throw new BadRequestException('horaFim deve ser posterior a horaInicio.');
    }
  }

  private toResponse(entry: any): any {
    const dataDesejada = entry.dataDesejada ?? entry.data ?? new Date();
    return {
      id: entry.id,
      barbeiroId: entry.barbeiroId ?? entry.barbeiro?.id ?? null,
      servicoId: entry.servicoId,
      status: entry.status,
      data: dataDesejada.toISOString().slice(0, 10),
      horaInicio: entry.horaInicio ?? null,
      horaFim: entry.horaFim ?? null,
      dataEntrada: entry.dataEntrada,
      dataAtualizacao: entry.dataAtualizacao,
      servico: entry.servico
        ? {
            id: entry.servico.id,
            nome: entry.servico.nome,
          }
        : undefined,
    };
  }

  async create(userId: number, dto: WaitlistCreateDto): Promise<any> {
    const clienteId = await this.resolveClienteId(userId);

    if (!isValidDateKey(dto.data)) {
      throw new BadRequestException('Data inválida.');
    }

    const now = new Date();
    const todayParts = getZonedParts(now);
    const todayKey = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`;

    if (dto.data < todayKey) {
      throw new BadRequestException('Data inválida.');
    }

    this.validateWindow(dto.horaInicio, dto.horaFim);
    await this.ensureBarberAndService(dto.barbeiroId, dto.servicoId);

    return this.prisma.$transaction(async (tx: WaitlistDbClient) => {
      await acquireWaitlistLock(tx, clienteId);

      const active = await tx.listaEspera.findFirst({
        where: {
          clienteId,
          barbeiroId: dto.barbeiroId,
          servicoId: dto.servicoId,
          dataDesejada: prismaDateFilter(dto.data),
          status: StatusListaEspera.ATIVA,
        },
      });

      if (active) {
        throw new ConflictException(
          'Já existe uma entrada ativa para este cliente, serviço e data.',
        );
      }

      const created = await tx.listaEspera.create({
        data: {
          clienteId,
          barbeiroId: dto.barbeiroId,
          servicoId: dto.servicoId,
          dataDesejada: prismaDateFilter(dto.data),
          horaInicio: dto.horaInicio ?? null,
          horaFim: dto.horaFim ?? null,
          status: StatusListaEspera.ATIVA,
          dataEntrada: new Date(),
          dataAtualizacao: new Date(),
        },
      });

      return this.toResponse({
        ...created,
        horaInicio: dto.horaInicio ?? null,
        horaFim: dto.horaFim ?? null,
      });
    });
  }

  async findMyWaitlist(userId: number): Promise<any[]> {
    const clienteId = await this.resolveClienteId(userId);

    const entries = await this.prisma.listaEspera.findMany({
      where: { clienteId },
      orderBy: [{ dataDesejada: 'asc' }, { dataEntrada: 'asc' }],
      include: {
        servico: { select: { id: true, nome: true } },
      },
    });

    return entries.map((entry) => this.toResponse(entry));
  }

  async cancel(userId: number, waitlistId: number): Promise<any> {
    const clienteId = await this.resolveClienteId(userId);

    const entry = await this.prisma.listaEspera.findUnique({
      where: { id: waitlistId },
    });

    if (!entry || entry.clienteId !== clienteId) {
      throw new NotFoundException('Entrada de lista de espera não encontrada.');
    }

    if (entry.status === StatusListaEspera.CANCELADA) {
      throw new ConflictException('Esta entrada já está cancelada.');
    }

    const updated = await this.prisma.listaEspera.update({
      where: { id: waitlistId },
      data: {
        status: StatusListaEspera.CANCELADA,
        dataAtualizacao: new Date(),
      },
    });

    return this.toResponse(updated);
  }
}
