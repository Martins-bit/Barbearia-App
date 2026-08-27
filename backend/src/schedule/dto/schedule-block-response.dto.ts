export class ScheduleBlockResponseDto {
  id: number;
  /** Data civil do bloqueio ("YYYY-MM-DD", calendário de São Paulo). */
  data: string;
  /** Horário local da barbearia ("HH:mm"). */
  horaInicio: string;
  horaFim: string;
  motivo: string | null;
  ativo: boolean;
}
