import { ApiError, parseApiErrorMessage } from './ApiError.ts'

const API_BASE_URL = import.meta.env?.VITE_API_URL ?? 'http://localhost:3000'

export const TOKEN_STORAGE_KEY = 'bb.auth.token'
export const AUTH_SESSION_CHANGED_EVENT = 'bb:auth:session-changed'

function notifyAuthSessionChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT))
  }
}

/** Armazenamento do token JWT (placeholder até a etapa de autenticação). */
export const authTokenStorage = {
  get(): string | null {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  },
  set(token: string): void {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
  },
  clear(): void {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    notifyAuthSessionChanged()
  },
}

export function subscribeToAuthSessionChanges(handler: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === TOKEN_STORAGE_KEY || event.key === null) handler()
  }

  window.addEventListener('storage', onStorage)
  window.addEventListener(AUTH_SESSION_CHANGED_EVENT, handler)

  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, handler)
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** Corpo JSON enviado no request. */
  body?: unknown
  /** Query string (valores já serializáveis). */
  query?: Record<string, string | number | boolean | undefined>
  /** Envia o header Authorization com o token atual. */
  auth?: boolean
  /** Desabilita o header Authorization mesmo com token presente (ex.: login). */
  skipAuth?: boolean
  /** Chave de idempotência enviada como cabeçalho, nunca persistida. */
  idempotencyKey?: string
  signal?: AbortSignal
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\//, ''), `${API_BASE_URL}/`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

/**
 * Cliente HTTP central da camada de API. Trata JSON, header Authorization,
 * query string e normaliza erros em ApiError (com a mensagem pública do
 * backend). Único ponto de saída HTTP do frontend.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    auth = true,
    skipAuth = false,
    idempotencyKey,
    signal,
  } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  if (auth && !skipAuth) {
    const token = authTokenStorage.get()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch {
    throw new ApiError(
      'Não foi possível conectar ao servidor. Verifique sua conexão.',
      0,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json')
  const payload = isJson ? await response.json().catch(() => null) : null

  if (!response.ok) {
    if (response.status === 401 && auth && !skipAuth && authTokenStorage.get()) {
      authTokenStorage.clear()
    }
    const message =
      parseApiErrorMessage(payload) ??
      'Ocorreu um erro ao processar a solicitação.'
    throw new ApiError(message, response.status, payload)
  }

  return payload as T
}

export const http = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE', body }),
}
