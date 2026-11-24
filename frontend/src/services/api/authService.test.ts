import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { authService } from './authService.ts'
import { authTokenStorage, http } from './http.ts'
import { pushSubscriptionService } from './pushSubscriptionService.ts'

type PostCall = [string, unknown, unknown]
type GetCall = [string, unknown]
type StreamCall = [string, unknown]

const originalPost = http.post
const originalGet = http.get
const originalGetStream = http.getStream
const mutableHttp = http as unknown as {
  post: (path: string, body?: unknown, options?: unknown) => Promise<unknown>
  get: (path: string, options?: unknown) => Promise<unknown>
  getStream: typeof http.getStream
}
let calls: PostCall[]
let getCalls: GetCall[]
let streamCalls: StreamCall[]
const originalTokenClear = authTokenStorage.clear
const originalPushCleanup = pushSubscriptionService.clearLocalSubscription
let tokenClearCalls: number
let pushCleanupCalls: number
let pushCleanupError: Error | null

beforeEach(() => {
  calls = []
  getCalls = []
  streamCalls = []
  tokenClearCalls = 0
  pushCleanupCalls = 0
  pushCleanupError = null
  pushSubscriptionService.clearLocalSubscription = async () => {
    pushCleanupCalls++
    if (pushCleanupError) throw pushCleanupError
  }
  authTokenStorage.clear = () => {
    tokenClearCalls++
  }
  mutableHttp.post = async (path, body, options) => {
    calls.push([path, body, options])
    return { message: 'ok' }
  }
  mutableHttp.get = async (path, options) => {
    getCalls.push([path, options])
    return { formato: 'Barbearia-App personal data v1' }
  }
  mutableHttp.getStream = async (path, options) => {
    streamCalls.push([path, options])
    return new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })
  }
})

afterEach(() => {
  mutableHttp.post = originalPost as unknown as typeof mutableHttp.post
  mutableHttp.get = originalGet as unknown as typeof mutableHttp.get
  mutableHttp.getStream = originalGetStream
  authTokenStorage.clear = originalTokenClear
  pushSubscriptionService.clearLocalSubscription = originalPushCleanup
})

describe('authService endpoint contracts', () => {
  it('clears local auth state and attempts push cleanup even if server logout fails', async () => {
    mutableHttp.post = async (path) => {
      calls.push([path, undefined, undefined])
      throw new Error('Servidor indisponível')
    }

    await assert.rejects(authService.logout(), /Servidor indisponível/)
    assert.deepEqual(calls, [['/auth/logout', undefined, undefined]])
    assert.equal(tokenClearCalls, 1)
    assert.equal(pushCleanupCalls, 1)
  })

  it('does not let local push cleanup failure prevent server logout', async () => {
    pushCleanupError = new Error('Falha local')
    const originalWarn = console.warn
    console.warn = () => {}

    try {
      await authService.logout()
    } finally {
      console.warn = originalWarn
    }

    assert.deepEqual(calls, [['/auth/logout', undefined, undefined]])
    assert.equal(tokenClearCalls, 1)
  })

  it('clears local auth state and attempts push cleanup on successful logout', async () => {
    await authService.logout()

    assert.deepEqual(calls, [['/auth/logout', undefined, undefined]])
    assert.equal(tokenClearCalls, 1)
    assert.equal(pushCleanupCalls, 1)
  })

  it('requires previous local push cleanup before authenticating a new session', async () => {
    pushCleanupError = new Error('Falha local')

    await assert.rejects(
      authService.login({ telefone: '11999999999', senha: 'senha' }),
      /Não foi possível limpar a inscrição anterior de notificações/,
    )

    assert.deepEqual(calls, [])
    assert.equal(pushCleanupCalls, 1)
  })

  it('marks /auth/me as the canonical session-validation request', async () => {
    await authService.me()

    assert.deepEqual(getCalls, [
      ['/auth/me', { sessionValidation: true, signal: undefined }],
    ])
  })

  it('sends registration e-mail without an existing bearer token', async () => {
    const input = {
      nome: 'Cliente',
      telefone: '11999999999',
      senha: 'senha-segura',
      email: 'cliente@example.com',
    }

    await authService.register(input)

    assert.deepEqual(calls, [['/auth/register', input, { skipAuth: true }]])
  })

  it('requests verification with the current authenticated session', async () => {
    await authService.requestEmailVerification()

    assert.deepEqual(calls, [
      ['/auth/email/verification/request', undefined, undefined],
    ])
  })

  it('resends verification only after an explicit public request', async () => {
    const email = 'cliente@example.com'

    await authService.requestEmailVerificationResend(email)

    assert.deepEqual(calls, [
      [
        '/auth/email/verification/resend',
        { email },
        { skipAuth: true },
      ],
    ])
  })

  it('confirms e-mail with the exact public token', async () => {
    const token = 'A_b-'.repeat(10) + 'A_b'

    await authService.confirmEmail(token)

    assert.deepEqual(calls, [
      ['/auth/email/verification/confirm', { token }, { skipAuth: true }],
    ])
  })

  it('requests password recovery without sending or storing account state', async () => {
    const email = 'cliente@example.com'

    await authService.requestPasswordRecovery(email)

    assert.deepEqual(calls, [
      ['/auth/password-recovery', { email }, { skipAuth: true }],
    ])
  })

  it('preserves the reset token and sends only token and senha', async () => {
    const token = 'A'.repeat(43)
    const senha = 'novaSenha123'

    await authService.resetPassword(token, senha)

    assert.deepEqual(calls, [
      ['/auth/password-reset', { token, senha }, { skipAuth: true }],
    ])
  })

  it('exports the current account data through the authenticated endpoint', async () => {
    const controller = new AbortController()
    await authService.exportPersonalData(controller.signal)

    assert.deepEqual(getCalls, [])
    assert.deepEqual(streamCalls, [
      ['/users/me/export', { signal: controller.signal }],
    ])
  })
})