import { ApiError, parseApiErrorMessage } from './ApiError'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const TOKEN_STORAGE_KEY = 'bb.auth.token'

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
  },
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
  const { method = 'GET', body, query, auth = true, skipAuth = false, signal } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

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
}
