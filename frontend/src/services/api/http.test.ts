import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  authTokenStorage,
  http,
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

  it('clears and broadcasts an expired authenticated session after HTTP 401', async () => {
    const browser = installBrowserMocks()
    const changes: string[] = []
    const unsubscribe = subscribeToAuthSessionChanges(() => changes.push('changed'))
    authTokenStorage.set('expired-token')
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Não autorizado.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })

    await assert.rejects(http.get('/private'), /Não autorizado/)

    assert.equal(authTokenStorage.get(), null)
    assert.equal(browser.storage.getItem(TOKEN_STORAGE_KEY), null)
    assert.deepEqual(changes, ['changed'])
    unsubscribe()
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
