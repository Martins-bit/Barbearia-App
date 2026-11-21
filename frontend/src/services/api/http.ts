import {
  API_AVAILABILITY_CHANGED_EVENT,
  ApiError,
  isApiUnavailableStatus,
  parseApiErrorMessage,
} from './ApiError.ts'

const API_BASE_URL = import.meta.env?.VITE_API_URL ?? 'http://localhost:3000'

export const TOKEN_STORAGE_KEY = 'bb.auth.token'
export const AUTH_SESSION_CHANGED_EVENT = 'bb:auth:session-changed'
export const AUTH_SESSION_REVALIDATION_REQUIRED_EVENT =
  'bb:auth:session-revalidation-required'

function notifyAuthSessionChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT))
  }
}

function notifyAuthSessionRevalidationRequired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new Event(AUTH_SESSION_REVALIDATION_REQUIRED_EVENT),
    )
  }
}

function notifyApiAvailabilityChanged(available: boolean): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(API_AVAILABILITY_CHANGED_EVENT, {
        detail: { available },
      }),
    )
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

export function subscribeToAuthSessionRevalidationRequests(
  handler: () => void,
): () => void {
  window.addEventListener(AUTH_SESSION_REVALIDATION_REQUIRED_EVENT, handler)
  return () =>
    window.removeEventListener(
      AUTH_SESSION_REVALIDATION_REQUIRED_EVENT,
      handler,
    )
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
  /** Marca GET /auth/me como fonte canônica para confirmar uma sessão. */
  sessionValidation?: boolean
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

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  )
}

/**
 * Cliente HTTP central da camada de API. Trata JSON, header Authorization,
 * query string e normaliza erros em ApiError (com a mensagem pública do
 * backend). Único ponto de saída HTTP do frontend.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { response, tokenUsed } = await sendRequest(path, options)

  if (response.status === 204) {
    return undefined as T
  }

  if (!response.ok) {
    await throwHttpError(response, options, tokenUsed)
  }

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json')
  const payload = isJson ? await response.json().catch(() => null) : null
  return payload as T
}

async function requestStream(
  path: string,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
): Promise<Response> {
  const { response, tokenUsed } = await sendRequest(path, {
    ...options,
    method: 'GET',
  })
  await throwHttpError(response, options, tokenUsed)
  return response
}

interface SentRequest {
  response: Response
  tokenUsed: string | null
}

async function sendRequest(
  path: string,
  options: RequestOptions,
): Promise<SentRequest> {
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
  let tokenUsed: string | null = null
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  if (auth && !skipAuth) {
    tokenUsed = authTokenStorage.get()
    if (tokenUsed) headers.Authorization = `Bearer ${tokenUsed}`
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (
      signal?.aborted ||
      isAbortError(error)
    ) {
      throw error
    }
    notifyApiAvailabilityChanged(false)
    throw new ApiError(
      'Não foi possível conectar ao servidor. Verifique sua conexão.',
      0,
    )
  }

  notifyApiAvailabilityChanged(!isApiUnavailableStatus(response.status))
  return { response, tokenUsed }
}

async function throwHttpError(
  response: Response,
  options: Pick<RequestOptions, 'auth' | 'skipAuth' | 'sessionValidation'>,
  tokenUsed: string | null,
): Promise<void> {
  if (response.ok) return

  const { auth = true, skipAuth = false, sessionValidation = false } = options
  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json')
  const payload = isJson ? await response.json().catch(() => null) : null

  if (
    response.status === 401 &&
    auth &&
    !skipAuth &&
    tokenUsed &&
    authTokenStorage.get() === tokenUsed
  ) {
    if (sessionValidation) {
      authTokenStorage.clear()
    } else {
      notifyAuthSessionRevalidationRequired()
    }
  }

  const message =
    parseApiErrorMessage(payload) ??
    'Ocorreu um erro ao processar a solicitação.'
  throw new ApiError(message, response.status, payload)
}

export const http = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  getStream: (
    path: string,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ) => requestStream(path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE', body }),
}
