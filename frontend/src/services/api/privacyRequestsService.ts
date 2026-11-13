import type {
  CategoriaSolicitacaoTitular,
  PaginaSolicitacoesTitular,
  SolicitacaoTitular,
} from '../../types/domain'
import { http } from './http.ts'

const PRIVACY_REQUESTS_ENDPOINT = '/users/me/requests'

interface ListPrivacyRequestsOptions {
  limit?: number
  cursor?: number
  signal?: AbortSignal
}

export const privacyRequestsService = {
  create(
    categoria: CategoriaSolicitacaoTitular,
    idempotencyKey: string,
  ): Promise<SolicitacaoTitular> {
    return http.post<SolicitacaoTitular>(
      PRIVACY_REQUESTS_ENDPOINT,
      { categoria },
      { idempotencyKey },
    )
  },

  listMine({
    limit,
    cursor,
    signal,
  }: ListPrivacyRequestsOptions = {}): Promise<PaginaSolicitacoesTitular> {
    return http.get<PaginaSolicitacoesTitular>(PRIVACY_REQUESTS_ENDPOINT, {
      query: { limit, cursor },
      signal,
    })
  },
}
