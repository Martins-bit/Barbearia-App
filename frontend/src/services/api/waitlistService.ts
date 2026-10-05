import { http } from './http'
import type { EntradaListaEspera } from '../../types/domain'

export const waitlistService = {
  /** GET /waitlist — lista de espera do barbeiro autenticado. */
  listForBarber(signal?: AbortSignal): Promise<EntradaListaEspera[]> {
    return http.get<EntradaListaEspera[]>('/waitlist', { signal })
  },
}
