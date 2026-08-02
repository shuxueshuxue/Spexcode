import { createHash } from 'node:crypto'
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readRecordEntry, sessionArtifactPath, sessionStoreDir } from './layout.js'
import { projectRuntimeRoot } from './project-store.js'

export class SessionWebError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 500, message: string) {
    super(message)
    this.name = 'SessionWebError'
  }
}

type SessionWebLock = <T>(id: string, body: () => T) => T
export type SessionWeb = { url: string; key: string }

const webPath = (id: string, projectRoot?: string): string => projectRoot
  ? join(projectRuntimeRoot(join(projectRoot, '.git')), 'sessions', id, 'web.json')
  : sessionArtifactPath(id, 'web.json')

const recordPath = (id: string, projectRoot?: string): string => projectRoot
  ? join(projectRuntimeRoot(join(projectRoot, '.git')), 'sessions', id, 'session.json')
  : join(sessionStoreDir(id), 'session.json')

function validSessionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
}

function requireSession(id: string, projectRoot?: string): void {
  if (!validSessionId(id)) throw new SessionWebError(404, `session ${id} does not exist`)
  if (!projectRoot) {
    const record = readRecordEntry(id)
    if (record.kind === 'absent') throw new SessionWebError(404, `session ${id} does not exist`)
    if (record.kind === 'corrupt') throw new SessionWebError(500, `session ${id} has an unreadable record: ${record.error}`)
    return
  }
  const path = recordPath(id, projectRoot)
  let record: unknown
  try { record = JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new SessionWebError(404, `session ${id} does not exist`)
    throw new SessionWebError(500, `session ${id} has an unreadable record: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!record || typeof record !== 'object' || (record as { session_id?: unknown }).session_id !== id)
    throw new SessionWebError(500, `session ${id} has an unreadable record`)
}

export function canonicalSessionWebUrl(input: string): string {
  let url: URL
  try { url = new URL(input.trim()) }
  catch { throw new SessionWebError(400, `invalid local web URL: ${input}`) }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host) || !url.port || url.username || url.password) {
    throw new SessionWebError(400, 'web URL must be http://127.0.0.1:<port>/..., http://localhost:<port>/..., or http://[::1]:<port>/...')
  }
  if (url.search || url.hash) throw new SessionWebError(400, 'web URL must not include a query or fragment; publish the service base URL')
  return url.href
}

export function sessionWebKey(url: string): string {
  return createHash('sha256').update(url).digest('base64url')
}

function readWebs(id: string, projectRoot?: string): string[] {
  const path = webPath(id, projectRoot)
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new SessionWebError(500, `session web list is unreadable: ${path} — ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string'))
    throw new SessionWebError(500, `session web list is invalid: ${path}`)
  try {
    if (parsed.some((value) => canonicalSessionWebUrl(value) !== value)) throw new Error('not canonical')
  } catch {
    throw new SessionWebError(500, `session web list is invalid: ${path}`)
  }
  return [...new Set(parsed)]
}

function writeWebs(id: string, webs: string[]): void {
  const path = webPath(id)
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(webs, null, 2)}\n`)
    renameSync(tmp, path)
  } finally {
    try { unlinkSync(tmp) } catch { /* rename already consumed the temporary file */ }
  }
}

const toWeb = (url: string): SessionWeb => ({ url, key: sessionWebKey(url) })

export function listSessionWebs(id: string, projectRoot?: string): SessionWeb[] {
  requireSession(id, projectRoot)
  return readWebs(id, projectRoot).map(toWeb)
}

export function addSessionWeb(id: string, input: string, lock: SessionWebLock): { url: string; added: boolean } {
  const url = canonicalSessionWebUrl(input)
  return lock(id, () => {
    requireSession(id)
    const webs = readWebs(id)
    if (webs.includes(url)) return { url, added: false }
    writeWebs(id, [...webs, url])
    return { url, added: true }
  })
}

export function retractSessionWeb(id: string, input: string, lock: SessionWebLock): { url: string; removed: boolean } {
  const url = canonicalSessionWebUrl(input)
  return lock(id, () => {
    requireSession(id)
    const webs = readWebs(id)
    if (!webs.includes(url)) return { url, removed: false }
    writeWebs(id, webs.filter((web) => web !== url))
    return { url, removed: true }
  })
}

export function postedSessionWeb(id: string, key: string, projectRoot?: string): URL {
  requireSession(id, projectRoot)
  const web = readWebs(id, projectRoot).map(toWeb).find((entry) => entry.key === key)
  if (!web) throw new SessionWebError(403, 'that web service was not posted by this session')
  return new URL(web.url)
}

export const sessionWebsPath = (id: string) => webPath(id)
