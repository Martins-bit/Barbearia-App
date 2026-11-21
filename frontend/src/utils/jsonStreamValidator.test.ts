import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  JsonStreamValidationError,
  JsonStreamValidator,
} from './jsonStreamValidator.ts'

function validateUtf8Bytes(bytes: Uint8Array, chunkSize = bytes.byteLength): void {
  const validator = new JsonStreamValidator()
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    validator.write(bytes.subarray(offset, offset + chunkSize))
  }
  validator.finish()
}

function assertInvalidJson(bytes: Uint8Array): void {
  assert.throws(
    () => validateUtf8Bytes(bytes, 1),
    JsonStreamValidationError,
  )
}

describe('incremental JSON stream validation', () => {
  it('accepts nested JSON, numbers, escapes and UTF-8 split across chunks', () => {
    const text = String.raw`{"texto":"café 😀 \"ok\" \u2764","valores":[-1,0,1.25,1e-2,true,false,null,[],{}]}`

    assert.doesNotThrow(() =>
      validateUtf8Bytes(new TextEncoder().encode(text), 1),
    )
  })

  it('rejects empty, truncated, malformed and trailing JSON data', () => {
    for (const text of [
      '',
      '  \n',
      '{"a":1',
      '[true,]',
      '{"a":}',
      '"invalid\\q"',
      '01',
      '[1.]',
      '[-]',
      '[1e+]',
      'nul',
      'true false',
    ]) {
      assertInvalidJson(new TextEncoder().encode(text))
    }
  })

  it('rejects unescaped control characters, invalid UTF-8 and a leading BOM', () => {
    assertInvalidJson(new TextEncoder().encode('"line\nbreak"'))
    assertInvalidJson(new Uint8Array([0x22, 0xff, 0x22]))
    assertInvalidJson(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))
  })
})
