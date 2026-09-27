import { http } from './http'
import type { Agendamento } from '../../types/domain'

/**
 * Criação de agendamento — POST /appointments (exclusivo do CLIENTE).
 * Contrato EXATO do backend (CreateAppointmentDto): barbeiroId, servicoId,
 * data ("YYYY-MM-DD"), horaInicio ("HH:mm") e observacoes opcional.
 * clienteId, status, duração e horaFim NÃO existem neste payload: são
 * decididos pelo servidor a partir do token e do serviço escolhido.
 */
export interface CreateAppointmentInput {
  barbeiroId: number
  servicoId: number
  data: string
  horaInicio: string
  observacoes?: string
}

export const appointmentsService = {
  create(input: CreateAppointmentInput): Promise<Agendamento> {
    return http.post<Agendamento>('/appointments', input)
  },

  /** GET /appointments/my — somente os agendamentos do cliente autenticado. */
  listMine(signal?: AbortSignal): Promise<Agendamento[]> {
    return http.get<Agendamento[]>('/appointments/my', { signal })
  },

  /**
   * PATCH /appointments/:id/cancel — sem corpo. As regras de cancelamento
   * (status e janela de tempo) pertencem ao backend; o frontend apenas reflete
   * o resultado ou a mensagem de erro devolvida.
   */
  cancel(id: number): Promise<Agendamento> {
    return http.patch<Agendamento>(`/appointments/${id}/cancel`)
  },
}