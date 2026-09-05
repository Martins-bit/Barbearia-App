import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistService } from './waitlist.service';
import { WaitlistOpportunityService } from './waitlist-opportunity.service';

function buildPrismaMock() {
  return {
    listaEspera: { findMany: jest.fn() },
    waitlistClaim: { findFirst: jest.fn() },
  };
}

describe('WaitlistOpportunityService', () => {
  let prisma: any;
  let waitlistService: any;
  let service: WaitlistOpportunityService;

  const releasedWindow = {
    barbeiroId: 10,
    dateKey: '2099-01-12',
    horaInicio: '10:00',
    horaFim: '11:00',
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    waitlistService = {
      findEligibleEntriesForSlot: jest.fn().mockResolvedValue([{ id: 1 }]),
      claimNextEligibleEntryForSlot: jest.fn().mockResolvedValue({
        id: 50,
        listaEsperaId: 1,
      }),
    };
    service = new WaitlistOpportunityService(
      prisma as unknown as PrismaService,
      waitlistService as unknown as WaitlistService,
    );
    prisma.listaEspera.findMany.mockResolvedValue([
      {
        id: 1,
        clienteId: 100,
        servicoId: 20,
        horaInicio: null,
        horaFim: null,
        dataEntrada: new Date('2099-01-01T00:00:00.000Z'),
        servico: { ativo: true, duracaoMinutos: 30 },
      },
    ]);
    prisma.waitlistClaim.findFirst.mockResolvedValue(null);
  });

  it('escolhe FIFO e o primeiro horário cronológico válido', async () => {
    await service.tryCreateForReleasedWindow(releasedWindow);

    expect(waitlistService.findEligibleEntriesForSlot).toHaveBeenNthCalledWith(
      1,
      10,
      20,
      '2099-01-12',
      '10:00',
      '10:30',
    );
    expect(waitlistService.claimNextEligibleEntryForSlot).toHaveBeenCalledWith(
      10,
      20,
      '2099-01-12',
      '10:00',
      '10:30',
    );
  });

  it('serviço menor cabe na janela e serviço maior não cabe', async () => {
    prisma.listaEspera.findMany.mockResolvedValue([
      {
        id: 1,
        clienteId: 100,
        servicoId: 20,
        horaInicio: null,
        horaFim: null,
        dataEntrada: new Date('2099-01-01T00:00:00.000Z'),
        servico: { ativo: true, duracaoMinutos: 30 },
      },
      {
        id: 2,
        clienteId: 101,
        servicoId: 21,
        horaInicio: null,
        horaFim: null,
        dataEntrada: new Date('2099-01-02T00:00:00.000Z'),
        servico: { ativo: true, duracaoMinutos: 90 },
      },
    ]);
    waitlistService.findEligibleEntriesForSlot.mockResolvedValue([]);

    await expect(service.tryCreateForReleasedWindow({
      ...releasedWindow,
      horaFim: '11:00',
    })).resolves.toBeNull();
    expect(waitlistService.claimNextEligibleEntryForSlot).not.toHaveBeenCalled();
  });

  it('respeita a faixa de horário desejada', async () => {
    prisma.listaEspera.findMany.mockResolvedValue([
      {
        id: 1,
        clienteId: 100,
        servicoId: 20,
        horaInicio: '10:30',
        horaFim: '11:00',
        dataEntrada: new Date('2099-01-01T00:00:00.000Z'),
        servico: { ativo: true, duracaoMinutos: 30 },
      },
    ]);

    await service.tryCreateForReleasedWindow(releasedWindow);

    expect(waitlistService.findEligibleEntriesForSlot).toHaveBeenCalledWith(
      10,
      20,
      '2099-01-12',
      '10:30',
      '11:00',
    );
  });

  it('não tenta nova oportunidade para entrada com claim ativo', async () => {
    prisma.waitlistClaim.findFirst.mockResolvedValue({ id: 40 });

    await expect(service.tryCreateForReleasedWindow(releasedWindow)).resolves.toBeNull();
    expect(waitlistService.findEligibleEntriesForSlot).not.toHaveBeenCalled();
    expect(waitlistService.claimNextEligibleEntryForSlot).not.toHaveBeenCalled();
  });

  it('trata ausência de candidato e slot ocupado como resultado normal', async () => {
    waitlistService.findEligibleEntriesForSlot
      .mockRejectedValueOnce(new NotFoundException())
      .mockRejectedValueOnce(new ConflictException());
    waitlistService.claimNextEligibleEntryForSlot.mockRejectedValue(
      new ConflictException(),
    );

    await expect(service.tryCreateForReleasedWindow({
      ...releasedWindow,
      horaFim: '12:00',
    })).resolves.toBeNull();
  });

  it('não engole erro de infraestrutura', async () => {
    const infrastructureError = new Error('database unavailable');
    waitlistService.findEligibleEntriesForSlot.mockRejectedValue(infrastructureError);

    await expect(service.tryCreateForReleasedWindow(releasedWindow)).rejects.toBe(
      infrastructureError,
    );
  });
});
