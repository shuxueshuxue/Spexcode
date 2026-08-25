import { mkdirSync, openSync, readFileSync, unlinkSync, writeSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { runtimeRoot } from '@spexcode/spec-core'

const lockRoot = (): string => join(runtimeRoot(), '.delivery-locks')
const lockPath = (id: string): string => join(lockRoot(), `${id}.lock`)
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function acquire(id: string, timeoutMs: number): Promise<() => void> {
  mkdirSync(lockRoot(), { recursive: true })
  const path = lockPath(id), deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return () => { try { unlinkSync(path) } catch { /* a dead owner may have reclaimed it */ } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner = 0
      try { owner = Number(readFileSync(path, 'utf8').trim()) || 0 } catch { /* creator/releaser race */ }
      if (owner && owner !== process.pid) {
        try { process.kill(owner, 0) } catch { try { unlinkSync(path) } catch { /* race */ }; continue }
      }
      if (Date.now() >= deadline) throw new Error(`delivery queue ${id}: timed out waiting for transaction lock`)
      await pause(25)
    }
  }
}

/** Serialize delivery claims without making the transport itself part of SQLite. */
export async function withDeliveryLocks<T>(rawIds: string[], body: () => Promise<T>, index = 0, ids = [...new Set(rawIds)].sort()): Promise<T> {
  if (index >= ids.length) return body()
  const release = await acquire(ids[index], 30_000)
  try { return await withDeliveryLocks(ids, body, index + 1, ids) }
  finally { release() }
}
