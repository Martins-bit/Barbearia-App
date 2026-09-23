import { http } from './http'
import type { Barbeiro, Servico, Disponibilidade } from '../../types/domain'

/** Barbeiros elegíveis para escolha. GET /barbers. */
export const barbersService = {
  list(): Promise<Barbeiro[]> {
    return http.get<Barbeiro[]>('/barbers')
  },
}

/** Serviços ativos de um barbeiro. GET /services?barbeiroId=. */
export const servicesService = {
  listByBarber(barbeiroId: number): Promise<Servico[]> {
    return http.get<Servico[]>('/services', { query: { barbeiroId } })
  },
}

export interface AvailabilityQuery {
  data: string
  servicoId: number
  barbeiroId?: number
}

/** Disponibilidade de um barbeiro. GET /availability. */
export const availabilityService = {
  get(query: AvailabilityQuery): Promise<Disponibilidade> {
    return http.get<Disponibilidade>('/availability', { query: { ...query } })
  },
}
