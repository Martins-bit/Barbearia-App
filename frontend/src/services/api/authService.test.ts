import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { authService } from './authService.ts'
import { http } from './http.ts'

type PostCall = [string, unknown, unknown]
type GetCall = [string, unknown]

const originalPost = http.post
const originalGet = http.get
const mutableHttp = http as unknown as {
  post: (path: string, body?: unknown, options?: unknown) => Promise<unknown>
  get: (path: string, options?: unknown) => Promise<unknown>
}
let calls: PostCall[]
let getCalls: GetCall[]

beforeEach(() => {
  calls = []
  getCalls = []
  mutableHttp.post = async (path, body, options) => {
    calls.push([path, body, options])
    return { message: 'ok' }
  }
  mutableHttp.get = async (path, options) => {
    getCalls.push([path, options])
    return { formato: 'Barbearia-App personal data v1' }
  }
})

afterEach(() => {
  mutableHttp.post = originalPost as unknown as typeof mutableHttp.post
  mutableHttp.get = originalGet as unknown as typeof mutableHttp.get
})

describe('authService endpoint contracts', () => {
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
    await authService.exportPersonalData()

    assert.deepEqual(getCalls, [['/users/me/export', undefined]])
  })
})