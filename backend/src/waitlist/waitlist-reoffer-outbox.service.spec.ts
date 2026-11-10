import { BadRequestException } from '@nestjs/common';
import { OrigemWaitlistReoffer } from '../generated/prisma/enums';
import { WaitlistOpportunityService } from './waitlist-opportunity.service';
import {
  MAX_WAITLIST_REOFFER_ATTEMPTS,
  WaitlistReofferOutboxService,
} from './waitlist-reoffer-outbox.service';
import { WAITLIST_REOFFER_HEARTBEAT_MS } from './waitlist-reoffer.constants';

function buildPrismaMock() {
  const prisma: any = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn((query: TemplateStringsArray) =>
      Promise.resolve(query.join('').includes('COALESCE(') ? 0 : 1),
    ),
    $transaction: jest.fn((callback: (tx: any) => unknown) => callback(prisma)),
    waitlistClaim: { findUnique: jest.fn() },
    waitlistReofferOutbox: { upsert: jest.fn() },
  };
  return prisma;
}

describe('WaitlistReofferOutboxService', () => {
  let prisma: any;
  let opportunityService: jest.Mocked<
    Pick<WaitlistOpportunityService, 'tryCreateForReleasedWindow'>
  >;
  let service: WaitlistReofferOutboxService;

  const job = {
    id: 21,
    attempts: 1,
    barbeiroId: 10,
    dateKey: '2099-01-12',
    horaInicio: '10:00',
    horaFim: '10:30',
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    prisma.waitlistClaim.findUnique.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValueOnce([job]).mockResolvedValue([]);
    opportunityService = {
      tryCreateForReleasedWindow: jest.fn().mockResolvedValue({
        id: 88,
        reofertaOutboxId: job.id,
      }),
    };
    service = new WaitlistReofferOutboxService(
      prisma,
      opportunityService as unknown as WaitlistOpportunityService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persiste evento com chave idempotente na transação fornecida', async () => {
    await service.enqueue(prisma, {
      idempotencyKey: 'claim-rejected:5',
      origin: OrigemWaitlistReoffer.CLAIM_RECUSADO,
      originId: 5,
      window: {
        barbeiroId: 10,
        dateKey: '2099-01-12',
        horaInicio: '10:00',
        horaFim: '10:30',
      },
    });

    expect(prisma.waitlistReofferOutbox.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chaveIdempotencia: 'claim-rejected:5' },
        create: expect.objectContaining({
          origem: OrigemWaitlistReoffer.CLAIM_RECUSADO,
          origemId: 5,
          barbeiroId: 10,
          data: new Date('2099-01-12T00:00:00.000Z'),
          horaInicio: '10:00',
          horaFim: '10:30',
        }),
        update: {},
      }),
    );
  });

  it('processa pendência, associa claim e conclui a tentativa', async () => {
    const result = await service.processPendingReoffers();

    expect(opportunityService.tryCreateForReleasedWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        barbeiroId: 10,
        dateKey: '2099-01-12',
        horaInicio: '10:00',
        horaFim: '10:30',
      }),
      job.id,
      job.attempts,
    );
    const completion = prisma.$executeRaw.mock.calls.find(
      ([query]: [TemplateStringsArray]) =>
        query.join('').includes('"ultimoErro" = NULL'),
    );
    expect(completion?.[0].join(' ')).toContain('"leaseAte" >');
    expect(completion?.[0].join(' ')).toContain('"tentativas" =');
    expect(result).toMatchObject({ claimedCount: 1, completedCount: 1 });
  });

  it('conclui sem repetição quando não há candidatos', async () => {
    opportunityService.tryCreateForReleasedWindow.mockResolvedValue(null);

    await service.processPendingReoffers();

    const completion = prisma.$executeRaw.mock.calls.find(
      ([query]: [TemplateStringsArray]) =>
        query.join('').includes('"resultado" = '),
    );
    expect(completion?.[0].join(' ')).toContain('"status" = ');
  });

  it('agenda retry com backoff e registra falha transitória', async () => {
    const failure = new Error('conexão indisponível');
    opportunityService.tryCreateForReleasedWindow.mockRejectedValue(failure);

    const before = Date.now();
    const result = await service.processPendingReoffers();
    const retryUpdate = prisma.$executeRaw.mock.calls.find(
      ([query]: [TemplateStringsArray]) =>
        query.join('').includes('"proximaTentativaEm" = '),
    );

    expect(result.retryCount).toBe(1);
    expect(retryUpdate?.[0].join(' ')).toContain('"status" = ');
    expect(retryUpdate?.[0].join(' ')).toContain('clock_timestamp()');
    expect(retryUpdate).toContain('Error: conexão indisponível');
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });

  it('continua processando outras pendências após falha individual', async () => {
    const secondJob = { ...job, id: 22, dateKey: '2099-01-13' };
    prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([job])
      .mockResolvedValueOnce([secondJob])
      .mockResolvedValue([]);
    opportunityService.tryCreateForReleasedWindow
      .mockRejectedValueOnce(new Error('falha na primeira pendência'))
      .mockResolvedValueOnce({ id: 89 });

    const result = await service.processPendingReoffers();

    expect(result).toMatchObject({
      claimedCount: 2,
      completedCount: 1,
      retryCount: 1,
    });
    expect(opportunityService.tryCreateForReleasedWindow).toHaveBeenCalledTimes(
      2,
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('reconhece claim criado antes de uma interrupção e não cria outro', async () => {
    prisma.waitlistClaim.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 88 });
    opportunityService.tryCreateForReleasedWindow.mockRejectedValue(
      new Error('interrupção após commit do claim'),
    );

    await service.processPendingReoffers();

    expect(
      prisma.$executeRaw.mock.calls.some(([query]: [TemplateStringsArray]) =>
        query.join('').includes('"ultimoErro" = NULL'),
      ),
    ).toBe(true);
  });

  it('encerra erro de negócio permanente sem nova tentativa', async () => {
    opportunityService.tryCreateForReleasedWindow.mockRejectedValue(
      new BadRequestException('janela inválida'),
    );

    const result = await service.processPendingReoffers();

    expect(result.permanentFailureCount).toBe(1);
    expect(result.retryCount).toBe(0);
    expect(
      prisma.$executeRaw.mock.calls.some(([query]: [TemplateStringsArray]) =>
        query.join('').includes('"resultado" = '),
      ),
    ).toBe(true);
  });

  it('usa SKIP LOCKED e lease para reservar e recuperar pendências abandonadas', async () => {
    await service.processPendingReoffers();

    const reservationCall = prisma.$queryRaw.mock.calls[0];
    const reservationQuery = reservationCall[0].join(' ');
    expect(reservationQuery).toContain('FOR UPDATE SKIP LOCKED');
    expect(reservationQuery).toContain('leaseAte');
    expect(reservationCall).toContain('PROCESSANDO');
    expect(reservationCall).toContain('PENDENTE');
  });

  it('renova somente o lease vigente da tentativa proprietária', async () => {
    const result = await (service as any).renewLease(job);
    const renewal = prisma.$executeRaw.mock.calls[0];
    const query = renewal[0].join(' ');

    expect(result).toBe(true);
    expect(query).toContain('"tentativas" =');
    expect(query).toContain('"leaseAte" > (clock_timestamp()');
    expect(query).toContain('clock_timestamp()');
    expect(renewal).toContain(job.id);
    expect(renewal).toContain(job.attempts);
  });

  it('renova periodicamente o lease enquanto o worker aguarda o processamento', async () => {
    jest.useFakeTimers();
    let releaseProcessing!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const processingGate = new Promise<void>((resolve) => {
      releaseProcessing = resolve;
    });
    opportunityService.tryCreateForReleasedWindow.mockImplementation(
      async () => {
        signalStarted();
        await processingGate;
        return { id: 88 };
      },
    );

    const processing = service.processPendingReoffers();
    await started;
    await jest.advanceTimersByTimeAsync(WAITLIST_REOFFER_HEARTBEAT_MS);
    releaseProcessing();
    await processing;
    jest.useRealTimers();

    expect(
      prisma.$executeRaw.mock.calls.some(([query]: [TemplateStringsArray]) =>
        query.join('').includes('"leaseAte" > (clock_timestamp()'),
      ),
    ).toBe(true);
  });

  it('rejeita renovação de tentativa antiga ou lease vencido', async () => {
    prisma.$executeRaw.mockResolvedValue(0);

    await expect(
      (service as any).renewLease({ ...job, attempts: 0 }),
    ).resolves.toBe(false);
    await expect((service as any).renewLease(job)).resolves.toBe(false);
    expect(prisma.$executeRaw.mock.calls[0][0].join(' ')).toContain(
      '"leaseAte" > (clock_timestamp()',
    );
    expect(prisma.$executeRaw.mock.calls[0]).toContain(0);
  });

  it('fenceia conclusão, retry e falha quando a tentativa perdeu o lease', async () => {
    prisma.$executeRaw.mockResolvedValue(0);

    await expect((service as any).complete(job, 'CLAIM_CRIADO')).resolves.toBe(
      false,
    );
    await expect(
      (service as any).scheduleRetry(job, new Error('retry')),
    ).resolves.toBe(false);
    await expect(
      (service as any).failPermanently(job, new Error('final')),
    ).resolves.toBe(false);

    for (const [query] of prisma.$executeRaw.mock.calls) {
      expect(query.join(' ')).toContain('"tentativas" =');
      expect(query.join(' ')).toContain('"leaseAte" > (clock_timestamp()');
    }
  });

  it('encerra com FALHA_FINAL na décima tentativa', async () => {
    const finalAttempt = { ...job, attempts: MAX_WAITLIST_REOFFER_ATTEMPTS };
    prisma.$queryRaw.mockReset().mockResolvedValueOnce([finalAttempt]);
    opportunityService.tryCreateForReleasedWindow.mockRejectedValue(
      new Error('falha persistente'),
    );

    const result = await service.processPendingReoffers();
    const permanentFailure = prisma.$executeRaw.mock.calls.find(
      (call: unknown[]) =>
        call.some((value) => value === 'Error: falha persistente'),
    );

    expect(result).toMatchObject({
      retryCount: 0,
      permanentFailureCount: 1,
    });
    expect(permanentFailure).toContain('Error: falha persistente');
  });

  it('não conta conclusão quando o fencing atualiza zero linhas', async () => {
    prisma.$executeRaw.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const result = await service.processPendingReoffers();

    expect(result).toMatchObject({
      claimedCount: 1,
      completedCount: 0,
      retryCount: 0,
      permanentFailureCount: 0,
    });
  });

  it('não conta retry quando o fencing rejeita a atualização de estado', async () => {
    prisma.$executeRaw.mockImplementation((query: TemplateStringsArray) =>
      Promise.resolve(
        query.join('').includes('COALESCE(') ||
          query.join('').includes('"proximaTentativaEm" = ')
          ? 0
          : 1,
      ),
    );
    opportunityService.tryCreateForReleasedWindow.mockRejectedValue(
      new Error('falha transitória'),
    );

    const result = await service.processPendingReoffers();

    expect(result.retryCount).toBe(0);
    expect(result.permanentFailureCount).toBe(0);
  });

  it('não conta falha final quando o fencing rejeita a atualização de estado', async () => {
    prisma.$executeRaw.mockImplementation((query: TemplateStringsArray) =>
      Promise.resolve(
        query.join('').includes('COALESCE(') ||
          query.join('').includes('"ultimoErro" = ')
          ? 0
          : 1,
      ),
    );
    opportunityService.tryCreateForReleasedWindow.mockRejectedValue(
      new BadRequestException('erro permanente'),
    );

    const result = await service.processPendingReoffers();

    expect(result.retryCount).toBe(0);
    expect(result.permanentFailureCount).toBe(0);
  });

  it('encerra leases abandonados que já consumiram dez tentativas', async () => {
    prisma.$executeRaw.mockResolvedValueOnce(1);
    const result = await service.processPendingReoffers();
    const exhaustedSweep = prisma.$executeRaw.mock.calls[0];

    expect(result.permanentFailureCount).toBe(1);
    expect(exhaustedSweep[0].join(' ')).toContain('"tentativas" >=');
    expect(exhaustedSweep[0].join(' ')).toContain('"leaseAte" <=');
    expect(exhaustedSweep).toContain(MAX_WAITLIST_REOFFER_ATTEMPTS);
    expect(exhaustedSweep).toContain('FALHA_FINAL');
  });
});
