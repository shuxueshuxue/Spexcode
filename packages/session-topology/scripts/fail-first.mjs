import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openProtocol } from '@spexcode/session-protocol'
import { openTopology } from '../dist/index.js'

const databasePath = join(mkdtempSync(join(tmpdir(), 'session-topology-fail-first-')), 'state.sqlite')
const protocol = openProtocol(databasePath)
protocol.initialize('source-a')
protocol.initialize('subject-a')
const topology = openTopology(protocol)

protocol.withTransaction(tx => {
  topology.attach(tx, 'source-a', 'subject-a', 'parent')
  tx.enqueue('subject-a', { kind: 'relation.v1', body: Buffer.from('attached') })
})

assert.deepEqual(
  topology.recipients('subject-a'),
  ['source-a'],
  'FAIL-FIRST ASSERTION: committed attach must be visible to recipient resolution',
)
assert.equal(protocol.listPending('subject-a').length, 1)
protocol.close()
