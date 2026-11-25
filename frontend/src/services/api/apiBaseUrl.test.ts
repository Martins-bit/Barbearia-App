import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveApiBaseUrl } from './apiBaseUrl.ts'

describe('resolveApiBaseUrl', () => {
  it('preserves the local development fallback only outside production', () => {
    assert.equal(resolveApiBaseUrl(undefined, false), 'http://localhost:3000')
    assert.throws(
      () => resolveApiBaseUrl(undefined, true),
      /VITE_API_URL é obrigatória/,
    )
    assert.throws(
      () => resolveApiBaseUrl('  ', true),
      /VITE_API_URL é obrigatória/,
    )
  })

  it('normalizes host casing, default port, and a single trailing slash', () => {
    assert.equal(
      resolveApiBaseUrl(' HTTPS://API.INVALID:443/ ', true),
      'https://api.invalid',
    )
  })

  it('accepts local HTTP only for development', () => {
    assert.equal(
      resolveApiBaseUrl('http://localhost:3000/', false),
      'http://localhost:3000',
    )
    assert.equal(
      resolveApiBaseUrl('http://127.0.0.1:3000', false),
      'http://127.0.0.1:3000',
    )
    assert.equal(
      resolveApiBaseUrl('http://192.168.1.7:3000', false),
      'http://192.168.1.7:3000',
    )
    assert.throws(
      () => resolveApiBaseUrl('http://192.168.1.8:3000', false),
      /VITE_API_URL deve ser/,
    )
    assert.throws(
      () => resolveApiBaseUrl('http://api.invalid', false),
      /VITE_API_URL deve ser/,
    )
    assert.throws(
      () => resolveApiBaseUrl('http://localhost:3000', true),
      /VITE_API_URL deve ser/,
    )
  })

  for (const value of [
    'not-a-url',
    'ftp://api.invalid',
    'https://user:pass@api.invalid',
    'https://@api.invalid',
    'https://*.api.invalid',
    'https://api.invalid/api',
    'https://api.invalid?key=value',
    'https://api.invalid#fragment',
    'https://api.invalid//',
  ]) {
    it(`rejects invalid URL bases: ${value}`, () => {
      assert.throws(
        () => resolveApiBaseUrl(value, true),
        /VITE_API_URL deve ser/,
      )
    })
  }
})
