import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { runtimeRoot, sessionArtifactPath, sessionStoreDir } from '@spexcode/l0'

// @@@ delivery-queue - what a session still OWES its agent. The log ([[session-timeline]]) is the record and
// grows forever; this is the debt and is consumed, so it lives in its own small file whose resting state is
// EMPTY. Nothing here reads the log: an entry carries the text it will hand over, so history could be trimmed
// or archived without changing what is owed. A session that predates this mechanism owes nothing, because a
// queue is only ever filled by an enqueue — which is why no backlog migration exists.

export type PendingMessage = {
  mid: string
  text: string
  from: string | null
  dispatch?: { operation: 'merge'; requestDigest: string }
}

const queuePath = (id: string): string => sessionArtifactPath(id, 'pending.json')
const revokedSenderRoot = (): string => join(runtimeRoot(), '.revoked-senders')
const revokedSenderPath = (id: string): string => join(revokedSenderRoot(), id)

// @@@ its own lock, deliberately NOT the record lock - the drain holds this across the adapter insert, which
// is what makes "claim" real: two processes draining the same session cannot both hand over one message. The
// record lock could never span that call — a native turn runs lifecycle hooks that re-enter the record writer,
// and holding it there deadlocks the adapter's own confirmation. Nothing in the delivery path takes this one,
// so spanning the insert costs no contention. PID liveness reclaims a lock whose holder died mid-insert.
const lockRoot = (): string => join(runtimeRoot(), '.delivery-locks')
const lockPath = (id: string): string => join(lockRoot(), `${id}.lock`)

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function acquire(id: string, timeoutMs: number): Promise<(() => void) | null> {
  mkdirSync(lockRoot(), { recursive: true })
  const path = lockPath(id), deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return () => { try { unlinkSync(path) } catch { /* a liveness reclaim already removed it */ } }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      let owner = 0
      try { owner = Number(readFileSync(path, 'utf8').trim()) || 0 } catch { /* race with creator/releaser */ }
      if (owner && owner !== process.pid) {
        try { process.kill(owner, 0) } catch { try { unlinkSync(path) } catch { /* race */ }; continue }
      }
      // A drain is never urgent enough to fight for: whoever holds the lock is delivering these same messages,
      // and the retry sweep will come back. Declining is not a lost message.
      if (Date.now() >= deadline) return null
      await pause(25)
    }
  }
}

function read(id: string): PendingMessage[] {
  try {
    const raw = JSON.parse(readFileSync(queuePath(id), 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((m): m is PendingMessage =>
      !!m && typeof m === 'object'
      && typeof (m as PendingMessage).mid === 'string'
      && typeof (m as PendingMessage).text === 'string'
      && ((m as PendingMessage).dispatch === undefined
        || ((m as PendingMessage).dispatch?.operation === 'merge'
          && typeof (m as PendingMessage).dispatch?.requestDigest === 'string')))
  } catch { return [] }   // absent, empty, or unparseable all mean the honest thing: nothing owed
}

// Written whole and atomically; an empty queue is REMOVED rather than left as `[]`, so "is anything owed?" is
// one existsSync on the sweep's hot path.
function write(id: string, msgs: PendingMessage[]): void {
  const path = queuePath(id)
  if (!msgs.length) { try { unlinkSync(path) } catch { /* already gone */ } ; return }
  mkdirSync(sessionStoreDir(id), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(msgs, null, 2) + '\n')
  renameSync(tmp, path)
}

// A closed sender may have left debt in many other sessions' queues. The marker is deliberately outside its
// own store (which close removes) and is checked under the sender's record lock by dispatch: a close cannot
// return while an old process can still append, and a later sweep cannot hand over what it sees here.
export function revokeSenderDelivery(id: string): void {
  mkdirSync(revokedSenderRoot(), { recursive: true })
  writeFileSync(revokedSenderPath(id), `${id}\n`)
}

export const senderDeliveryRevoked = (id: string): boolean => existsSync(revokedSenderPath(id))

export function pendingSnapshot(id: string): PendingMessage[] { return read(id) }

// These two writes require the target's delivery lock. They are the queue half of a larger transaction
// (currently reparent), which must be able to restore the exact previous debt if a later record write fails.
export function replacePendingWhileLocked(id: string, msgs: PendingMessage[]): void { write(id, msgs) }
export function revokePendingFromWhileLocked(id: string, sender: string): number {
  const current = read(id)
  const next = current.filter((msg) => msg.from !== sender)
  write(id, next)
  return current.length - next.length
}

// The enqueue rides the timeline append ([[dispatch]]): the caller holds the session's RECORD lock across
// both, and the record is written first, so delivery is never unrecorded. A keyed dispatch also carries its
// exact delivery bytes in the timeline receipt, letting its retry restore a queue write lost to a crash.
export function enqueue(id: string, msg: PendingMessage): void {
  write(id, [...read(id), msg])
}

// Caller holds this target's delivery lock. A retry may reach this after either side of the receipt->queue
// crash boundary; exact mid identity makes reconstruction idempotent without inspecting message text.
export function ensurePendingWhileLocked(id: string, msg: PendingMessage): boolean {
  const current = read(id)
  if (current.some((pending) => pending.mid === msg.mid)) return false
  write(id, [...current, msg])
  return true
}

export const pendingMessages = (id: string): PendingMessage[] => read(id)

export const owesDelivery = (id: string): boolean => existsSync(queuePath(id))

// Record transitions and queue mutations take locks in the same direction: record locks first, then these
// target queue locks. A batch reparent needs all child queues held at once so its pointer/watch/debt change
// either commits together or restores together.
export async function withDeliveryLocks<T>(rawIds: string[], body: () => Promise<T>, index = 0, ids = [...new Set(rawIds)].sort()): Promise<T> {
  if (index >= ids.length) return body()
  const release = await acquire(ids[index], 30_000)
  if (!release) throw new Error(`delivery queue ${ids[index]}: timed out waiting for transaction lock`)
  try { return await withDeliveryLocks(ids, body, index + 1, ids) }
  finally { release() }
}

// Hand over what is owed, in order, exactly once. `insert` reports whether the adapter took the message: only
// then is the entry dropped. A refusal ENDS the pass with that entry still queued and everything behind it
// still behind it — order is a property of a conversation, so a message is never skipped to deliver a later
// one. Returns how many were handed over and how many are still owed.
export async function drain(
  id: string,
  insert: (msg: PendingMessage) => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<{ delivered: number; remaining: number }> {
  const release = await acquire(id, timeoutMs)
  if (!release) return { delivered: 0, remaining: read(id).length }
  let delivered = 0
  try {
    for (;;) {
      const queued = read(id)
      if (!queued.length) return { delivered, remaining: 0 }
      if (queued[0].from && senderDeliveryRevoked(queued[0].from)) {
        // Closing a sender voids its undelivered output, not the recipient's immutable conversation history.
        // Drop a revoked head and continue so it cannot permanently block the messages behind it.
        write(id, read(id).filter((m) => m.mid !== queued[0].mid))
        continue
      }
      let ok = false
      try { ok = await insert(queued[0]) } catch { ok = false }
      if (!ok) return { delivered, remaining: queued.length }
      // Re-read before removing: a send that landed while this pass ran appended to the tail, and rewriting a
      // stale snapshot minus the head would silently drop it.
      write(id, read(id).filter((m) => m.mid !== queued[0].mid))
      delivered++
    }
  } finally { release() }
}
