import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { gitCommonDir } from '../../spec-cli/src/layout.js'

export const MISS_BLOB = 'miss original file'

export function cacheDir(): string {
  return join(gitCommonDir(), 'spexcode', 'evidence')
}

const BLOB_NAME = /^[0-9a-f]{64}$/

export function putBlob(bytes: Buffer, dir = cacheDir()): string {
  const sha = createHash('sha256').update(bytes).digest('hex')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, sha)
  if (!existsSync(p)) writeFileSync(p, bytes)
  return sha
}

export function blobPath(sha: string, dir = cacheDir()): string {
  return join(dir, sha)
}

export function hasBlob(sha: string | null, dir = cacheDir()): boolean {
  return !!sha && existsSync(blobPath(sha, dir))
}

export function resolveBlob(sha: string | null, dir = cacheDir()): string {
  if (!sha) return ''
  return hasBlob(sha, dir) ? blobPath(sha, dir) : MISS_BLOB
}

export function listBlobs(dir = cacheDir()): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => BLOB_NAME.test(n)).sort()
}

export function gc(keep: Set<string>, dir = cacheDir()): string[] {
  const removed: string[] = []
  for (const name of listBlobs(dir)) {
    if (keep.has(name)) continue
    rmSync(blobPath(name, dir))
    removed.push(name)
  }
  return removed
}

export function getBlob(sha: string | null, dir = cacheDir()): Buffer | null {
  return hasBlob(sha, dir) ? readFileSync(blobPath(sha!, dir)) : null
}

export function isStrayBlob(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return BLOB_NAME.test(base) || path.includes('spexcode/evidence/') || path.includes('/yatsu-blobs/') // dead-words-ok: archived cache dir name — a stray copy of the retired cache is still rejected
}
