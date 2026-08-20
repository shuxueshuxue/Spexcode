import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  ProtocolError,
  applyComponentMigrations,
  openProtocol,
} from './index.js'
import type { ComponentMigration, SessionProtocol } from './index.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new(path: string) => {
    prepare(sql: string): {
      get(...params: unknown[]): Record<string, unknown> | undefined
      all(...params: unknown[]): Record<string, unknown>[]
      run(...params: unknown[]): unknown
    }
    close(): void
  }
}

const roots: string[] = []
const freshDb = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'session-protocol-production-'))
  roots.push(root)
  return join(root, 'protocol.sqlite')
}
process.on('exit', () => {
  for (const root of roots) {
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

const errorOf = (body: () => unknown): ProtocolError => {
  try {
    body()
    assert.fail('expected ProtocolError')
  } catch (error) {
    assert.ok(error instanceof ProtocolError, String(error))
    return error
  }
}

test('the published entry has every required runtime export and no extra runtime export', async () => {
  const entry = await import('./index.js')
  assert.deepEqual(Object.keys(entry).sort(), [
    'LIMITS',
    'MIN_SQLITE_VERSION',
    'PROTOCOL_VERSION',
    'ProtocolError',
    'applyComponentMigrations',
    'canonicalPreimage',
    'openProtocol',
    'payloadHash',
  ])

  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  assert.deepEqual(packageJson.exports, { '.': './dist/index.js', './package.json': './package.json' })
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.dependencies, undefined)

  const declarations = readFileSync(join(packageRoot, 'dist', 'index.d.ts'), 'utf8')
  for (const name of [
    'SqlParam', 'MessageInput', 'Message', 'SessionAddress', 'ProtocolTransaction', 'SessionProtocol',
    'OpenOptions', 'ProtocolError', 'ProtocolErrorCode', 'ComponentMigration', 'applyComponentMigrations',
    'PROTOCOL_VERSION', 'MIN_SQLITE_VERSION', 'LIMITS', 'canonicalPreimage', 'payloadHash', 'openProtocol',
  ]) {
    assert.match(declarations, new RegExp(`\\b${name}\\b`), `${name} is absent from declarations`)
  }
  for (const name of ['DatabaseSync', 'inspectProtocol', 'openSessionDatabase', 'nodeSqliteDriver', 'queryPlans']) {
    assert.doesNotMatch(declarations, new RegExp(`\\b${name}\\b`), `${name} leaked through declarations`)
  }
})

test('ProtocolErrorCode is exactly the frozen set of 22 codes', () => {
  const source = readFileSync(new URL('errors.ts', import.meta.url), 'utf8')
  const actual = [...source.matchAll(/\| '(PROTOCOL_[A-Z_]+)'/g)].map(match => match[1]).sort()
  const expected = [
    'PROTOCOL_PATH_NOT_ABSOLUTE', 'PROTOCOL_PATH_INVALID', 'PROTOCOL_PATH_PARENT_MISSING',
    'PROTOCOL_SQLITE_VERSION_UNSUPPORTED', 'PROTOCOL_JOURNAL_MODE_UNSUPPORTED', 'PROTOCOL_PRAGMA_UNSUPPORTED',
    'PROTOCOL_SCHEMA_CHECKSUM_MISMATCH', 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED',
    'PROTOCOL_SCHEMA_REGISTRY_INCONSISTENT', 'PROTOCOL_SESSION_ID_INVALID', 'PROTOCOL_SESSION_UNKNOWN',
    'PROTOCOL_SESSION_RETIRED', 'PROTOCOL_RETIRE_NON_EMPTY', 'PROTOCOL_IDEMPOTENCY_CONFLICT',
    'PROTOCOL_MESSAGE_INVALID', 'PROTOCOL_CURSOR_INVALID', 'PROTOCOL_TRANSACTION_INVALID',
    'PROTOCOL_DATABASE_BUSY', 'PROTOCOL_DATABASE_READONLY', 'PROTOCOL_DATABASE_UNAVAILABLE',
    'PROTOCOL_DATABASE_CORRUPT', 'PROTOCOL_SQLITE_ERROR',
  ].sort()
  assert.equal(actual.length, 22)
  assert.deepEqual(actual, expected)
})

test('component migrations are isolated by component and return the highest version', () => {
  const path = freshDb()
  const protocol = openProtocol(path)
  const alpha = [
    { version: 1, sql: 'CREATE TABLE alpha_one (id INTEGER PRIMARY KEY) STRICT' },
    { version: 2, sql: 'CREATE TABLE alpha_two (id INTEGER PRIMARY KEY) STRICT' },
  ] as const
  const beta = [{ version: 1, sql: 'CREATE TABLE beta_one (id INTEGER PRIMARY KEY) STRICT' }] as const
  assert.equal(applyComponentMigrations(protocol, 'alpha.component', alpha), 2)
  assert.equal(applyComponentMigrations(protocol, 'beta-component', beta), 1)
  assert.equal(applyComponentMigrations(protocol, 'alpha.component', alpha), 2)
  protocol.close()

  const database = new DatabaseSync(path)
  const rows = database.prepare(
    "SELECT component,version FROM schema_migrations WHERE component!='session-protocol' ORDER BY component,version",
  ).all()
  database.close()
  assert.deepEqual(rows.map(row => [row.component, Number(row.version)]), [
    ['alpha.component', 1], ['alpha.component', 2], ['beta-component', 1],
  ])
})

test('component migration checksum covers only that migration and is verified before reuse', () => {
  const path = freshDb()
  const sql = 'CREATE TABLE checksum_one (id INTEGER PRIMARY KEY) STRICT'
  const migrations = [{ version: 1, sql }] as const
  const protocol = openProtocol(path)
  applyComponentMigrations(protocol, 'checksum', migrations)
  protocol.close()

  const database = new DatabaseSync(path)
  const row = database.prepare("SELECT checksum FROM schema_migrations WHERE component='checksum' AND version=1").get()
  assert.equal(row?.checksum, createHash('sha256').update(Buffer.from(sql, 'utf8')).digest('hex'))
  database.prepare("UPDATE schema_migrations SET checksum='rewritten' WHERE component='checksum' AND version=1").run()
  database.close()

  const reopened = openProtocol(path)
  assert.equal(errorOf(() => applyComponentMigrations(reopened, 'checksum', migrations)).code, 'PROTOCOL_SCHEMA_CHECKSUM_MISMATCH')
  reopened.close()
})

test('component migration rejects the protocol component, invalid names, and read-only handles', () => {
  const path = freshDb()
  const protocol = openProtocol(path)
  const migration = [{ version: 1, sql: 'CREATE TABLE reserved_test (id INTEGER PRIMARY KEY) STRICT' }] as const
  assert.equal(errorOf(() => applyComponentMigrations(protocol, 'session-protocol', migration)).code, 'PROTOCOL_TRANSACTION_INVALID')
  for (const component of ['', 'has space', '/path', 'x'.repeat(65)]) {
    assert.equal(errorOf(() => applyComponentMigrations(protocol, component, migration)).code, 'PROTOCOL_TRANSACTION_INVALID')
  }
  protocol.close()
  const reader = openProtocol(path, { readOnly: true })
  assert.equal(errorOf(() => applyComponentMigrations(reader, 'reader', migration)).code, 'PROTOCOL_DATABASE_READONLY')
  reader.close()
})

test('component migration rejects gaps and future generations before applying SQL', () => {
  const path = freshDb()
  const protocol = openProtocol(path)
  assert.equal(errorOf(() => applyComponentMigrations(protocol, 'gap', [
    { version: 2, sql: 'CREATE TABLE gap_two (id INTEGER PRIMARY KEY) STRICT' },
  ])).code, 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED')
  protocol.close()

  const database = new DatabaseSync(path)
  database.prepare(
    "INSERT INTO schema_migrations(component,version,checksum,applied_at_ms) VALUES('future',3,'x',1)",
  ).run()
  database.close()
  const reopened = openProtocol(path)
  assert.equal(errorOf(() => applyComponentMigrations(reopened, 'future', [
    { version: 1, sql: 'CREATE TABLE future_one (id INTEGER PRIMARY KEY) STRICT' },
  ])).code, 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED')
  reopened.close()
})

test('all pending component migrations and registry rows roll back in one transaction', () => {
  const path = freshDb()
  const protocol = openProtocol(path)
  const migrations: readonly ComponentMigration[] = [
    { version: 1, sql: 'CREATE TABLE atomic_one (id INTEGER PRIMARY KEY) STRICT' },
    { version: 2, sql: 'THIS IS NOT SQL' },
  ]
  assert.equal(errorOf(() => applyComponentMigrations(protocol, 'atomic', migrations)).code, 'PROTOCOL_SQLITE_ERROR')
  protocol.close()

  const database = new DatabaseSync(path)
  assert.equal(database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='atomic_one'").get()?.count, 0)
  assert.equal(database.prepare("SELECT count(*) AS count FROM schema_migrations WHERE component='atomic'").get()?.count, 0)
  database.close()
})

test('protocol write reentry from withTransaction fails with the tx.enqueue repair path', () => {
  const path = freshDb()
  const protocol = openProtocol(path)
  protocol.initialize('s1')
  const attempts: Array<() => unknown> = [
    () => protocol.initialize('s2'),
    () => protocol.enqueue('s1', { kind: 'x.v1', body: Buffer.from('x') }),
    () => protocol.dequeue('s1'),
    () => protocol.retire('s1'),
    () => protocol.withTransaction(() => 1),
  ]
  for (const attempt of attempts) {
    const error = errorOf(() => protocol.withTransaction(() => attempt()))
    assert.equal(error.code, 'PROTOCOL_TRANSACTION_INVALID')
    assert.match(error.message, /tx\.enqueue/)
  }
  assert.deepEqual(protocol.listPending('s1'), [])
  assert.equal(protocol.readMessages('s1').length, 0)
  protocol.close()
})

test('production source contains no storage-locality detector or platform branch', () => {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url))
  const files = readdirSync(sourceDirectory).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  assert.equal(files.length, 5, 'the entire production source population must be scanned')
  for (const file of files) {
    const source = readFileSync(join(sourceDirectory, file), 'utf8')
    assert.doesNotMatch(source, /statfs|NETWORK_FILESYSTEM|0x(?:6969|ff534d42)|process\.platform/i, file)
  }
})
