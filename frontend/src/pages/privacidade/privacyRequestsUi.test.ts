import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '../../services/api/ApiError.ts'
import {
  formatPrivacyRequestDate,
  getOrCreatePrivacyRequestAttempt,
  privacyRequestCategories,
  privacyRequestCategoryLabel,
  privacyRequestCreatedMessage,
  privacyRequestErrorMessage,
  PrivacyRequestSubmissionGuard,
  privacyRequestStatusLabel,
} from './privacyRequestsUi.ts'

test('exposes exactly the approved categories and their interface labels', () => {
  assert.deepEqual(
    privacyRequestCategories.map(({ value, label }) => [value, label]),
    [
      ['ACESSO_EXPORTACAO', 'Acesso e exportação'],
      ['CORRECAO', 'Correção'],
      ['EXCLUSAO_ANONIMIZACAO', 'Exclusão ou anonimização'],
      ['OUTRA', 'Outras solicitações'],
    ],
  )
  assert.equal(privacyRequestCategoryLabel('CORRECAO'), 'Correção')
})

test('reuses an idempotency key only for a retry of the same category', () => {
  let generated = 0
  const createKey = () => `uuid-${++generated}`
  const first = getOrCreatePrivacyRequestAttempt('CORRECAO', null, createKey)
  const retry = getOrCreatePrivacyRequestAttempt('CORRECAO', first, createKey)
  const nextAttempt = getOrCreatePrivacyRequestAttempt(
    'OUTRA',
    first,
    createKey,
  )

  assert.strictEqual(retry, first)
  assert.equal(retry.idempotencyKey, 'uuid-1')
  assert.equal(nextAttempt.idempotencyKey, 'uuid-2')
  assert.equal(generated, 2)
})

test('blocks a duplicate submission while the first request is in progress', () => {
  const guard = new PrivacyRequestSubmissionGuard()

  assert.equal(guard.acquire(), true)
  assert.equal(guard.acquire(), false)
  guard.release()
  assert.equal(guard.acquire(), true)
})

test('creates UUID v4 keys using the platform cryptographic generator', () => {
  const attempt = getOrCreatePrivacyRequestAttempt('OUTRA', null)

  assert.match(
    attempt.idempotencyKey,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
})

test('formats received requests without implying that they were completed', () => {
  assert.equal(privacyRequestStatusLabel('RECEBIDA'), 'Recebida')
  assert.match(
    privacyRequestCreatedMessage({ status: 'RECEBIDA' }),
    /não a análise ou conclusão do pedido/i,
  )
  assert.match(
    formatPrivacyRequestDate('2026-11-12T10:00:00.000Z'),
    /\d/,
  )
  assert.equal(formatPrivacyRequestDate('data inválida'), 'data inválida')
})

test('gives clear feedback for expired sessions and network errors', () => {
  assert.match(
    privacyRequestErrorMessage(new ApiError('Não autorizado.', 401)),
    /sessão expirou/i,
  )
  assert.equal(
    privacyRequestErrorMessage(new ApiError('Sem conexão.', 0)),
    'Sem conexão.',
  )
  assert.match(privacyRequestErrorMessage(new Error('unexpected')), /Tente novamente/)
})
