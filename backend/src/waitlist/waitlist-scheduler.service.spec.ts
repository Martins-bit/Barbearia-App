import { Logger } from '@nestjs/common';
import {
  WaitlistSchedulerService,
  WAITLIST_EXPIRATION_INTERVAL_MS,
} from './waitlist-scheduler.service';

describe('WaitlistSchedulerService', () => {
  let waitlistService: any;
  let scheduler: WaitlistSchedulerService;
  let loggerLogSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    waitlistService = {
      processExpiredClaims: jest.fn(),
    };
    scheduler = new WaitlistSchedulerService(waitlistService);
    loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('possui frequência de intervalo configurada para 1 minuto (60.000 ms)', () => {
    expect(WAITLIST_EXPIRATION_INTERVAL_MS).toBe(60_000);
  });

  it('executa processExpiredClaims e registra log quando claims são expirados', async () => {
    waitlistService.processExpiredClaims.mockResolvedValue({
      expiredCount: 2,
      reofferedWindows: 2,
    });

    await scheduler.handleExpiredClaims();

    expect(waitlistService.processExpiredClaims).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Scheduler expirou 2 claim(s) e reofertou 2 janela(s).',
      ),
    );
  });

  it('não registra log informativo quando não há claims expirados no ciclo', async () => {
    waitlistService.processExpiredClaims.mockResolvedValue({
      expiredCount: 0,
      reofferedWindows: 0,
    });

    await scheduler.handleExpiredClaims();

    expect(waitlistService.processExpiredClaims).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).not.toHaveBeenCalled();
  });

  it('captura erro e registra log de erro sem lançar exceção', async () => {
    waitlistService.processExpiredClaims.mockRejectedValue(
      new Error('Falha de conexão com banco de dados'),
    );

    await expect(scheduler.handleExpiredClaims()).resolves.toBeUndefined();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Falha ao processar claims expirados na lista de espera',
      ),
      expect.any(String),
    );
  });
});
