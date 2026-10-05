import { http } from './http'
import type { BloqueioAgenda } from '../../types/domain'

export interface CreateScheduleBlockInput {
  data: string
  horaInicio: string
  horaFim: string
  motivo?: string
}

export const scheduleBlocksService = {
  list(signal?: AbortSignal): Promise<BloqueioAgenda[]> {
    return http.get<BloqueioAgenda[]>('/schedule-blocks', { signal })
  },

  create(input: CreateScheduleBlockInput): Promise<BloqueioAgenda> {
    return http.post<BloqueioAgenda>('/schedule-blocks', input)
  },

  remove(id: number): Promise<{ removido: true }> {
    return http.delete<{ removido: true }>(`/schedule-blocks/${id}`)
  },
}