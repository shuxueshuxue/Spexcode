import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ProtocolError, openProtocol } from './index.js'

test('open rejects a relative database path before consulting process state', () => {
  assert.throws(
    () => openProtocol('relative.sqlite'),
    (error: unknown) => error instanceof ProtocolError && error.code === 'PROTOCOL_PATH_NOT_ABSOLUTE',
    'openProtocol accepted a relative database path instead of raising PROTOCOL_PATH_NOT_ABSOLUTE',
  )
})
