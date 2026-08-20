import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

import { openProtocol } from '@spexcode/session-protocol'
import { openTopology } from '@spexcode/session-topology'

const RELATION = 'zswarm.parent'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function json(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function createAdopterSchema(protocol) {
  protocol.withTransaction(tx => {
    tx.exec(`CREATE TABLE IF NOT EXISTS zswarm_sessions (
      session_id TEXT PRIMARY KEY REFERENCES protocol_sessions(session_id),
      parent_session_id TEXT,
      task_role TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      runtime_state TEXT NOT NULL,
      revision INTEGER NOT NULL,
      metadata_json TEXT NOT NULL,
      note TEXT
    ) STRICT`)
  })
}

function rowToRuntimeSession(row) {
  return {
    sessionId: String(row.session_id),
    parentSessionId: row.parent_session_id === null ? null : String(row.parent_session_id),
    taskRole: String(row.task_role),
    workspacePath: String(row.workspace_path),
    state: String(row.runtime_state),
    revision: Number(row.revision),
    metadata: JSON.parse(String(row.metadata_json)),
    note: row.note === null ? null : String(row.note),
  }
}

function registerRuntimeSession(protocol, topology, input) {
  const address = protocol.initialize(input.sessionId)
  protocol.withTransaction(tx => {
    tx.exec(
      `INSERT INTO zswarm_sessions
       (session_id, parent_session_id, task_role, workspace_path, runtime_state, revision, metadata_json, note)
       VALUES (?,?,?,?,?,?,?,NULL)`,
      input.sessionId,
      input.parentSessionId,
      input.taskRole,
      input.workspacePath,
      'registered',
      0,
      JSON.stringify(input.metadata),
    )
    if (input.parentSessionId !== null) {
      topology.attach(tx, input.parentSessionId, input.sessionId, RELATION)
      assert.deepEqual(topology.recipients(input.sessionId, tx), [input.parentSessionId])
    }
  })
  return address
}

function runtimeSessionChildren(protocol, topology, parentSessionId) {
  return protocol.withTransaction(tx => topology.children(parentSessionId, RELATION, tx).map(edge => {
    const rows = tx.query('SELECT * FROM zswarm_sessions WHERE session_id=?', edge.toSessionId)
    assert.equal(rows.length, 1)
    return rowToRuntimeSession(rows[0])
  }))
}

function runtimeSessionNotification(topology, tx, input) {
  const recipients = topology.recipients(input.sessionId, tx)
  const body = textEncoder.encode(JSON.stringify({
    childSessionId: input.sessionId,
    state: input.state,
    revision: input.revision,
    note: input.note,
  }))
  const messages = recipients.map(recipient => tx.enqueue(recipient, {
    kind: 'zswarm.state.v1',
    senderSessionId: input.sessionId,
    idempotencyKey: `${input.sessionId}:${input.revision}`,
    headers: { owner: 'zcode', taskRole: input.taskRole },
    body,
  }))
  return { recipients, messages }
}

function publishRuntimeSessionState(protocol, topology, input) {
  return protocol.withTransaction(tx => {
    const result = tx.exec(
      `UPDATE zswarm_sessions SET runtime_state=?, revision=?, note=?
       WHERE session_id=? AND revision<?`,
      input.state,
      input.revision,
      input.note,
      input.sessionId,
      input.revision,
    )
    assert.equal(result.changes, 1)
    return runtimeSessionNotification(topology, tx, input)
  })
}

function readRuntimeSession(protocol, sessionId) {
  return protocol.withTransaction(tx => {
    const rows = tx.query('SELECT * FROM zswarm_sessions WHERE session_id=?', sessionId)
    return rows.length === 0 ? null : rowToRuntimeSession(rows[0])
  })
}

function drain(protocol, sessionId) {
  const messages = []
  for (;;) {
    const message = protocol.dequeue(sessionId)
    if (message === null) return messages
    messages.push({
      messageId: message.messageId,
      senderSessionId: message.senderSessionId,
      notification: JSON.parse(textDecoder.decode(message.body)),
    })
  }
}

function runChild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1], ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`child ${args[0]} exited ${code}\nstdout=${stdout}\nstderr=${stderr}`))
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch (error) {
        reject(new Error(`child ${args[0]} returned invalid JSON: ${stdout}\n${stderr}`, { cause: error }))
      }
    })
  })
}

function readDatabaseOnly(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const sessions = database.prepare(
      `SELECT session_id, parent_session_id, task_role, workspace_path, runtime_state, revision
       FROM zswarm_sessions ORDER BY session_id`,
    ).all()
    const edges = database.prepare(
      `SELECT from_session_id, to_session_id, relation_type
       FROM topology_edges WHERE removed_at_ms IS NULL ORDER BY from_session_id, to_session_id`,
    ).all()
    const messages = database.prepare(
      `SELECT message_id, target_session_id, sender_session_id, kind, dequeued_at_ms
       FROM protocol_messages ORDER BY enqueue_seq`,
    ).all()
    const protocolColumns = [
      ...database.prepare('PRAGMA table_info(protocol_sessions)').all(),
      ...database.prepare('PRAGMA table_info(protocol_messages)').all(),
    ].map(row => String(row.name))
    const adopterColumnNames = [
      'parent_session_id', 'task_role', 'workspace_path', 'runtime_state', 'revision', 'metadata_json', 'note',
    ]
    return {
      mode: 'sqlite-read-only',
      adopterRows: sessions.length,
      states: Object.fromEntries(sessions.map(row => [String(row.session_id), String(row.runtime_state)])),
      revisions: Object.fromEntries(sessions.map(row => [String(row.session_id), Number(row.revision)])),
      topologyEdges: edges.length,
      pendingMessages: messages.filter(row => row.dequeued_at_ms === null).length,
      messageSenders: messages.map(row => String(row.sender_session_id)).sort(),
      protocolAdopterColumns: protocolColumns.filter(column => adopterColumnNames.includes(column)),
    }
  } finally {
    database.close()
  }
}

async function scenario(databasePath) {
  if (process.env.M5_ZSWARM_INJECT_LEGACY_READ) {
    readFileSync(process.env.M5_ZSWARM_INJECT_LEGACY_READ)
  }

  const protocol = openProtocol(databasePath, { busyTimeoutMs: 8000 })
  const topology = openTopology(protocol)
  try {
    createAdopterSchema(protocol)
    const parent = registerRuntimeSession(protocol, topology, {
      sessionId: 'z-parent', parentSessionId: null, taskRole: 'orchestrator',
      workspacePath: '/zswarm/workspaces/parent', metadata: { runtimeOwner: 'zcode' },
    })
    const children = [
      { sessionId: 'z-child-a', taskRole: 'implementer', workspacePath: '/zswarm/workspaces/a' },
      { sessionId: 'z-child-b', taskRole: 'reviewer', workspacePath: '/zswarm/workspaces/b' },
    ]
    for (const child of children) {
      registerRuntimeSession(protocol, topology, {
        ...child,
        parentSessionId: parent.sessionId,
        metadata: { worker: child.sessionId },
      })
    }
    const registeredChildren = runtimeSessionChildren(protocol, topology, parent.sessionId)
    assert.deepEqual(registeredChildren.map(child => child.sessionId), ['z-child-a', 'z-child-b'])
    assert.deepEqual(registeredChildren.map(child => child.state), ['registered', 'registered'])
  } finally {
    protocol.close()
  }

  const workerInputs = [
    ['worker', databasePath, 'z-child-a', 'running', '1', 'implementing'],
    ['worker', databasePath, 'z-child-b', 'need_review', '1', 'ready for review'],
  ]
  const workers = await Promise.all(workerInputs.map(runChild))
  assert.equal(new Set(workers.map(worker => worker.pid)).size, 2)
  assert.deepEqual(workers.map(worker => worker.recipients), [['z-parent'], ['z-parent']])

  const reader = await runChild(['reader', databasePath])
  assert.equal(reader.mode, 'sqlite-read-only')
  assert.equal(reader.adopterRows, 3)
  assert.equal(reader.topologyEdges, 2)
  assert.equal(reader.pendingMessages, 2)
  assert.deepEqual(reader.messageSenders, ['z-child-a', 'z-child-b'])
  assert.deepEqual(reader.protocolAdopterColumns, [])

  const consumer = openProtocol(databasePath, { busyTimeoutMs: 8000 })
  const consumerTopology = openTopology(consumer)
  try {
    const childA = readRuntimeSession(consumer, 'z-child-a')
    const childB = readRuntimeSession(consumer, 'z-child-b')
    assert.equal(childA?.state, 'running')
    assert.equal(childB?.state, 'need_review')
    assert.equal(childA?.revision, 1)
    assert.equal(childB?.revision, 1)
    assert.deepEqual(
      runtimeSessionChildren(consumer, consumerTopology, 'z-parent').map(child => child.state),
      ['running', 'need_review'],
    )

    const firstDrain = drain(consumer, 'z-parent')
    const secondDrain = drain(consumer, 'z-parent')
    const history = consumer.readMessages('z-parent')
    assert.equal(firstDrain.length, 2)
    assert.equal(new Set(firstDrain.map(message => message.messageId)).size, 2)
    assert.deepEqual(firstDrain.map(message => message.senderSessionId).sort(), ['z-child-a', 'z-child-b'])
    assert.deepEqual(firstDrain.map(message => message.notification.state).sort(), ['need_review', 'running'])
    assert.equal(secondDrain.length, 0)
    assert.equal(consumer.listPending('z-parent').length, 0)
    assert.equal(history.length, 2)
    assert.equal(history.filter(message => message.dequeuedAtMs !== null).length, 2)

    return {
      registeredAddresses: 3,
      children: 2,
      independentWorkers: workers.length,
      distinctWorkerPids: new Set(workers.map(worker => worker.pid)).size,
      reader,
      firstDrain: firstDrain.length,
      secondDrain: secondDrain.length,
      remaining: consumer.listPending('z-parent').length,
      history: history.length,
      dequeuedHistory: history.filter(message => message.dequeuedAtMs !== null).length,
    }
  } finally {
    consumer.close()
  }
}

async function main() {
  const [mode, databasePath, sessionId, state, revisionText, note] = process.argv.slice(2)
  if (mode === 'resolve') {
    const require = createRequire(import.meta.url)
    json({
      protocol: require.resolve('@spexcode/session-protocol'),
      topology: require.resolve('@spexcode/session-topology'),
    })
    return
  }
  if (mode === 'reader') {
    json(readDatabaseOnly(databasePath))
    return
  }
  if (mode === 'worker') {
    const protocol = openProtocol(databasePath, { busyTimeoutMs: 8000 })
    const topology = openTopology(protocol)
    try {
      const current = readRuntimeSession(protocol, sessionId)
      assert.ok(current)
      const published = publishRuntimeSessionState(protocol, topology, {
        sessionId,
        taskRole: current.taskRole,
        state,
        revision: Number(revisionText),
        note,
      })
      assert.equal(published.messages.length, 1)
      json({
        pid: process.pid,
        sessionId,
        recipients: published.recipients,
        messageId: published.messages[0].messageId,
      })
    } finally {
      protocol.close()
    }
    return
  }
  if (mode === 'scenario') {
    json(await scenario(databasePath))
    return
  }
  throw new Error('usage: consumer.mjs resolve | reader <db> | worker <db> ... | scenario <db>')
}

main().catch(error => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
})
