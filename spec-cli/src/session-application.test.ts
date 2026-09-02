import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { jsonMigrationFencePath, MIGRATED_STATE_EVENT, openProjectSessionApplication } from '@spexcode/session-application'
import { resolveDatabasePath } from '@spexcode/session-selflaunch'
import { runtimeRoot } from '@spexcode/spec-core'

import { configuredSessionApplication, resetConfiguredSessionApplicationForTest, sessionApplicationCutoverState } from './session-application.js'

test('a marked store with legacy residue settles on its first canonical access, then reads as ready', () => {
  resetConfiguredSessionApplicationForTest()
  try {
    // the test worker pins the canonical database beside its isolated SPEXCODE_HOME; read it the way the backend does
    const databasePath = resolveDatabasePath()
    const home = dirname(databasePath)
    const recordsRoot = join(runtimeRoot(), 'sessions')
    mkdirSync(join(recordsRoot, 'legacy', 'timeline'), { recursive: true })
    // the old importer copied this row without its history, then the tree was left in place
    const seed = openProjectSessionApplication({ databasePath, locality: () => {} })
    seed.createSession({ sessionId: 'legacy', status: 'awaiting', updatedAtMs: 1_000 })
    seed.close()
    writeFileSync(`${databasePath}.json-migration.json`, JSON.stringify({ version: 1, sourceDigest: 'old-importer', records: 1, parentEdges: 0, watchEdges: 0, events: 1, orphanParents: [], backupRoot: join(home, 'backup'), markerPath: `${databasePath}.json-migration.json`, replayed: false }) + '\n')
    writeFileSync(jsonMigrationFencePath(recordsRoot), JSON.stringify({ version: 1, state: 'retired', sourceDigest: 'old-importer', pid: 1 }) + '\n')
    writeFileSync(join(recordsRoot, 'legacy', 'session.json'), JSON.stringify({ session_id: 'legacy', governed: true, worktree_path: '/tmp/legacy', branch: 'node/legacy', status: 'awaiting', parent: null, createdAt: 20 }))
    writeFileSync(join(recordsRoot, 'legacy', 'timeline', '000000000001.ndjson'), JSON.stringify({ kind: 'status', status: 'active', proposal: null, note: 'launched', ts: '2026-01-01T00:00:00.000Z' }) + '\n')

    assert.equal(sessionApplicationCutoverState(), 'residue')
    const application = configuredSessionApplication()
    assert.ok(application)
    assert.equal(sessionApplicationCutoverState(), 'ready')
    assert.deepEqual(readdirSync(join(recordsRoot, 'legacy')), ['runtime.json'])
    assert.equal(existsSync(join(home, 'backup', 'residue')), true)
    assert.equal(application.readState('legacy')?.status, 'awaiting')
    assert.deepEqual(application.readEvents('legacy').map(event => [event.type, event.ignorable]), [['session.state.changed.v1', false], [MIGRATED_STATE_EVENT, true]])
    // the settled root answers from memory: a second access does not rescan or re-run the importer
    assert.equal(configuredSessionApplication(), application)
  } finally {
    resetConfiguredSessionApplicationForTest()
  }
})
