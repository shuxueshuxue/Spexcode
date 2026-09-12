import { accessSync, constants, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { readRecordEntry, sessionArtifactPath } from '@spexcode/spec-core'
import { completedUpload, uploadPathsIn } from './uploads.js'

export class SessionFileError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 500, message: string) {
    super(message)
    this.name = 'SessionFileError'
  }
}

type SessionFileLock = <T>(id: string, body: () => T) => T
type SessionFileAsyncLock = <T>(id: string, body: () => Promise<T>) => Promise<T>

export const SESSION_FILE_PREVIEW_MAX_BYTES = 16 * 1024 * 1024
export type SessionFilePreviewKind = 'text' | 'image' | 'html'
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.ini', '.log', '.csv', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.xml', '.py', '.go', '.rs', '.java', '.sh', '.sql'])
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
}

const filesPath = (id: string) => sessionArtifactPath(id, 'files.json')

function requireSession(id: string): void {
  const record = readRecordEntry(id)
  if (record.kind === 'absent') throw new SessionFileError(404, `session ${id} does not exist`)
  if (record.kind === 'corrupt') throw new SessionFileError(500, `session ${id} has an unreadable record: ${record.error}`)
}

function readFiles(id: string): string[] {
  const path = filesPath(id)
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new SessionFileError(500, `session file list is unreadable: ${path} — ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || !isAbsolute(value)))
    throw new SessionFileError(500, `session file list is invalid: ${path}`)
  return [...new Set(parsed)]
}

function writeFiles(id: string, files: string[]): void {
  const path = filesPath(id)
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(files, null, 2)}\n`)
    renameSync(tmp, path)
  } finally {
    try { unlinkSync(tmp) } catch { /* rename already consumed the temporary file */ }
  }
}

function currentFile(path: string): void {
  try {
    if (!statSync(path).isFile()) throw new SessionFileError(400, `not a regular file: ${path}`)
    accessSync(path, constants.R_OK)
  } catch (error) {
    if (error instanceof SessionFileError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new SessionFileError(404, `file does not exist: ${path}`)
    throw new SessionFileError(403, `file is not readable: ${path}`)
  }
}

export function listSessionFiles(id: string): string[] {
  requireSession(id)
  return readSessionFiles(id)
}

export type SessionFileStatus = { path: string; valid: boolean; reason?: string }

export function inspectSessionFiles(id: string): SessionFileStatus[] {
  requireSession(id)
  return readFiles(id).map((path) => {
    try { currentFile(path); return { path, valid: true } }
    catch (error) { return { path, valid: false, reason: error instanceof Error ? error.message : String(error) } }
  })
}

// Session projections already hold a parsed runtime envelope; re-checking it here would make an in-memory
// projection depend on the public route's existence guard. The route-facing list keeps that guard above.
export function readSessionFiles(id: string): string[] {
  return readFiles(id)
}

// How prose points at a posted file: the shortest `/`-bounded tail of its path that no other posted path
// shares. The dashboard resolves `[[file:<tail>]]` against the same list by the same rule, so the reference
// printed here is one it will open.
export function fileReference(path: string, files: readonly string[]): string {
  const parts = path.split('/').filter(Boolean)
  for (let n = 1; n <= parts.length; n++) {
    const tail = parts.slice(-n).join('/')
    if (files.filter((other) => other.endsWith(`/${tail}`)).length === 1) return `[[file:${tail}]]`
  }
  return `[[file:${path}]]`
}

export function addSessionFile(id: string, input: string, lock: SessionFileLock, cwd = process.cwd()): { path: string; added: boolean; reference: string } {
  const path = resolve(cwd, input)
  currentFile(path)
  return lock(id, () => {
    requireSession(id)
    const files = readFiles(id)
    if (files.includes(path)) return { path, added: false, reference: fileReference(path, files) }
    const next = [...files, path]
    writeFiles(id, next)
    return { path, added: true, reference: fileReference(path, next) }
  })
}

export type SessionUpload = { path: string; name: string; uploadedAt: number }

export function sessionUploads(files: readonly string[]): SessionUpload[] {
  return files.flatMap((path) => {
    const upload = completedUpload(path)
    return upload ? [{ path, ...upload }] : []
  })
}

// Only a completed upload that still exists is posted; any other path the text mentions is left alone. The
// backend posts while a starting session's own transactions hold its record, so this waits for the lock.
export async function postSentUploads(id: string, text: string, lock: SessionFileAsyncLock): Promise<string[]> {
  const sent = uploadPathsIn(text).filter((path) => {
    try { currentFile(path); return true } catch { return false }
  })
  if (!sent.length) return []
  return lock(id, async () => {
    requireSession(id)
    const files = readFiles(id)
    const added = sent.filter((path) => !files.includes(path))
    if (added.length) writeFiles(id, [...files, ...added])
    return added
  })
}

export function retractSessionFile(id: string, input: string, lock: SessionFileLock, cwd = process.cwd()): { path: string; removed: boolean } {
  const path = resolve(cwd, input)
  return lock(id, () => {
    requireSession(id)
    const files = readFiles(id)
    if (!files.includes(path)) return { path, removed: false }
    writeFiles(id, files.filter((file) => file !== path))
    return { path, removed: true }
  })
}

export function openSessionFile(id: string, path: string): { path: string; name: string; size: number } {
  requireSession(id)
  if (!readFiles(id).includes(path)) throw new SessionFileError(403, 'that path was not posted by this session')
  try {
    const stat = statSync(path)
    if (!stat.isFile()) throw new SessionFileError(404, `file no longer exists: ${path}`)
    accessSync(path, constants.R_OK)
    return { path, name: basename(path) || 'download', size: stat.size }
  } catch (error) {
    if (error instanceof SessionFileError) throw error
    throw new SessionFileError(404, `file no longer exists: ${path}`)
  }
}

export function sessionFilePreviewKind(path: string): { kind: SessionFilePreviewKind; contentType: string } | null {
  const extension = basename(path).toLowerCase().match(/\.[^.]+$/)?.[0]
  if (!extension) return null
  if (HTML_EXTENSIONS.has(extension)) return { kind: 'html', contentType: 'text/html; charset=utf-8' }
  if (TEXT_EXTENSIONS.has(extension)) return { kind: 'text', contentType: 'text/plain; charset=utf-8' }
  const contentType = IMAGE_TYPES[extension]
  return contentType ? { kind: 'image', contentType } : null
}

export const sessionFilesPath = (id: string) => filesPath(id)
