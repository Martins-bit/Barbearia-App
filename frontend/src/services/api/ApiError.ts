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
