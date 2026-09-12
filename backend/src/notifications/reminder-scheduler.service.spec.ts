import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';

describe('ReminderSchedulerService', () => {
  let service: ReminderSchedulerService;
  let notifications: { processAppointmentReminders: jest.Mock };
  let loggerError: jest.SpyInstance;
  let loggerLog: jest.SpyInstance;

  beforeEach(() => {
    notifications = {
      processAppointmentReminders: jest.fn().mockResolvedValue({ created: 0 }),
    };
    service = new ReminderSchedulerService(
      notifications as unknown as NotificationsService,
    );
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerLog = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  it('chama o motor da 6H exatamente uma vez por execução com um Date válido', async () => {
    await service.handleReminders();

    expect(notifications.processAppointmentReminders).toHaveBeenCalledTimes(1);
    const argument = notifications.processAppointmentReminders.mock.calls[0][0];
    expect(argument).toBeInstanceOf(Date);
    expect(Number.isNaN(argument.getTime())).toBe(false);
  });

  it('erro do motor é capturado, logado e não relançado; execução futura segue normal', async () => {
    notifications.processAppointmentReminders.mockRejectedValueOnce(
      new Error('falha no motor'),
    );

    await expect(service.handleReminders()).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalled();

    // Próxima execução (rejeição apenas uma vez) roda normalmente e loga
    // o resultado positivo do motor.
    notifications.processAppointmentReminders.mockResolvedValue({ created: 1 });
    await service.handleReminders();
    expect(notifications.processAppointmentReminders).toHaveBeenCalledTimes(2);
    expect(loggerLog).toHaveBeenCalled();
  });

  it('não duplica lógica de domínio: apenas delega ao motor e informa o resultado', async () => {
    notifications.processAppointmentReminders.mockResolvedValue({ created: 3 });

    await service.handleReminders();

    expect(loggerLog).toHaveBeenCalledWith(
      'Motor de lembretes criou 3 notificação(ões) LEMBRETE.',
    );
    expect(notifications.processAppointmentReminders).toHaveBeenCalledWith(
      expect.any(Date),
    );
  });
});