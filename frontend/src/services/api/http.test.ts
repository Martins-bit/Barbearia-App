import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ApiError } from './ApiError.ts'
import {
  authTokenStorage,
  http,
  subscribeToAuthSessionRevalidationRequests,
  subscribeToAuthSessionChanges,
  TOKEN_STORAGE_KEY,
} from './http.ts'

const originalFetch = globalThis.fetch
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'window',
)
const originalStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
)
const originalToken = globalThis.localStorage?.getItem(TOKEN_STORAGE_KEY) ?? null

function installBrowserMocks() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    keys: () => [...values.keys()],
  }
  const eventTarget = new EventTarget()
  const mockWindow = {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  }

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: mockWindow,
  })

  return {
    storage,
    dispatchStorage(key: string | null) {
      const event = new Event('storage')
      Object.defineProperty(event, 'key', { value: key })
      eventTarget.dispatchEvent(event)
    },
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
  if (originalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalStorageDescriptor)
    if (originalToken !== null) {
      globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, originalToken)
    } else {
      globalThis.localStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

describe('HTTP auth session handling', () => {
  it('stores only the bearer token and listens for current-session changes', () => {
    const { storage, dispatchStorage } = installBrowserMocks()
    let changeCount = 0
    const unsubscribe = subscribeToAuthSessionChanges(() => {
      changeCount++
    })

    authTokenStorage.set('test-token')
    assert.equal(authTokenStorage.get(), 'test-token')
    assert.deepEqual(storage.keys(), [TOKEN_STORAGE_KEY])

    dispatchStorage('unrelated-key')
    dispatchStorage(TOKEN_STORAGE_KEY)
    assert.equal(changeCount, 1)

    authTokenStorage.clear()
    assert.equal(authTokenStorage.get(), null)
    assert.equal(changeCount, 2)
    assert.deepEqual(storage.keys(), [])

    dispatchStorage(null)
    assert.equal(changeCount, 3)
    unsubscribe()
    dispatchStorage(TOKEN_STORAGE_KEY)
    assert.equal(changeCount, 3)
  })

  it('sends the token as Authorization header without persisting user data', async () => {
    installBrowserMocks()
    authTokenStorage.set('test-token')
    let requestHeaders: HeadersInit | undefined
    globalThis.fetch = async (_input, init) => {
      requestHeaders = init?.headers
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    await http.get('/private')

    assert.equal(new Headers(requestHeaders).get('Authorization'), 'Bearer test-token')
    assert.equal(globalThis.localStorage.getItem('user'), null)
  })

  it('streams successful responses without parsing JSON and forwards auth and abort signal', async () => {
    installBrowserMocks()
    authTokenStorage.set('stream-token')
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"ok":true}'))
        stream.close()
      },
    })
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    let requestHeaders: HeadersInit | undefined
    let requestSignal: AbortSignal | null | undefined
    response.json = async () => {
      throw new Error('Success response must remain unread as JSON')
    }
    globalThis.fetch = async (_input, init) => {
      requestHeaders = init?.headers
      requestSignal = init?.signal
      return response
    }

    const streamedResponse = await http.getStream('/users/me/export', {
      signal: controller.signal,
    })

    assert.equal(streamedResponse, response)
    assert.equal(
      new Headers(requestHeaders).get('Authorization'),
      'Bearer stream-token',
    )
    assert.equal(requestSignal, controller.signal)
    assert.equal(await streamedResponse.text(), '{"ok":true}')
  })

  it('revalidates the session instead of clearing it for a secondary HTTP 401', async () => {
    const browser = installBrowserMocks()
    const changes: string[] = []
    let revalidationCount = 0
    const unsubscribe = subscribeToAuthSessionChanges(() => changes.push('changed'))
    const unsubscribeRevalidation =
      subscribeToAuthSessionRevalidationRequests(() => revalidationCount++)
    authTokenStorage.set('expired-token')
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Não autorizado.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })

    await assert.rejects(http.get('/private'), /Não autorizado/)

    assert.equal(authTokenStorage.get(), 'expired-token')
    assert.equal(browser.storage.getItem(TOKEN_STORAGE_KEY), 'expired-token')
    assert.deepEqual(changes, [])
    assert.equal(revalidationCount, 1)
    unsubscribeRevalidation()
    unsubscribe()
  })

  it('clears the matching session only when canonical session validation returns 401', async () => {
    const browser = installBrowserMocks()
    const changes: string[] = []
    let revalidationCount = 0
    const unsubscribe = subscribeToAuthSessionChanges(() => changes.push('changed'))
    const unsubscribeRevalidation =
      subscribeToAuthSessionRevalidationRequests(() => revalidationCount++)
    authTokenStorage.set('invalid-session-token')
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Não autorizado.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })

    await assert.rejects(
      http.get('/auth/me', { sessionValidation: true }),
      /Não autorizado/,
    )

    assert.equal(authTokenStorage.get(), null)
    assert.equal(browser.storage.getItem(TOKEN_STORAGE_KEY), null)
    assert.deepEqual(changes, ['changed'])
    assert.equal(revalidationCount, 0)
    unsubscribeRevalidation()
    unsubscribe()
  })

  it('does not treat HTTP 403 as an expired session', async () => {
    const browser = installBrowserMocks()
    let revalidationCount = 0
    const unsubscribe =
      subscribeToAuthSessionRevalidationRequests(() => revalidationCount++)
    authTokenStorage.set('valid-session-token')
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Sem permissão.' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })

    await assert.rejects(http.get('/private'), /Sem permissão/)

    assert.equal(authTokenStorage.get(), 'valid-session-token')
    assert.equal(browser.storage.getItem(TOKEN_STORAGE_KEY), 'valid-session-token')
    assert.equal(revalidationCount, 0)
    unsubscribe()
  })

  it('does not let a stale 401 invalidate a newer session', async () => {
    installBrowserMocks()
    authTokenStorage.set('old-session-token')
    globalThis.fetch = async () => {
      authTokenStorage.set('new-session-token')
      return new Response(JSON.stringify({ message: 'Não autorizado.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }

    await assert.rejects(http.get('/private'), /Não autorizado/)

    assert.equal(authTokenStorage.get(), 'new-session-token')
  })

  it('preserves the session and HTTP error for streaming 401 responses', async () => {
    const browser = installBrowserMocks()
    authTokenStorage.set('expired-stream-token')
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Não autorizado.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })

    await assert.rejects(http.getStream('/users/me/export'), (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 401)
      assert.equal(error.message, 'Não autorizado.')
      return true
    })
    assert.equal(browser.storage.getItem(TOKEN_STORAGE_KEY), 'expired-stream-token')
  })

  it('preserves conflict and unavailable HTTP errors for streaming requests', async () => {
    installBrowserMocks()

    for (const [status, message] of [
      [409, 'Exportação já em andamento.'],
      [503, 'Exportação temporariamente indisponível.'],
    ] as const) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ message }), {
          status,
          headers: { 'content-type': 'application/json' },
        })

      await assert.rejects(http.getStream('/users/me/export'), (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, status)
        assert.equal(error.message, message)
        return true
      })
    }
  })

  it('does not convert an aborted streaming request into a connection error', async () => {
    installBrowserMocks()
    const controller = new AbortController()
    globalThis.fetch = async (_input, init) => {
      assert.equal(init?.signal, controller.signal)
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    await assert.rejects(
      http.getStream('/users/me/export', { signal: controller.signal }),
      (error: unknown) => {
        assert.equal(error instanceof ApiError, false)
        assert.ok(error instanceof Error)
        assert.equal(error.name, 'AbortError')
        return true
      },
    )
  })

  it('does not clear a session for a request explicitly marked public', async () => {
    installBrowserMocks()
    authTokenStorage.set('still-valid-token')
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Não autorizado.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })

    await assert.rejects(
      http.get('/public', { skipAuth: true }),
      /Não autorizado/,
    )
    assert.equal(authTokenStorage.get(), 'still-valid-token')
  })
})
