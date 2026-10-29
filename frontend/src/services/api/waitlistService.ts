import { http } from './http'
import type {
  AceitarClaimResponse,
  CreateWaitlistInput,
  EntradaListaEspera,
  WaitlistClaim,
} from '../../types/domain'

export const waitlistService = {
  /** POST /waitlist — cliente solicita entrada na lista de espera. */
  create(input: CreateWaitlistInput): Promise<EntradaListaEspera> {
    return http.post<EntradaListaEspera>('/waitlist', input)
  },

  /** GET /waitlist/my — lista de espera do cliente autenticado. */
  listMine(signal?: AbortSignal): Promise<EntradaListaEspera[]> {
    return http.get<EntradaListaEspera[]>('/waitlist/my', { signal })
  },

  /** PATCH /waitlist/:id/cancel — cliente cancela solicitação ativa. */
  cancel(id: number): Promise<EntradaListaEspera> {
    return http.patch<EntradaListaEspera>(`/waitlist/${id}/cancel`)
  },

  /** POST /waitlist/claims/:id/accept — cliente aceita claim e confirma agendamento. */
  acceptClaim(claimId: number): Promise<AceitarClaimResponse> {
    return http.post<AceitarClaimResponse>(`/waitlist/claims/${claimId}/accept`)
  },

  /** POST /waitlist/claims/:id/reject — cliente recusa claim ofertado. */
  rejectClaim(claimId: number): Promise<WaitlistClaim> {
    return http.post<WaitlistClaim>(`/waitlist/claims/${claimId}/reject`)
  },

  /** GET /waitlist — lista de espera do barbeiro autenticado. */
  listForBarber(signal?: AbortSignal): Promise<EntradaListaEspera[]> {
    return http.get<EntradaListaEspera[]>('/waitlist', { signal })
  },
}
