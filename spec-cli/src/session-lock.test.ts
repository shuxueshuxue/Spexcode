import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { withDeliveryLocks } from './delivery-lock.js'
import { trySessionRecordLockSync, withSessionRecordLock } from './session-record-lock.js'

const isolatedHome = (): void => { process.env.SPEXCODE_HOME = mkdtempSync(join(tmpdir(), 'spex-lock-')) }

test('record lock excludes a second local writer and releases after the body', () => {
  isolatedHome()
  const release = trySessionRecordLockSync('lock-session')
  assert.ok(release)
  assert.equal(trySessionRecordLockSync('lock-session'), null)
  release!()
  assert.ok(trySessionRecordLockSync('lock-session'))
})

test('record lock releases when an async operation throws', async () => {
  isolatedHome()
  await assert.rejects(() => withSessionRecordLock('lock-session', async () => { throw new Error('boom') }), /boom/)
  assert.ok(trySessionRecordLockSync('lock-session'))
})

test('delivery locks acquire ids in sorted unique order and release on failure', async () => {
  isolatedHome()
  const seen: string[] = []
  await withDeliveryLocks(['b', 'a', 'b'], async () => { seen.push('body') })
  assert.deepEqual(seen, ['body'])
  await assert.rejects(() => withDeliveryLocks(['a'], async () => { throw new Error('delivery boom') }), /delivery boom/)
  await withDeliveryLocks(['a'], async () => { seen.push('reused') })
  assert.deepEqual(seen, ['body', 'reused'])
})
