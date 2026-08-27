export class BusinessHourResponseDto {
  id: number;
  diaSemana: number;
  /** Horário local da barbearia ("HH:mm"). */
  horaInicio: string;
  horaFim: string;
  ativo: boolean;
}
