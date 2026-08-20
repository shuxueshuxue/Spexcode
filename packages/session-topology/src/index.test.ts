import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  applyComponentMigrations,
  openProtocol,
  ProtocolError,
  type ProtocolTransaction,
  type SessionProtocol,
} from '@spexcode/session-protocol'

import * as topologyEntry from './index.js'
import { openTopology, TopologyError, type SessionTopology } from './index.js'
import { TOPOLOGY_MIGRATION_SQL } from './schema.js'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', 'scripts', 'worker.mjs')

async function fixture(ids: string[]): Promise<{
  protocol: SessionProtocol
  topology: SessionTopology
  databasePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'session-topology-'))
  const databasePath = join(root, 'state.sqlite')
  const protocol = openProtocol(databasePath)
  for (const id of ids) protocol.initialize(id)
  return { protocol, topology: openTopology(protocol), databasePath }
}

function topologyCode(action: () => unknown): string {
  try {
    action()
    return 'NO_ERROR'
  } catch (error) {
    assert.ok(error instanceof TopologyError)
    return error.code
  }
}

test('relation mutation and all requested enqueues commit or roll back together', async () => {
  const { protocol, topology } = await fixture(['source-a', 'source-b', 'commit', 'rollback'])
  protocol.withTransaction(tx => {
    topology.attach(tx, 'source-a', 'commit', 'parent')
    for (let index = 0; index < 3; index++) {
      tx.enqueue('commit', { kind: 'relation.v1', body: Buffer.from(String(index)) })
    }
  })
  assert.deepEqual(topology.recipients('commit'), ['source-a'])
  assert.equal(protocol.listPending('commit').length, 3)

  assert.throws(() => protocol.withTransaction(tx => {
    topology.attach(tx, 'source-b', 'rollback', 'parent')
    for (let index = 0; index < 3; index++) {
      tx.enqueue('rollback', { kind: 'relation.v1', body: Buffer.from(String(index)) })
    }
    throw new Error('forced rollback')
  }))
  assert.deepEqual(topology.recipients('rollback'), [])
  assert.equal(protocol.listPending('rollback').length, 0)
  protocol.close()
})

test('mutation requires a protocol transaction context at runtime', async () => {
  const { protocol, topology } = await fixture(['a', 'b'])
  assert.equal(topologyCode(() => topology.attach(undefined as unknown as ProtocolTransaction, 'a', 'b', 'parent')),
    'TOPOLOGY_TRANSACTION_INVALID')
  assert.equal(topologyCode(() => topology.attach(protocol as unknown as ProtocolTransaction, 'a', 'b', 'parent')),
    'TOPOLOGY_TRANSACTION_INVALID')
  assert.deepEqual(topology.recipients('b'), [])
  protocol.close()
})

test('self, two-hop, and deep cycles are refused without changing state', async () => {
  const { protocol, topology } = await fixture(['a', 'b'])
  assert.equal(topologyCode(() => protocol.withTransaction(tx => topology.attach(tx, 'a', 'a', 'parent'))),
    'TOPOLOGY_SELF_EDGE')
  assert.equal(topology.parents('a').length, 0)

  protocol.withTransaction(tx => topology.attach(tx, 'a', 'b', 'parent'))
  const oneEdge = topology.children('a').map(edge => edge.edgeId)
  assert.equal(topologyCode(() => protocol.withTransaction(tx => topology.attach(tx, 'b', 'a', 'parent'))),
    'TOPOLOGY_CYCLE_REFUSED')
  assert.deepEqual(topology.children('a').map(edge => edge.edgeId), oneEdge)
  assert.equal(topology.children('b').length, 0)

  protocol.close()

  const deepIds = Array.from({ length: 40 }, (_, index) => `deep-${index}`)
  const deep = await fixture(deepIds)
  deep.protocol.withTransaction(tx => {
    for (let index = 0; index < deepIds.length - 1; index++) {
      deep.topology.attach(tx, deepIds[index], deepIds[index + 1], 'parent')
    }
  })
  const before = deepIds.flatMap(id => deep.topology.children(id).map(edge => edge.edgeId))
  assert.equal(before.length, 39)
  assert.equal(topologyCode(() => deep.protocol.withTransaction(tx => {
    deep.topology.attach(tx, deepIds.at(-1)!, deepIds[0], 'parent')
  })), 'TOPOLOGY_CYCLE_REFUSED')
  const after = deepIds.flatMap(id => deep.topology.children(id).map(edge => edge.edgeId))
  assert.deepEqual(after, before)
  deep.protocol.close()
})

test('reparent cycle refusal preserves every prior active edge', async () => {
  const { protocol, topology } = await fixture(['old', 'subject', 'middle', 'next'])
  protocol.withTransaction(tx => {
    topology.attach(tx, 'old', 'subject', 'parent')
    topology.attach(tx, 'subject', 'middle', 'parent')
    topology.attach(tx, 'middle', 'next', 'parent')
  })
  const before = ['old', 'subject', 'middle', 'next']
    .flatMap(id => topology.children(id).map(edge => edge.edgeId))
    .sort()
  assert.equal(
    topologyCode(() => protocol.withTransaction(tx => topology.reparent(tx, 'subject', 'next', 'parent'))),
    'TOPOLOGY_CYCLE_REFUSED',
  )
  const after = ['old', 'subject', 'middle', 'next']
    .flatMap(id => topology.children(id).map(edge => edge.edgeId))
    .sort()
  assert.deepEqual(after, before)
  assert.deepEqual(topology.parents('subject', 'parent').map(edge => edge.fromSessionId), ['old'])
  protocol.close()
})

test('active edge uniqueness and soft removal permit a later replacement edge', async () => {
  const { protocol, topology } = await fixture(['a', 'b'])
  const first = protocol.withTransaction(tx => topology.attach(tx, 'a', 'b', 'parent'))
  assert.match(first.edgeId, /^[0-9a-f]{32}$/)
  assert.equal(topologyCode(() => protocol.withTransaction(tx => topology.attach(tx, 'a', 'b', 'parent'))),
    'TOPOLOGY_EDGE_EXISTS')
  const removed = protocol.withTransaction(tx => topology.detach(tx, first.edgeId))
  assert.ok(removed.removedAtMs !== null)
  const second = protocol.withTransaction(tx => topology.attach(tx, 'a', 'b', 'parent'))
  assert.notEqual(second.edgeId, first.edgeId)
  assert.equal(topology.parents('b').length, 1)
  protocol.close()
})

test('recipient sources are active, distinct, stable, and disappear after removal', async () => {
  const { protocol, topology } = await fixture(['z-source', 'a-source', 'subject'])
  const edges = protocol.withTransaction(tx => [
    topology.attach(tx, 'z-source', 'subject', 'parent'),
    topology.subscribe(tx, 'a-source', 'subject', 'updates'),
    topology.subscribe(tx, 'z-source', 'subject', 'updates'),
  ])
  assert.deepEqual(topology.recipients('subject'), ['a-source', 'z-source'])
  protocol.withTransaction(tx => topology.detach(tx, edges[0].edgeId))
  assert.deepEqual(topology.recipients('subject'), ['a-source', 'z-source'])
  protocol.withTransaction(tx => topology.unsubscribe(tx, 'z-source', 'subject', 'updates'))
  assert.deepEqual(topology.recipients('subject'), ['a-source'])
  protocol.withTransaction(tx => topology.unsubscribe(tx, 'a-source', 'subject', 'updates'))
  assert.deepEqual(topology.recipients('subject'), [])
  protocol.close()
})

test('directional reads and reparent use the same edge relation', async () => {
  const { protocol, topology } = await fixture(['p1', 'p2', 'p3', 'subject', 'other'])
  protocol.withTransaction(tx => {
    topology.attach(tx, 'p1', 'subject', 'parent')
    topology.attach(tx, 'p2', 'subject', 'parent')
    topology.subscribe(tx, 'p1', 'other', 'updates')
  })
  const next = protocol.withTransaction(tx => {
    const edge = topology.reparent(tx, 'subject', 'p3', 'parent')
    assert.deepEqual(topology.parents('subject', 'parent', tx).map(item => item.fromSessionId), ['p3'])
    return edge
  })
  assert.equal(topology.parents('subject', 'parent')[0].edgeId, next.edgeId)
  assert.deepEqual(topology.children('p1').map(edge => edge.toSessionId), ['other'])
  assert.deepEqual(topology.subscriptions('p1').map(edge => edge.toSessionId), ['other'])
  protocol.close()
})

test('topology failures use stable topology codes and hide storage diagnostics', async () => {
  const { protocol, topology } = await fixture(['a', 'b'])
  assert.equal(topologyCode(() => protocol.withTransaction(tx => topology.attach(tx, 'a', 'missing', 'parent'))),
    'TOPOLOGY_SESSION_UNKNOWN')
  assert.equal(topologyCode(() => protocol.withTransaction(tx => topology.attach(tx, 'a', 'b', 'bad type'))),
    'TOPOLOGY_RELATION_TYPE_INVALID')
  assert.equal(topologyCode(() => protocol.withTransaction(tx => topology.attach(tx, 'bad/id', 'b', 'parent'))),
    'TOPOLOGY_SESSION_ID_INVALID')
  assert.equal(topologyCode(() => protocol.withTransaction(tx => topology.detach(tx, 'x'))),
    'TOPOLOGY_EDGE_ID_INVALID')
  assert.equal(topologyCode(() => protocol.withTransaction(tx => topology.detach(tx, 'f'.repeat(32)))),
    'TOPOLOGY_EDGE_UNKNOWN')
  let caught: unknown
  try {
    protocol.withTransaction(tx => topology.attach(tx, 'a', 'missing', 'parent'))
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof TopologyError)
  assert.doesNotMatch(caught.message, /sqlite|foreign key|constraint/i)
  assert.ok(!(caught instanceof ProtocolError))
  protocol.close()
})

test('a topology error crosses the transaction boundary with exact identity and code', async () => {
  const { protocol } = await fixture(['a'])
  const expected = new TopologyError(
    'TOPOLOGY_EDGE_UNKNOWN',
    'caller-owned read-only wording must not fabricate a protocol condition',
  )
  let actual: unknown
  try {
    protocol.withTransaction(() => { throw expected })
  } catch (error) {
    actual = error
  }
  assert.strictEqual(actual, expected)
  assert.ok(actual instanceof TopologyError)
  assert.equal(actual.code, 'TOPOLOGY_EDGE_UNKNOWN')
  protocol.close()
})

test('component migration rows are isolated and topology checksum drift is refused', async () => {
  const { protocol, topology: _topology } = await fixture(['a'])
  const rows = protocol.withTransaction(tx => tx.query(
    'SELECT component, version, checksum FROM schema_migrations ORDER BY component',
  ))
  assert.deepEqual(rows.map(row => [row.component, row.version]), [
    ['session-protocol', 1],
    ['session-topology', 1],
  ])
  const protocolChecksum = String(rows[0].checksum)
  assert.throws(
    () => applyComponentMigrations(protocol, 'session-topology', [
      { version: 1, sql: `${TOPOLOGY_MIGRATION_SQL}\n` },
    ]),
    (error: unknown) => error instanceof ProtocolError && error.code === 'PROTOCOL_SCHEMA_CHECKSUM_MISMATCH',
  )
  const after = protocol.withTransaction(tx => tx.query(
    'SELECT component, checksum FROM schema_migrations ORDER BY component',
  ))
  assert.equal(after.length, 2)
  assert.equal(after[0].checksum, protocolChecksum)
  protocol.close()
})

test('the edge table has the frozen columns and permits a clock rollback', async () => {
  const { protocol, topology } = await fixture(['a', 'b'])
  protocol.withTransaction(tx => {
    const columns = tx.query('PRAGMA table_info(topology_edges)').map(row => String(row.name))
    assert.deepEqual(columns, [
      'edge_id',
      'from_session_id',
      'to_session_id',
      'relation_type',
      'created_at_ms',
      'removed_at_ms',
    ])
    tx.exec(
      `INSERT INTO topology_edges
       (edge_id, from_session_id, to_session_id, relation_type, created_at_ms, removed_at_ms)
       VALUES (?,?,?,?,?,?)`,
      '1'.repeat(32),
      'a',
      'b',
      'past-clock',
      20,
      10,
    )
  })
  assert.deepEqual(topology.recipients('b'), [])
  protocol.close()
})

test('the runtime surface has no mutation path for taking a message', async () => {
  const { protocol, topology } = await fixture(['a'])
  assert.deepEqual(Object.keys(topologyEntry).sort(), ['TopologyError', 'openTopology'])
  assert.deepEqual(Object.keys(topology).sort(), [
    'attach',
    'children',
    'detach',
    'parents',
    'recipients',
    'reparent',
    'subscribe',
    'subscriptions',
    'unsubscribe',
  ])
  assert.ok(!('dequeue' in topology))
  protocol.close()
})

test('hot active-edge queries pin their declared indexes', async () => {
  const { protocol, topology: _topology } = await fixture(['a'])
  const plans = protocol.withTransaction(tx => ({
    from: tx.query(
      `EXPLAIN QUERY PLAN SELECT edge_id FROM topology_edges INDEXED BY topology_active_edge
       WHERE from_session_id=? AND removed_at_ms IS NULL`,
      'a',
    ),
    to: tx.query(
      `EXPLAIN QUERY PLAN SELECT DISTINCT from_session_id FROM topology_edges INDEXED BY topology_active_to
       WHERE to_session_id=? AND removed_at_ms IS NULL ORDER BY from_session_id`,
      'a',
    ),
  }))
  assert.match(plans.from.map(row => row.detail).join(' '), /topology_active_edge/)
  assert.match(plans.to.map(row => row.detail).join(' '), /topology_active_to/)
  protocol.close()
})

test('production sources contain only neutral topology vocabulary', async () => {
  const sourceNames = (await readdir(here)).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts')).sort()
  assert.equal(sourceNames.length, 3, 'neutrality scan must inspect all three production source files')
  const forbidden = /\b(?:manager|ZSwarm|project_id|governed|harness|worktree|board|proposal|dispatcher|observer|outbox)\b|watcher policy|relation-revision|cross-DB/i
  const hits: string[] = []
  for (const name of sourceNames) {
    const text = await readFile(join(here, name), 'utf8')
    if (forbidden.test(text)) hits.push(name)
  }
  assert.deepEqual(hits, [])
})

test('two writer processes compose edges and messages seen by an independent reader', async () => {
  const { protocol, databasePath } = await fixture(['source-a', 'source-b', 'subject'])
  protocol.close()
  const writers = [
    ['source-a', 'subject', 'parent'],
    ['source-b', 'subject', 'updates'],
  ].map(args => new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(process.execPath, [worker, databasePath, 'attach', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) reject(new Error(`writer exited ${code}: ${stderr}`))
      else resolve(JSON.parse(stdout) as Record<string, unknown>)
    })
  }))
  const written = await Promise.all(writers)
  assert.equal(written.length, 2)
  assert.ok(written.every(item => item.operation === 'attach'))

  const { stdout } = await execFileAsync(process.execPath, [worker, databasePath, 'inspect', 'subject'])
  const observed = JSON.parse(stdout) as { recipients: string[]; edges: number; messages: number }
  assert.deepEqual(observed, {
    operation: 'inspect',
    recipients: ['source-a', 'source-b'],
    edges: 2,
    messages: 2,
  })
})
