import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError } from '../../services/api/ApiError.ts'
import {
  authRequestErrorMessage,
  isValidEmail,
  normalizePhone,
  PASSWORD_RECOVERY_ACCEPTED_MESSAGE,
  redactTokenFromMessage,
  readAuthToken,
  registrationNameError,
  registrationPhoneError,
  removeVerificationTokenFromAddressBar,
  validatePasswordReset,
} from './authValidation.ts'

describe('auth form validation', () => {
  it('trims registration names and enforces the backend length range', () => {
    assert.equal(registrationNameError('  Ana Silva  '), null)
    assert.equal(registrationNameError('  '), 'Informe seu nome.')
    assert.match(registrationNameError('A') ?? '', /pelo menos 2 caracteres/)
    assert.match(
      registrationNameError('A'.repeat(121)) ?? '',
      /no máximo 120 caracteres/,
    )
  })

  it('normalizes formatted registration phones and requires 10 or 11 digits', () => {
    assert.equal(normalizePhone(' (11) 99999-9999 '), '11999999999')
    assert.equal(registrationPhoneError('11 99999-9999'), null)
    assert.equal(registrationPhoneError('(11) 3333-4444'), null)
    assert.match(
      registrationPhoneError('+55 11 99999-9999') ?? '',
      /DDD e 10 ou 11 dígitos/,
    )
    assert.notEqual(registrationPhoneError('11 9999-999a'), null)
    assert.notEqual(registrationPhoneError('123456789'), null)
    assert.notEqual(registrationPhoneError('119999999999'), null)
  })

  it('accepts a valid e-mail and rejects invalid or overlong values', () => {
    assert.equal(isValidEmail('cliente@example.com'), true)
    assert.equal(isValidEmail('not-an-email'), false)
    assert.equal(isValidEmail(`${'a'.repeat(245)}@example.com`), false)
    assert.equal(isValidEmail('nome..sobrenome@example.com'), false)
    assert.equal(isValidEmail('nome@example..com'), false)
    assert.equal(isValidEmail('nome@-example.com'), false)
    assert.equal(isValidEmail('nome.@example.com'), false)
  })

  it('does not promise delivery or reveal account existence after recovery request', () => {
    assert.match(PASSWORD_RECOVERY_ACCEPTED_MESSAGE, /poderão ser encaminhadas/)
    assert.doesNotMatch(PASSWORD_RECOVERY_ACCEPTED_MESSAGE, /serão encaminhadas/)
    assert.doesNotMatch(PASSWORD_RECOVERY_ACCEPTED_MESSAGE, /cadastrado|não existe/i)
  })

  it('prefills only a syntactically valid auth token from public email links', () => {
    const valid = 'A'.repeat(43)
    assert.equal(readAuthToken(new URLSearchParams(`token=${valid}`)), valid)
    assert.equal(readAuthToken(new URLSearchParams('token=curto')), '')
    assert.equal(readAuthToken(new URLSearchParams('token=bad token')), '')
  })

  it('removes the verification token from the URL without losing other URL state', () => {
    const calls: Array<[unknown, string, string | URL | null | undefined]> = []
    const state = { key: 'router-state' }
    const history: Pick<History, 'state' | 'replaceState'> = {
      state,
      replaceState: (data, unused, url) => calls.push([data, unused, url]),
    }

    removeVerificationTokenFromAddressBar(
      new URLSearchParams('before=1&token=secret&after=2'),
      { pathname: '/confirmar-email', hash: '#formulario' },
      history,
    )

    assert.deepEqual(calls, [
      [state, '', '/confirmar-email?before=1&after=2#formulario'],
    ])
  })

  it('removes an empty token parameter and leaves URLs without a token untouched', () => {
    const calls: string[] = []
    const history: Pick<History, 'state' | 'replaceState'> = {
      state: null,
      replaceState: (_data, _unused, url) => calls.push(String(url)),
    }
    const location = { pathname: '/confirmar-email', hash: '' }

    removeVerificationTokenFromAddressBar(
      new URLSearchParams('token=&next=1'),
      location,
      history,
    )
    removeVerificationTokenFromAddressBar(
      new URLSearchParams('next=1'),
      location,
      history,
    )

    assert.deepEqual(calls, ['/confirmar-email?next=1'])
  })

  it('does not expose the token if an API error message echoes it', () => {
    const token = 'A'.repeat(43)
    const fallback = 'Não foi possível confirmar o endereço.'

    assert.equal(
      redactTokenFromMessage(`Erro ao processar ${token}`, token, fallback),
      fallback,
    )
    assert.equal(
      redactTokenFromMessage('Muitas tentativas.', token, fallback),
      'Muitas tentativas.',
    )
  })

  it('validates password length in UTF-8 bytes and confirmation equality', () => {
    assert.match(validatePasswordReset('short', 'short') ?? '', /8 caracteres/)
    assert.match(
      validatePasswordReset('é'.repeat(37), 'é'.repeat(37)) ?? '',
      /72 bytes/,
    )
    assert.match(
      validatePasswordReset('senha-segura', 'senha-diferente') ?? '',
      /confirmação/,
    )
    assert.equal(validatePasswordReset('senha-segura', 'senha-segura'), null)
  })

  it('uses safe, actionable messages for auth HTTP statuses', () => {
    assert.match(
      authRequestErrorMessage(new ApiError('raw', 429), 'fallback'),
      /Muitas tentativas/,
    )
    assert.match(
      authRequestErrorMessage(new ApiError('raw', 503), 'fallback'),
      /indisponível/,
    )
    assert.equal(
      authRequestErrorMessage(new ApiError('E-mail inválido', 400), 'fallback'),
      'E-mail inválido',
    )
    assert.equal(authRequestErrorMessage(new Error('raw'), 'fallback'), 'fallback')
  })
})