import { fileURLToPath } from 'node:url'
import { openProtocol } from './protocol.mjs'

const mode = process.argv[2]
const databasePath = process.argv[3]
if (!mode || !databasePath) throw new Error('usage: spex-governed-sequence.mjs producer|consumer <absolute-db>')

const protocol = openProtocol(databasePath)
try {
  if (mode === 'producer') {
    protocol.initialize('parent-a')
    protocol.initialize('child-a')
    protocol.withTransaction((tx) => {
      tx.exec(`CREATE TABLE IF NOT EXISTS spex_governed_sessions (
        session_id TEXT PRIMARY KEY REFERENCES sessions(session_id),
        project_id TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        native_identity TEXT,
        sender_revoked INTEGER NOT NULL DEFAULT 0
      )`)
      tx.exec(`CREATE TABLE IF NOT EXISTS topology_edges (
        parent_session_id TEXT NOT NULL REFERENCES sessions(session_id),
        child_session_id TEXT NOT NULL REFERENCES sessions(session_id),
        relation TEXT NOT NULL,
        PRIMARY KEY(parent_session_id, child_session_id, relation)
      )`)
      tx.exec(`CREATE TABLE IF NOT EXISTS spex_consumer_journal (
        message_id TEXT PRIMARY KEY,
        adapter_result TEXT NOT NULL
      )`)
      tx.exec('INSERT INTO spex_governed_sessions(session_id, project_id, lifecycle, native_identity) VALUES (?, ?, ?, ?)', 'parent-a', 'project-a', 'active', 'native-parent')
      tx.exec('INSERT INTO spex_governed_sessions(session_id, project_id, lifecycle, native_identity) VALUES (?, ?, ?, ?)', 'child-a', 'project-a', 'active', 'native-child')
      tx.exec('INSERT INTO topology_edges(parent_session_id, child_session_id, relation) VALUES (?, ?, ?)', 'parent-a', 'child-a', 'parent')
      tx.enqueue('parent-a', {
        messageId: 'child-ready-1', targetSessionId: 'parent-a', senderSessionId: 'child-a',
        body: 'child is ready', headers: { kind: 'lifecycle', projectId: 'project-a' }, idempotencyKey: 'child-ready-1',
      })
    })
    process.stdout.write(JSON.stringify({ projectId: 'project-a', parentSessionId: 'parent-a', enqueued: 'child-ready-1' }) + '\n')
  } else if (mode === 'consumer') {
    const message = protocol.dequeue('parent-a')
    if (!message) throw new Error('consumer found no pending message')
    const adapterInput = message.body.toString('utf8')
    protocol.withTransaction((tx) => {
      tx.exec('INSERT INTO spex_consumer_journal(message_id, adapter_result) VALUES (?, ?)', message.messageId, `input:${adapterInput}`)
    })
    process.stdout.write(JSON.stringify({ messageId: message.messageId, adapterInput, journaled: true }) + '\n')
  } else {
    throw new Error(`unknown mode: ${mode}`)
  }
} finally {
  protocol.close()
}
