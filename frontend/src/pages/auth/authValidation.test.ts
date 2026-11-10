import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError } from '../../services/api/ApiError.ts'
import {
  authRequestErrorMessage,
  isValidEmail,
  PASSWORD_RECOVERY_ACCEPTED_MESSAGE,
  validatePasswordReset,
} from './authValidation.ts'

describe('auth form validation', () => {
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