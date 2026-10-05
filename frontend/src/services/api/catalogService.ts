import { http } from './http'
import type { Barbeiro, Servico, Disponibilidade } from '../../types/domain'

/** Barbeiros elegíveis para escolha. GET /barbers. */
export const barbersService = {
  list(signal?: AbortSignal): Promise<Barbeiro[]> {
    return http.get<Barbeiro[]>('/barbers', { signal })
  },
}

/** Serviços ativos de um barbeiro. GET /services?barbeiroId=. */
export const servicesService = {
  listByBarber(barbeiroId: number, signal?: AbortSignal): Promise<Servico[]> {
    return http.get<Servico[]>('/services', { query: { barbeiroId }, signal })
  },
  listOwn(signal?: AbortSignal): Promise<Servico[]> {
    return http.get<Servico[]>('/services/admin', { signal })
  },
  create(
    payload: {
      nome: string
      descricao?: string | null
      duracaoMinutos: number
      preco: string
    },
    signal?: AbortSignal,
  ): Promise<Servico> {
    return http.post<Servico>('/services', payload, { signal })
  },
  update(
    serviceId: number,
    payload: {
      nome?: string
      descricao?: string | null
      duracaoMinutos?: number
      preco?: string
    },
    signal?: AbortSignal,
  ): Promise<Servico> {
    return http.patch<Servico>(`/services/${serviceId}`, payload, { signal })
  },
  updateStatus(serviceId: number, ativo: boolean, signal?: AbortSignal): Promise<Servico> {
    return http.patch<Servico>(`/services/${serviceId}/status`, { ativo }, { signal })
  },
}

export interface AvailabilityQuery {
  data: string
  servicoId: number
  barbeiroId?: number
}

/** Disponibilidade de um barbeiro. GET /availability. */
export const availabilityService = {
  get(query: AvailabilityQuery, signal?: AbortSignal): Promise<Disponibilidade> {
    return http.get<Disponibilidade>('/availability', {
      query: { ...query },
      signal,
    })
  },
}
