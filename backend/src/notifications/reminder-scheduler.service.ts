import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

/** Frequência do scheduler: a cada 5 minutos. */
const REMINDER_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Scheduler de lembretes (ETAPA 6I). Apenas dispara o motor da 6H
 * (`NotificationsService.processAppointmentReminders`) a cada 5 minutos;
 * nenhuma lógica de seleção de agendamentos é duplicada aqui.
 *
 * - Primeira execução ocorre apenas após o primeiro intervalo (sem disparo
 *   imediato no startup).
 * - Erros são capturados e logados (Nest Logger) sem relançar: uma falha não
 *   derruba a aplicação nem impede execuções futuras.
 * - Múltiplas instâncias da aplicação podem rodar simultaneamente: o motor é
 *   idempotente (transação + advisory lock transacional namespace 5), então
 *   nenhum lembrete é duplicado. Nenhum novo advisory lock é criado aqui.
 * - Não envia comunicação externa (e-mail/SMS/push); apenas cria notificações
 *   internas. O motor compara instantes, por isso recebe o instante real
 *   (`new Date()`) — sem timezone fake.
 */
@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @Interval(REMINDER_INTERVAL_MS)
  async handleReminders(): Promise<void> {
    try {
      const result = await this.notificationsService.processAppointmentReminders(
        new Date(),
      );
      if (result.created > 0) {
        this.logger.log(
          `Motor de lembretes criou ${result.created} notificação(ões) LEMBRETE.`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Falha ao processar lembretes de agendamento; nova execução ocorrerá no próximo intervalo.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}