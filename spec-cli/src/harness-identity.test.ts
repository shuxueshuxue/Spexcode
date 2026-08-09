import test from 'node:test'
import assert from 'node:assert/strict'
import { HARNESS_IDENTITIES } from '@spexcode/l0'
import { HARNESSES } from './harness.js'

test('full harness adapters project the one identity registry', () => {
  assert.deepEqual(
    HARNESSES.map(({ id, sessionEnvVar }) => ({ id, sessionEnvVar })),
    HARNESS_IDENTITIES,
  )
})
