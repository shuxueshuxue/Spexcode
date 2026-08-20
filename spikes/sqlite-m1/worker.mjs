import { appendFileSync, readFileSync } from 'node:fs'
import { openProtocol } from './protocol.mjs'

const [mode, databasePath, sessionId, id, resultPath] = process.argv.slice(2)
const p = openProtocol(databasePath, { busyTimeoutMs: Number(process.env.BUSY_TIMEOUT_MS || 1000) })
const out = value => { if (resultPath) appendFileSync(resultPath, JSON.stringify(value) + '\n') }
try {
  if (mode === 'enqueue') out(p.enqueue(sessionId, { messageId: id, targetSessionId: sessionId, body: id }))
  else if (mode === 'dequeue') out(p.dequeue(sessionId))
  else if (mode === 'post-dequeue-kill') { const value = p.dequeue(sessionId); out(value); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000) }
  else if (mode === 'precommit-lock') {
    p.withTransaction(tx => { tx.exec("UPDATE messages SET state='dequeued' WHERE sequence=(SELECT sequence FROM messages WHERE session_id=? AND state='pending' ORDER BY sequence LIMIT 1)", sessionId); out({ locked: true }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); throw new Error('unreachable') })
  }
  else if (mode === 'hold-lock') { p.withTransaction(tx => { tx.exec('CREATE TABLE IF NOT EXISTS lock_probe (id INTEGER)'); out({ locked: true }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); throw new Error('unreachable') }) }
  else if (mode === 'list') out(p.listPending(sessionId))
  else if (mode === 'retire') out(p.retire(sessionId))
  else throw new Error(`unknown worker mode ${mode}`)
} catch (error) { out({ error: error.code || error.message }); process.exitCode = 1 }
