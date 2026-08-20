import { createRequire } from 'node:module'

import { openProtocol } from '../dist/index.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')
const [databasePath, operation, startAtRaw, ...args] = process.argv.slice(2)
const startAt = Number(startAtRaw)

while (Date.now() < startAt) { /* shared start barrier */ }

const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)

try {
  if (operation === 'open') {
    openProtocol(databasePath).close()
    emit({ ok: true, operation })
  } else if (operation === 'initialize') {
    const protocol = openProtocol(databasePath)
    const result = protocol.initialize(args[0])
    protocol.close()
    emit({ ok: true, operation, result })
  } else if (operation === 'enqueue') {
    const [sessionId, count, tag] = [args[0], Number(args[1]), args[2]]
    const protocol = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const ids = []
    for (let index = 0; index < count; index++) {
      ids.push(protocol.enqueue(sessionId, {
        kind: 'load.v1', body: Buffer.from(`${tag}:${index}`), headers: { tag },
      }).messageId)
    }
    protocol.close()
    emit({ ok: true, operation, tag, ids })
  } else if (operation === 'follow') {
    const [sessionId, expected] = [args[0], Number(args[1])]
    const protocol = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const seen = []
    let cursor = 0
    while (seen.length < expected) {
      for (const item of protocol.readMessages(sessionId, cursor)) {
        seen.push(item.messageId)
        cursor = item.enqueueSeq
      }
    }
    protocol.close()
    emit({ ok: true, operation, seen, complete: seen.length === expected })
  } else if (operation === 'drain') {
    const protocol = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const taken = []
    for (;;) {
      const item = protocol.dequeue(args[0])
      if (!item) break
      taken.push(item.messageId)
    }
    protocol.close()
    emit({ ok: true, operation, taken, drained: true })
  } else if (operation === 'lock-holder') {
    const holdMs = Number(args[0])
    const database = new DatabaseSync(databasePath)
    database.exec('PRAGMA locking_mode=EXCLUSIVE')
    database.exec('BEGIN IMMEDIATE')
    database.prepare("INSERT INTO protocol_sessions(session_id, created_at_ms) VALUES('lockholder', 1)").run()
    database.exec('COMMIT')
    process.stdout.write('held\n')
    const releaseAt = Date.now() + holdMs
    while (Date.now() < releaseAt) { /* controlled lock window */ }
    database.close()
    emit({ ok: true, operation, holdMs })
  } else if (operation === 'crash-precommit') {
    const protocol = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    protocol.withTransaction(tx => {
      tx.enqueue(args[0], { kind: 'crash.v1', body: Buffer.from('precommit') })
      process.stdout.write('staged\n')
      for (;;) { /* killed by the test after the staged signal */ }
    })
  } else if (operation === 'crash-consumer') {
    const protocol = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const item = protocol.dequeue(args[0])
    process.stdout.write(`dequeued ${item.messageId}\n`)
    for (;;) { /* killed before any further action */ }
  } else if (operation === 'crash-postcommit') {
    const protocol = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const item = protocol.enqueue(args[0], { kind: 'crash.v1', body: Buffer.from('postcommit') })
    process.stdout.write(`committed ${item.messageId}\n`)
    for (;;) { /* killed after the committed signal */ }
  } else {
    throw new Error(`unknown operation: ${operation}`)
  }
} catch (error) {
  emit({
    ok: false,
    operation,
    code: error?.code ?? null,
    message: String(error?.message ?? error),
    stack: String(error?.cause?.stack ?? error?.stack ?? '').split('\n').slice(0, 4),
  })
  process.exitCode = 1
}
