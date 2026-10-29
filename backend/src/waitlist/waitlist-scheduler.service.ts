import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WaitlistService } from './waitlist.service';

/** Frequência de verificação de claims expirados: a cada 1 minuto (60.000 ms). */
export const WAITLIST_EXPIRATION_INTERVAL_MS = 60 * 1000;

/**
 * Scheduler de expiração da lista de espera (ETAPA 5B).
 *
 * Executa periodicamente a cada 1 minuto chamando `WaitlistService.processExpiredClaims`.
 *
 * Características de resiliência e segurança:
 * - Primeira execução ocorre após o primeiro intervalo de 1 minuto (sem pico no startup).
 * - Erros são capturados e logados via Nest Logger sem interromper a aplicação.
 * - Idempotente: utiliza transação e advisory lock PostgreSQL (namespace 6),
 *   tornando seguro executar em múltiplas instâncias concorrentes.
 */
@Injectable()
export class WaitlistSchedulerService {
  private readonly logger = new Logger(WaitlistSchedulerService.name);

  constructor(private readonly waitlistService: WaitlistService) {}

  @Interval(WAITLIST_EXPIRATION_INTERVAL_MS)
  async handleExpiredClaims(): Promise<void> {
    try {
      const result = await this.waitlistService.processExpiredClaims(
        new Date(),
      );
      if (result.expiredCount > 0) {
        this.logger.log(
          `Scheduler expirou ${result.expiredCount} claim(s) e reofertou ${result.reofferedWindows} janela(s).`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Falha ao processar claims expirados na lista de espera; nova tentativa no próximo ciclo.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
