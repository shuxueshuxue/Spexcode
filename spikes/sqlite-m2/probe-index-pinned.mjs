// Same shape, with the two hot statements pinned by INDEXED BY.
// Does the history index earn its place, and does its presence steal the hot pending path?
// Decided by measured plans and timings at realistic shape, not by reading the DDL.
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SESSIONS = 200
const PER_SESSION = 500          // 100k messages total
const PENDING_PER_SESSION = 3    // realistic: almost everything is already delivered

const build = (path, withHistoryIndex) => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA synchronous=OFF')
  db.exec(`CREATE TABLE protocol_messages (
    enqueue_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    target_session_id TEXT NOT NULL,
    body BLOB NOT NULL,
    dequeued_at_ms INTEGER
  ) STRICT;
  CREATE INDEX protocol_messages_pending_fifo
    ON protocol_messages (target_session_id, enqueue_seq) WHERE dequeued_at_ms IS NULL;`)
  if (withHistoryIndex) db.exec('CREATE INDEX protocol_messages_history ON protocol_messages (target_session_id, enqueue_seq)')
  const ins = db.prepare('INSERT INTO protocol_messages(message_id,target_session_id,body,dequeued_at_ms) VALUES(?,?,?,?)')
  const payload = Buffer.alloc(120, 3)
  db.exec('BEGIN IMMEDIATE')
  let n = 0
  for (let s = 0; s < SESSIONS; s++) {
    for (let i = 0; i < PER_SESSION; i++) {
      const pending = i >= PER_SESSION - PENDING_PER_SESSION
      ins.run(String(n++).padStart(32, '0'), 'sess-' + s, payload, pending ? null : 1700000000000)
    }
  }
  db.exec('COMMIT')
  return db
}

const HEAD = "SELECT * FROM protocol_messages INDEXED BY protocol_messages_pending_fifo WHERE target_session_id=? AND dequeued_at_ms IS NULL ORDER BY enqueue_seq LIMIT 1"
const HISTORY = "SELECT * FROM protocol_messages INDEXED BY protocol_messages_history WHERE target_session_id=? AND enqueue_seq>? ORDER BY enqueue_seq"

const plan = (db, sql, ...p) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...p).map(r => r.detail).join(' | ')
const timeIt = (label, fn, iterations) => {
  fn()
  const t = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) fn()
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / iterations
  console.log(`    ${label}: ${ms.toFixed(4)} ms/op`)
  return ms
}

for (const analyze of [false]) {
  for (const withHistory of [true]) {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-m2-idx-'))
    const db = build(join(dir, 'p.sqlite'), withHistory)
    if (analyze) db.exec('ANALYZE')
    const label = `historyIndex=${withHistory} analyze=${analyze}`
    console.log(`\n### ${label}   (${SESSIONS} sessions x ${PER_SESSION} messages)`)
    console.log('    plan head   :', plan(db, HEAD, 'sess-7'))
    console.log('    plan history:', plan(db, HISTORY, 'sess-7', 0))
    const head = db.prepare(HEAD)
    const hist = db.prepare(HISTORY)
    timeIt('dequeue head lookup', () => head.get('sess-7'), 2000)
    timeIt('readMessages(sess-7, 0)', () => hist.all('sess-7', 0), 200)
    const pageCount = db.prepare('PRAGMA page_count').get().page_count
    console.log(`    page_count=${pageCount}`)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}
