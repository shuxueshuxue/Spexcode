import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isMouseReport } from './pty-bridge.js'

test('PTY pointer reports never count as lifecycle activity', () => {
  assert.equal(isMouseReport('\x1b[<0;24;12M'), true, 'SGR press')
  assert.equal(isMouseReport('\x1b[<64;24;12m'), true, 'SGR wheel')
  assert.equal(isMouseReport('\x1b[M' + String.fromCharCode(32, 44, 40)), true, 'X10')
  assert.equal(isMouseReport('\x1b[32;44;40M'), true, 'URXVT')
  assert.equal(isMouseReport('\x1b[A'), false, 'arrow key')
  assert.equal(isMouseReport('\r'), false, 'enter')
})

test('coalesced pointer reports never count as lifecycle activity', () => {
  assert.equal(isMouseReport('\x1b[<0;10;4M\x1b[<0;10;4m'), true)
  assert.equal(isMouseReport('\x1b[<0;10;4M\r'), false)
})

test('PTY forwarding has no lifecycle side effect', () => {
  assert.match(
    readFileSync(new URL('./pty-bridge.ts', import.meta.url), 'utf8'),
    /export function forwardInput[\s\S]*?return accepted\n}/,
  )
  assert.doesNotMatch(
    readFileSync(new URL('./pty-bridge.ts', import.meta.url), 'utf8'),
    /forwardInput[\s\S]*markHumanPromptActive/,
  )
})
