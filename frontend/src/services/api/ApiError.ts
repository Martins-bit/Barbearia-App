/** Erro normalizado da camada de API. */
export class ApiError extends Error {
  readonly status: number
  readonly details: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export const API_AVAILABILITY_CHANGED_EVENT = 'bb:api-availability-changed'

export function isApiUnavailableStatus(status: number): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504
}

export function isApiUnavailableError(error: unknown): error is ApiError {
  return error instanceof ApiError && isApiUnavailableStatus(error.status)
}

/** Extrai a mensagem legível de um corpo de erro do backend (Nest). */
export function parseApiErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim()) {
    return payload
  }
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message: unknown }).message
    if (typeof message === 'string') return message
    if (Array.isArray(message) && typeof message[0] === 'string') {
      return message[0]
    }
  }
  return null
}
