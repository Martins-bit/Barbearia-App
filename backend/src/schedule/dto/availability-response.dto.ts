export class AvailabilityResponseDto {
  /** Data civil consultada ("YYYY-MM-DD", calendário de São Paulo). */
  data: string;
  barbeiroId: number;
  duracaoMinutos: number;
  /** Horários iniciais livres na grade fixa de 15 minutos, "HH:mm" ordenado. */
  horariosLivres: string[];
}
