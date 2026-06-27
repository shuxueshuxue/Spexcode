import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { gitCommonDir } from '../../spec-cli/src/layout.js'

export const MISS_BLOB = 'miss original file'

// every cache fn takes an optional `dir` (defaulting to the live cache dir) so the logic is testable
// against a temp dir without a git repo.
export function cacheDir(): string {
  return join(gitCommonDir(), 'spexcode', 'yatsu-blobs')
}

// a content-addressed blob name = the sha256 of its bytes (64 hex). The backstop recognises a stray one.
const BLOB_NAME = /^[0-9a-f]{64}$/

// store bytes, return the content hash (the value recorded as a reading's `blob`). Idempotent: identical
// content maps to the same name, written once.
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

// render a reading's blob reference: the cache path when present, the MISS sentinel when the record
// outlived its bytes, '' when the reading had no image at all (a pixel-less observation).
export function resolveBlob(sha: string | null, dir = cacheDir()): string {
  if (!sha) return ''
  return hasBlob(sha, dir) ? blobPath(sha, dir) : MISS_BLOB
}

// every content-addressed blob currently in the cache.
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

// read a blob's bytes (used by callers that render/serve a reading's pixels); null when absent.
export function getBlob(sha: string | null, dir = cacheDir()): Buffer | null {
  return hasBlob(sha, dir) ? readFileSync(blobPath(sha!, dir)) : null
}

// is a staged repo path a stray content-addressed blob? (a 64-hex basename, or anything under a
// yatsu-blobs dir). The pre-commit backstop rejects these so pixels never leak into git history.
export function isStrayBlob(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return BLOB_NAME.test(base) || path.includes('/yatsu-blobs/')
}
