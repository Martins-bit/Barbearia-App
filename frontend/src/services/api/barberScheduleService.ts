import { http } from './http'
import type { HorarioFuncionamento } from '../../types/domain'

export interface HorarioFuncionamentoInput {
  diaSemana: number
  horaInicio: string
  horaFim: string
  ativo?: boolean
}

export const barberScheduleService = {
  listBusinessHours(signal?: AbortSignal): Promise<HorarioFuncionamento[]> {
    return http.get<HorarioFuncionamento[]>('/business-hours', { signal })
  },

  replaceBusinessHours(
    horarios: HorarioFuncionamentoInput[],
    signal?: AbortSignal,
  ): Promise<HorarioFuncionamento[]> {
    return http.put<HorarioFuncionamento[]>(
      '/business-hours',
      { horarios },
      { signal },
    )
  },
}