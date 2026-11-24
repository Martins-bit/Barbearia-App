import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldOpenMessageMenuAbove } from './mensagemMenuPosition.ts'

test('message menu opens below when there is enough room', () => {
  assert.equal(
    shouldOpenMessageMenuAbove(
      { top: 180, bottom: 224 },
      { top: 100, bottom: 400 },
    ),
    false,
  )
})

test('message menu opens above near the bottom of the scrollport', () => {
  assert.equal(
    shouldOpenMessageMenuAbove(
      { top: 330, bottom: 374 },
      { top: 100, bottom: 400 },
    ),
    true,
  )
})

test('message menu opens on the side with more room when neither side fits', () => {
  assert.equal(
    shouldOpenMessageMenuAbove(
      { top: 170, bottom: 214 },
      { top: 100, bottom: 260 },
    ),
    true,
  )
  assert.equal(
    shouldOpenMessageMenuAbove(
      { top: 110, bottom: 154 },
      { top: 100, bottom: 260 },
    ),
    false,
  )
})
