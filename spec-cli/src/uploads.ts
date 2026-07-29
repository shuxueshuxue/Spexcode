import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { repoRoot } from './git.js'
import { readUploadPolicy, type UploadPolicy } from './layout.js'

// The backend's tmpdir is the worker's filesystem. Completed files stay directly under this sink; private
// metadata and partial bytes live below .staging until an exact-length transfer is promoted atomically.
const UPLOAD_DIR = join(tmpdir(), 'spexcode-uploads')
const STAGING_DIR = join(UPLOAD_DIR, '.staging')

type UploadMeta = {
  version: 1
  id: string
  name: string
  size: number
  offset: number
  createdAt: number
  updatedAt: number
}

export type UploadStatus = Pick<UploadMeta, 'id' | 'name' | 'size' | 'offset'> & Pick<UploadPolicy,
  'chunkBytes' | 'concurrency' | 'requestTimeoutMs' | 'retryLimit' | 'retryDelayMs'>

export class UploadError extends Error {
  constructor(readonly status: number, message: string, readonly offset?: number) {
    super(message)
  }
}

const uploadPolicy = (): UploadPolicy => readUploadPolicy(repoRoot())

export const evidenceMaxBytes = (): number => uploadPolicy().evidenceMaxBytes

function ensureDirs(): void {
  mkdirSync(STAGING_DIR, { recursive: true })
}

function safeName(name: string): string {
  const base = basename(name || '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  return base || 'upload'
}

function validId(id: string): boolean {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
}

function metaPath(id: string): string {
  return join(STAGING_DIR, `${id}.json`)
}

function partPath(id: string): string {
  return join(STAGING_DIR, `${id}.part`)
}

function removeTransfer(id: string): void {
  rmSync(metaPath(id), { force: true })
  rmSync(partPath(id), { force: true })
}

function readMetaFile(id: string): UploadMeta | null {
  if (!validId(id)) return null
  try {
    const meta = JSON.parse(readFileSync(metaPath(id), 'utf8')) as UploadMeta
    if (meta.version !== 1 || meta.id !== id || typeof meta.name !== 'string' ||
      !Number.isSafeInteger(meta.size) || meta.size <= 0 ||
      !Number.isSafeInteger(meta.offset) || meta.offset < 0 || meta.offset > meta.size ||
      !Number.isSafeInteger(meta.createdAt) || !Number.isSafeInteger(meta.updatedAt)) return null
    return meta
  } catch {
    return null
  }
}

function writeMeta(meta: UploadMeta): void {
  const path = metaPath(meta.id)
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(meta) + '\n')
  renameSync(temp, path)
}

function actualOffset(meta: UploadMeta): number {
  try {
    return statSync(partPath(meta.id)).size
  } catch {
    return 0
  }
}

function status(meta: UploadMeta, policy: UploadPolicy): UploadStatus {
  const { chunkBytes, concurrency, requestTimeoutMs, retryLimit, retryDelayMs } = policy
  return { id: meta.id, name: meta.name, size: meta.size, offset: meta.offset, chunkBytes, concurrency, requestTimeoutMs, retryLimit, retryDelayMs }
}

function syncOffset(meta: UploadMeta): UploadMeta {
  const offset = actualOffset(meta)
  if (offset > meta.size) throw new UploadError(409, 'upload staging file exceeds its declared length')
  if (offset !== meta.offset) {
    meta.offset = offset
    meta.updatedAt = Date.now()
    writeMeta(meta)
  }
  return meta
}

function loadUpload(id: string, policy: UploadPolicy): UploadMeta {
  const meta = readMetaFile(id)
  if (!meta) throw new UploadError(404, 'upload not found')
  if (Date.now() - meta.updatedAt > policy.incompleteTtlMs) {
    removeTransfer(id)
    throw new UploadError(404, 'upload expired')
  }
  return syncOffset(meta)
}

function reservedBytes(policy: UploadPolicy): number {
  let total = 0
  for (const entry of readdirSync(STAGING_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const meta = readMetaFile(entry.name.slice(0, -5))
    if (!meta || Date.now() - meta.updatedAt > policy.incompleteTtlMs) continue
    total += Math.max(0, meta.size - actualOffset(meta))
  }
  return total
}

function reserveCapacity(size: number, policy: UploadPolicy): void {
  let available = 0
  try {
    const fs = statfsSync(UPLOAD_DIR)
    available = Number(fs.bavail) * Number(fs.bsize)
  } catch {
    // A filesystem that cannot report capacity will still fail loudly during the stream write.
    return
  }
  if (size > Math.max(0, available - policy.minFreeBytes - reservedBytes(policy))) {
    throw new UploadError(507, 'insufficient backend disk capacity for this upload')
  }
}

export function cleanupExpiredUploads(policy = uploadPolicy()): void {
  ensureDirs()
  const now = Date.now()
  for (const entry of readdirSync(STAGING_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const id = entry.name.slice(0, -5)
    const meta = readMetaFile(id)
    if (!meta || now - meta.updatedAt > policy.incompleteTtlMs) removeTransfer(id)
  }
  for (const entry of readdirSync(STAGING_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.part')) continue
    const id = entry.name.slice(0, -5)
    if (readMetaFile(id)) continue
    try {
      if (now - statSync(partPath(id)).mtimeMs > policy.incompleteTtlMs) rmSync(partPath(id), { force: true })
    } catch { /* raced a cancellation or another cleanup pass */ }
  }
}

export function startUploadReaper(): void {
  const sweep = () => {
    const policy = uploadPolicy()
    cleanupExpiredUploads(policy)
    const timer = setTimeout(sweep, policy.cleanupIntervalMs)
    timer.unref()
  }
  sweep()
}

export function createUpload(name: unknown, size: unknown): UploadStatus {
  const policy = uploadPolicy()
  if (typeof name !== 'string' || !name.trim()) throw new UploadError(400, 'file name is required')
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) throw new UploadError(400, 'file must not be empty')
  if (size > policy.maxBytes) throw new UploadError(413, 'file exceeds the configured upload limit')
  ensureDirs()
  cleanupExpiredUploads(policy)
  reserveCapacity(size, policy)
  const now = Date.now()
  const meta: UploadMeta = { version: 1, id: randomUUID(), name: safeName(name), size, offset: 0, createdAt: now, updatedAt: now }
  writeMeta(meta)
  return status(meta, policy)
}

export function uploadStatus(id: string): UploadStatus {
  const policy = uploadPolicy()
  return status(loadUpload(id, policy), policy)
}

export async function appendUpload(id: string, offset: unknown, body: ReadableStream<Uint8Array> | null, contentLength?: string): Promise<UploadStatus> {
  const policy = uploadPolicy()
  const meta = loadUpload(id, policy)
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new UploadError(400, 'upload offset must be a non-negative integer')
  if (offset !== meta.offset) throw new UploadError(409, 'upload offset does not match the committed bytes', meta.offset)
  if (!body) throw new UploadError(400, 'upload chunk is required')
  const declared = contentLength == null ? null : Number(contentLength)
  if (declared != null && (!Number.isSafeInteger(declared) || declared <= 0)) throw new UploadError(400, 'content-length must be a positive integer')
  if (declared != null && (declared > policy.chunkBytes || meta.offset + declared > meta.size)) {
    throw new UploadError(413, 'upload chunk exceeds its declared bounds')
  }

  let written = 0
  const before = meta.offset
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      written += chunk.length
      if (written > policy.chunkBytes || before + written > meta.size) {
        callback(new UploadError(413, 'upload chunk exceeds its declared bounds'))
        return
      }
      callback(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(body as unknown as NodeReadableStream), limiter, createWriteStream(partPath(id), { flags: 'a' }))
  } catch (error) {
    if (error instanceof UploadError) {
      truncateSync(partPath(id), before)
      throw error
    }
    // An interrupted connection may have committed a valid prefix. The next GET reports its actual length.
    meta.offset = actualOffset(meta)
    meta.updatedAt = Date.now()
    writeMeta(meta)
    throw new UploadError(500, `upload write failed: ${(error as Error).message}`)
  }
  if (written === 0) throw new UploadError(400, 'upload chunk is empty')
  meta.offset = actualOffset(meta)
  meta.updatedAt = Date.now()
  writeMeta(meta)
  return status(meta, policy)
}

export function completeUpload(id: string): string {
  const meta = loadUpload(id, uploadPolicy())
  if (meta.offset !== meta.size) throw new UploadError(409, `upload is incomplete (${meta.offset} of ${meta.size} bytes)`, meta.offset)
  const path = join(UPLOAD_DIR, `${Date.now().toString(36)}-${meta.id}-${safeName(meta.name)}`)
  try {
    renameSync(partPath(id), path)
    rmSync(metaPath(id), { force: true })
    return path
  } catch (error) {
    throw new UploadError(500, `upload completion failed: ${(error as Error).message}`)
  }
}

export function cancelUpload(id: string): void {
  loadUpload(id, uploadPolicy())
  removeTransfer(id)
}
