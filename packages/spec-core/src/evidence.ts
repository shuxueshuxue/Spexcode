import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { gitCommonDir } from './layout.js'

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

const HEX64 = /^[0-9a-f]{64}$/

export type BlobResult =
  | { ok: true; bytes: Buffer; mime: string }
  | { ok: false; reason: 'invalid' | 'miss'; message: string }

export function readBlobByHash(hash: string, dir?: string): BlobResult {
  if (!HEX64.test(hash)) return { ok: false, reason: 'invalid', message: 'bad evidence hash' }
  const bytes = getBlob(hash, dir)
  if (!bytes) return { ok: false, reason: 'miss', message: MISS_BLOB }
  return { ok: true, bytes, mime: sniffBlobMime(bytes) }
}

function isJsonBlob(b: Buffer): boolean {
  if (!b.length || b.includes(0) || b.length > 4_000_000) return false
  const s = b.toString('utf8').trim()
  const open = s[0], close = s[s.length - 1]
  if (!((open === '{' && close === '}') || (open === '[' && close === ']'))) return false
  try { const v = JSON.parse(s); return v !== null && typeof v === 'object' } catch { return false }
}

export function sniffBlobMime(b: Buffer): string {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (b.length && !b.includes(0)) return isJsonBlob(b) ? 'application/json' : 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}
