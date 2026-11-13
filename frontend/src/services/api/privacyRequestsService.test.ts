import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authTokenStorage } from './http.ts'
import { privacyRequestsService } from './privacyRequestsService.ts'
import type {
  CategoriaSolicitacaoTitular,
  PaginaSolicitacoesTitular,
  SolicitacaoTitular,
} from '../../types/domain'

interface CapturedRequest {
  url: string
  init?: RequestInit
}

function installFetchMock(
  respond: (request: CapturedRequest) => Response,
): { requests: CapturedRequest[]; restore: () => void } {
  const requests: CapturedRequest[] = []
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  )
  const values = new Map<string, string>()

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  authTokenStorage.set('privacy-request-test-token')
  globalThis.fetch = async (input, init) => {
    const request = { url: String(input), init }
    requests.push(request)
    return respond(request)
  }

  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch
      if (originalStorage) {
        Object.defineProperty(globalThis, 'localStorage', originalStorage)
      } else {
        Reflect.deleteProperty(globalThis, 'localStorage')
      }
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('creates requests using the approved category, UUID header and authenticated endpoint', async () => {
  const categories: CategoriaSolicitacaoTitular[] = [
    'ACESSO_EXPORTACAO',
    'CORRECAO',
    'EXCLUSAO_ANONIMIZACAO',
    'OUTRA',
  ]
  const calls: Array<{
    category: CategoriaSolicitacaoTitular
    key: string | null
    authorization: string | null
    body: unknown
  }> = []
  const mock = installFetchMock(({ init }) => {
    const headers = new Headers(init?.headers)
    calls.push({
      category: JSON.parse(String(init?.body)).categoria as CategoriaSolicitacaoTitular,
      key: headers.get('Idempotency-Key'),
      authorization: headers.get('Authorization'),
      body: JSON.parse(String(init?.body)),
    })
    const index = calls.length - 1
    const response: SolicitacaoTitular = {
      id: index + 1,
      categoria: categories[index],
      status: 'RECEBIDA',
      dataCriacao: '2026-11-12T10:00:00.000Z',
    }
    return jsonResponse(response, 201)
  })

  try {
    for (const [index, category] of categories.entries()) {
      const key = `b8c5a1d2-8f31-4db4-a768-29e4bc1a${String(index).padStart(4, '0')}`
      const response = await privacyRequestsService.create(category, key)
      assert.equal(response.categoria, category)
    }

    assert.equal(mock.requests.length, categories.length)
    for (const [index, call] of calls.entries()) {
      assert.equal(mock.requests[index].url.endsWith('/users/me/requests'), true)
      assert.equal(call.category, categories[index])
      assert.equal(call.key, `b8c5a1d2-8f31-4db4-a768-29e4bc1a${String(index).padStart(4, '0')}`)
      assert.equal(call.authorization, 'Bearer privacy-request-test-token')
      assert.deepEqual(call.body, { categoria: categories[index] })
    }
  } finally {
    mock.restore()
  }
})

test('lists only through the own-requests endpoint and sends cursor pagination', async () => {
  const response: PaginaSolicitacoesTitular = {
    solicitacoes: [],
    proximoCursor: 55,
  }
  const mock = installFetchMock(() => jsonResponse(response))

  try {
    const page = await privacyRequestsService.listMine({
      limit: 20,
      cursor: 31,
    })
    const url = new URL(mock.requests[0].url)

    assert.deepEqual(page, response)
    assert.equal(url.pathname, '/users/me/requests')
    assert.equal(url.searchParams.get('limit'), '20')
    assert.equal(url.searchParams.get('cursor'), '31')
    assert.equal(
      new Headers(mock.requests[0].init?.headers).get('Authorization'),
      'Bearer privacy-request-test-token',
    )
  } finally {
    mock.restore()
  }
})

test('does not hide authentication errors from the shared HTTP client', async () => {
  const mock = installFetchMock(() =>
    jsonResponse({ message: 'Não autorizado.' }, 401),
  )

  try {
    await assert.rejects(privacyRequestsService.listMine(), (error: unknown) => {
      return (
        error instanceof Error &&
        error.message === 'Não autorizado.' &&
        'status' in error &&
        error.status === 401
      )
    })
  } finally {
    mock.restore()
  }
})
