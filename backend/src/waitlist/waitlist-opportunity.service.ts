import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SLOT_GRANULARITY_MINUTES,
} from '../schedule/schedule.service';
import { StatusListaEspera } from '../generated/prisma/enums';
import { WaitlistService } from './waitlist.service';

interface ReleasedWindow {
  barbeiroId: number;
  dateKey: string;
  horaInicio: string;
  horaFim: string;
}

@Injectable()
export class WaitlistOpportunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly waitlistService: WaitlistService,
  ) {}

  private parseHHmm(value: string): number {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }

  private toHHmm(minutes: number): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }

  async tryCreateForReleasedWindow(window: ReleasedWindow): Promise<any | null> {
    const releasedStart = this.parseHHmm(window.horaInicio);
    const releasedEnd = this.parseHHmm(window.horaFim);
    if (releasedEnd <= releasedStart) {
      return null;
    }

    const entries = await this.prisma.listaEspera.findMany({
      where: {
        barbeiroId: window.barbeiroId,
        dataDesejada: new Date(`${window.dateKey}T00:00:00.000Z`),
        status: StatusListaEspera.ATIVA,
        servico: { ativo: true },
      },
      select: {
        id: true,
        clienteId: true,
        servicoId: true,
        horaInicio: true,
        horaFim: true,
        dataEntrada: true,
        servico: { select: { duracaoMinutos: true, ativo: true } },
      },
      orderBy: [{ dataEntrada: 'asc' }, { id: 'asc' }],
    });

    for (const entry of entries) {
      if (!entry.servico.ativo) {
        continue;
      }

      const desiredStart = entry.horaInicio
        ? this.parseHHmm(entry.horaInicio)
        : releasedStart;
      const desiredEnd = entry.horaFim
        ? this.parseHHmm(entry.horaFim)
        : releasedEnd;
      const firstStart = Math.max(
        Math.ceil(Math.max(releasedStart, desiredStart) / SLOT_GRANULARITY_MINUTES) *
          SLOT_GRANULARITY_MINUTES,
      );
      const lastStart = Math.min(
        releasedEnd - entry.servico.duracaoMinutos,
        desiredEnd - entry.servico.duracaoMinutos,
      );

      const activeClaim = await this.prisma.waitlistClaim.findFirst({
        where: {
          listaEsperaId: entry.id,
          status: 'ATIVO',
          expiraEm: { gt: new Date() },
        },
        select: { id: true },
      });
      if (activeClaim) {
        continue;
      }

      for (
        let start = firstStart;
        start <= lastStart;
        start += SLOT_GRANULARITY_MINUTES
      ) {
        const horaInicio = this.toHHmm(start);
        const horaFim = this.toHHmm(start + entry.servico.duracaoMinutos);
        let eligible: any[];
        try {
          eligible = await this.waitlistService.findEligibleEntriesForSlot(
            window.barbeiroId,
            entry.servicoId,
            window.dateKey,
            horaInicio,
            horaFim,
          );
        } catch (error) {
          if (error instanceof NotFoundException || error instanceof ConflictException) {
            continue;
          }
          throw error;
        }
        if (!eligible.some((candidate) => candidate.id === entry.id)) {
          continue;
        }

        try {
          const claim = await this.waitlistService.claimNextEligibleEntryForSlot(
            window.barbeiroId,
            entry.servicoId,
            window.dateKey,
            horaInicio,
            horaFim,
          );
          return claim;
        } catch (error) {
          if (error instanceof NotFoundException || error instanceof ConflictException) {
            continue;
          }
          throw error;
        }
      }
    }

    return null;
  }
}