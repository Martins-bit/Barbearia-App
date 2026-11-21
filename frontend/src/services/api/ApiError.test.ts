import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApiError,
  isApiUnavailableError,
  isApiUnavailableStatus,
} from './ApiError.ts'

test('identifica falhas de conexão e indisponibilidade da API', () => {
  for (const status of [0, 502, 503, 504]) {
    assert.equal(isApiUnavailableStatus(status), true)
    assert.equal(
      isApiUnavailableError(new ApiError('indisponível', status)),
      true,
    )
  }
})

test('não trata validação ou autenticação como indisponibilidade', () => {
  for (const status of [400, 401, 403, 409, 422]) {
    assert.equal(isApiUnavailableStatus(status), false)
    assert.equal(
      isApiUnavailableError(new ApiError('erro comum', status)),
      false,
    )
  }
})
