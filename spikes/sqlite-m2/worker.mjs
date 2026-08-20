// One real OS process per invocation. Used by test/concurrency.test.mjs; prints one JSON line.
// Usage: node worker.mjs <databasePath> <op> <startAtMs> [args...]
const { openProtocol } = await import(process.env.M2_ENGINE ?? './engine.mjs')

const [databasePath, op, startAtMsRaw, ...rest] = process.argv.slice(2)
const startAtMs = Number(startAtMsRaw)

// Spin to a shared wall-clock instant so the processes genuinely collide rather than queue up
// behind each other's startup cost.
while (Date.now() < startAtMs) { /* barrier */ }

const emit = value => process.stdout.write(JSON.stringify(value) + '\n')

try {
  if (op === 'open') {
    const handle = openProtocol(databasePath)
    handle.close()
    emit({ ok: true, op })
  } else if (op === 'initialize') {
    const handle = openProtocol(databasePath)
    emit({ ok: true, op, result: handle.initialize(rest[0]) })
    handle.close()
  } else if (op === 'enqueue') {
    const [sessionId, count, tag] = [rest[0], Number(rest[1]), rest[2]]
    const handle = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const ids = []
    for (let i = 0; i < count; i++) {
      ids.push(handle.enqueue(sessionId, {
        kind: 'load.v1',
        body: Buffer.from(`${tag}:${i}`),
        headers: { tag },
      }).messageId)
    }
    handle.close()
    emit({ ok: true, op, tag, ids })
  } else if (op === 'follow') {
    // Advance a cursor while other processes are still committing. A skipped message here would
    // mean enqueue_seq can become visible out of commit order.
    // Terminate on the expected COUNT, not on a wall clock. A deadline makes the vector depend on
    // how fast writers happen to be, which silently turns a correctness claim into a timing race.
    const [sessionId, expected, deadlineMs] = [rest[0], Number(rest[1]), Number(rest[2])]
    const handle = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const seen = []
    let cursor = 0
    while (seen.length < expected && Date.now() < deadlineMs) {
      for (const message of handle.readMessages(sessionId, cursor)) {
        seen.push(message.messageId)
        cursor = message.enqueueSeq
      }
    }
    handle.close()
    emit({ ok: true, op, seen, complete: seen.length >= expected })
  } else if (op === 'drain') {
    // Stop when the queue is drained, not when a clock runs out. Nothing enqueues during this
    // vector, so the first null is definitive; a wall-clock deadline would instead make the vector
    // depend on how fast writes happen to be, which is how it silently flaked before.
    const [sessionId, deadlineMs] = [rest[0], Number(rest[1])]
    const handle = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const taken = []
    let drained = false
    while (!drained && Date.now() < deadlineMs) {
      const message = handle.dequeue(sessionId)
      if (message) taken.push(message.messageId)
      else drained = true
    }
    handle.close()
    emit({ ok: true, op, taken, drained })
  } else if (op === 'lock-holder') {
    // Deterministic lock holder for the busy_timeout ordering gate. locking_mode=EXCLUSIVE keeps the
    // file lock after COMMIT, so the lock is held for a known window instead of a raced instant.
    // This is a fixture, not protocol behaviour: the protocol never sets locking_mode.
    const holdMs = Number(rest[0])
    const engine = await import(process.env.M2_ENGINE ?? './engine.mjs')
    const db = engine.nodeSqliteDriver.open(databasePath, { readOnly: false })
    db.exec('PRAGMA locking_mode=EXCLUSIVE')
    db.exec('BEGIN IMMEDIATE')
    db.prepare("INSERT INTO protocol_sessions(session_id, created_at_ms) VALUES('lockholder', 1)").run()
    db.exec('COMMIT')
    process.stdout.write('held\n')
    const until = Date.now() + holdMs
    while (Date.now() < until) { /* hold the lock for a known window */ }
    db.close()
    emit({ ok: true, op, heldMs: holdMs })
  } else if (op === 'crash-precommit') {
    // Stage a write inside a real protocol transaction, announce it, then spin until the parent
    // SIGKILLs us. Spinning inside a transaction is exactly what the contract forbids in production;
    // it is the only way to catch a process mid-transaction, and this is a crash fixture.
    const handle = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    handle.withTransaction(tx => {
      tx.enqueue(rest[0], { kind: 'crash.v1', body: Buffer.from('precommit') })
      process.stdout.write('staged\n')
      for (;;) { /* wait to be killed */ }
    })
  } else if (op === 'crash-handler') {
    // Dequeue commits protocol delivery; then the CONSUMER's handler dies before doing any downstream
    // work. v1 keeps no handler journal inside the protocol, so the message must NOT come back to the
    // queue. That absence is the at-most-once boundary, stated as a running fixture rather than prose.
    const handle = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const message = handle.dequeue(rest[0])
    process.stdout.write(`dequeued ${message.messageId}\n`)
    for (;;) { /* die here, before any handler effect */ }
  } else if (op === 'crash-postcommit') {
    const handle = openProtocol(databasePath, { busyTimeoutMs: 10000 })
    const message = handle.enqueue(rest[0], { kind: 'crash.v1', body: Buffer.from('postcommit') })
    process.stdout.write(`committed ${message.messageId}\n`)
    for (;;) { /* wait to be killed */ }
  } else {
    throw new Error(`unknown op: ${op}`)
  }
} catch (error) {
  emit({ ok: false, op, code: error?.code ?? null, message: String(error?.message ?? error), stack: String(error?.cause?.stack ?? error?.stack ?? '').split('\n').slice(0, 4) })
  process.exitCode = 1
}
