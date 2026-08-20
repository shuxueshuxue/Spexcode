import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { runtimeRoot } from '@spexcode/spec-core'

const lockRoot = () => join(runtimeRoot(), '.session-locks')
const lockPath = (id: string) => join(lockRoot(), `${id}.lock`)
const syncPause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

export class SessionRecordLockTimeout extends Error {
  constructor(id: string) {
    super(`session ${id}: lifecycle transition lock timed out; refusing a stale write`)
    this.name = 'SessionRecordLockTimeout'
  }
}

function acquireSync(id: string, timeoutMs = 30_000): () => void {
  mkdirSync(lockRoot(), { recursive: true })
  const path = lockPath(id), deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return () => { try { unlinkSync(path) } catch { /* another recovery already removed it */ } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner = 0
      try { owner = Number(readFileSync(path, 'utf8').trim()) || 0 } catch { /* race */ }
      if (owner && owner !== process.pid) {
        try { process.kill(owner, 0) } catch { try { unlinkSync(path) } catch { /* race */ }; continue }
      }
      if (Date.now() >= deadline) throw new SessionRecordLockTimeout(id)
      syncPause(10)
    }
  }
}

const aborted = (signal: AbortSignal): Error => signal.reason instanceof Error
  ? signal.reason
  : Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })

async function pause(signal?: AbortSignal): Promise<void> {
  if (!signal) { await new Promise((resolve) => setTimeout(resolve, 10)); return }
  if (signal.aborted) throw aborted(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, 10)
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(aborted(signal)) }
    function done() { signal!.removeEventListener('abort', abort); resolve() }
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function acquire(id: string, timeoutMs = 30_000, signal?: AbortSignal): Promise<() => void> {
  mkdirSync(lockRoot(), { recursive: true })
  const path = lockPath(id), deadline = Date.now() + timeoutMs
  for (;;) {
    if (signal?.aborted) throw aborted(signal)
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return () => { try { unlinkSync(path) } catch { /* another recovery already removed it */ } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner = 0
      try { owner = Number(readFileSync(path, 'utf8').trim()) || 0 } catch { /* race */ }
      if (owner && owner !== process.pid) {
        try { process.kill(owner, 0) } catch { try { unlinkSync(path) } catch { /* race */ }; continue }
      }
      if (Date.now() >= deadline) throw new SessionRecordLockTimeout(id)
      await pause(signal)
    }
  }
}

export async function withSessionRecordLock<T>(id: string, body: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = await acquire(id, 30_000, signal)
  try { return await body() } finally { release() }
}

export function withSessionRecordLockSync<T>(id: string, body: () => T): T {
  const release = acquireSync(id)
  try { return body() } finally { release() }
}

export function trySessionRecordLockSync(id: string): (() => void) | null {
  mkdirSync(lockRoot(), { recursive: true })
  const path = lockPath(id)
  try {
    const fd = openSync(path, 'wx')
    writeSync(fd, String(process.pid))
    closeSync(fd)
    return () => { try { unlinkSync(path) } catch { /* another recovery already removed it */ } }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null
    throw error
  }
}

export async function withSessionRecordLocks<T>(rawIds: string[], body: () => Promise<T>, index = 0, ids = [...new Set(rawIds)].sort()): Promise<T> {
  if (index >= ids.length) return body()
  return withSessionRecordLock(ids[index], () => withSessionRecordLocks(ids, body, index + 1, ids))
}
