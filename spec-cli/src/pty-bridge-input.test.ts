import assert from 'node:assert/strict'
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
