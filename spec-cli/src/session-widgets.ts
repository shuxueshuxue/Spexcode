import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { putBlob, readRecordEntry, sessionArtifactPath } from '@spexcode/spec-core'

export class SessionWidgetError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 413 | 500, message: string) {
    super(message)
    this.name = 'SessionWidgetError'
  }
}

type SessionWidgetLock = <T>(id: string, body: () => T) => T

// A widget is drawn into a conversation, so its whole document has to arrive before a reader can look at it.
// The ceiling is far above a hand-written component and far below the posted-file preview bound, which exists
// for captured evidence rather than for markup rendered inline.
export const SESSION_WIDGET_MAX_BYTES = 4 * 1024 * 1024
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

export type SessionWidget = {
  name: string
  body: string            // the content hash of the document the last put stored
  state: unknown          // what the human's last send committed; null until one has
  updatedAt: string
}

const widgetsPath = (id: string) => sessionArtifactPath(id, 'widgets.json')

function requireSession(id: string): void {
  const record = readRecordEntry(id)
  if (record.kind === 'absent') throw new SessionWidgetError(404, `session ${id} does not exist`)
  if (record.kind === 'corrupt') throw new SessionWidgetError(500, `session ${id} has an unreadable record: ${record.error}`)
}

function requireName(name: string): string {
  if (!NAME.test(name)) throw new SessionWidgetError(400, `invalid widget name '${name}' — lowercase letters, digits and dashes, starting with a letter or digit`)
  return name
}

function readWidgets(id: string): SessionWidget[] {
  const path = widgetsPath(id)
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new SessionWidgetError(500, `session widget index is unreadable: ${path} — ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new SessionWidgetError(500, `session widget index is invalid: ${path}`)
  const widgets: SessionWidget[] = []
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as { body?: unknown; state?: unknown; updatedAt?: unknown }
    if (!NAME.test(name) || !entry || typeof entry !== 'object' || typeof entry.body !== 'string')
      throw new SessionWidgetError(500, `session widget index is invalid: ${path}`)
    widgets.push({ name, body: entry.body, state: entry.state ?? null, updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '' })
  }
  return widgets.sort((a, b) => a.name.localeCompare(b.name))
}

function writeWidgets(id: string, widgets: readonly SessionWidget[]): void {
  const path = widgetsPath(id)
  const index: Record<string, { body: string; state: unknown; updatedAt: string }> = {}
  for (const widget of widgets) index[widget.name] = { body: widget.body, state: widget.state ?? null, updatedAt: widget.updatedAt }
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`)
    renameSync(tmp, path)
  } finally {
    try { unlinkSync(tmp) } catch { /* rename already consumed the temporary file */ }
  }
}

function readDocument(path: string): Buffer {
  let bytes: Buffer
  try {
    if (!statSync(path).isFile()) throw new SessionWidgetError(400, `not a regular file: ${path}`)
    bytes = readFileSync(path)
  } catch (error) {
    if (error instanceof SessionWidgetError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new SessionWidgetError(404, `file does not exist: ${path}`)
    throw new SessionWidgetError(403, `file is not readable: ${path}`)
  }
  if (bytes.length === 0) throw new SessionWidgetError(400, `refusing an empty widget document: ${path}`)
  if (bytes.length > SESSION_WIDGET_MAX_BYTES)
    throw new SessionWidgetError(413, `widget document is ${bytes.length} bytes, over the ${SESSION_WIDGET_MAX_BYTES} byte ceiling: ${path}`)
  return bytes
}

// Session projections already hold a parsed runtime envelope, so this read stays free of the route's
// existence guard, exactly as the posted-file list does.
export function readSessionWidgets(id: string): SessionWidget[] {
  return readWidgets(id)
}

export function listSessionWidgets(id: string): SessionWidget[] {
  requireSession(id)
  return readWidgets(id)
}

export function showSessionWidget(id: string, name: string): SessionWidget {
  requireSession(id)
  const widget = readWidgets(id).find((entry) => entry.name === name)
  if (!widget) throw new SessionWidgetError(404, `session ${id} has no widget named '${name}'`)
  return widget
}

export const widgetReference = (name: string): string => `[[widget:${name}]]`

// The body is stored by content, so a put is idempotent in the only sense that matters: re-putting an
// unchanged document leaves the same hash under the same name and moves nothing a reader can see.
export function putSessionWidget(id: string, name: string, input: string, lock: SessionWidgetLock, cwd = process.cwd()): { name: string; body: string; changed: boolean; reference: string } {
  requireName(name)
  const path = resolve(cwd, input)
  const bytes = readDocument(path)
  const body = putBlob(bytes)
  return lock(id, () => {
    requireSession(id)
    const widgets = readWidgets(id)
    const current = widgets.find((entry) => entry.name === name)
    if (current?.body === body) return { name, body, changed: false, reference: widgetReference(name) }
    const next: SessionWidget = { name, body, state: current?.state ?? null, updatedAt: new Date().toISOString() }
    writeWidgets(id, [...widgets.filter((entry) => entry.name !== name), next])
    return { name, body, changed: true, reference: widgetReference(name) }
  })
}

// The value half of a widget, written by the human's send. A send names a widget that has since been
// retracted only by racing it; there is nothing to attach the value to, so it is dropped rather than
// resurrecting an entry whose body is gone.
export function setSessionWidgetState(id: string, name: string, state: unknown, lock: SessionWidgetLock): SessionWidget | null {
  requireName(name)
  return lock(id, () => {
    requireSession(id)
    const widgets = readWidgets(id)
    const current = widgets.find((entry) => entry.name === name)
    if (!current) return null
    const next: SessionWidget = { ...current, state: state ?? null, updatedAt: new Date().toISOString() }
    writeWidgets(id, [...widgets.filter((entry) => entry.name !== name), next])
    return next
  })
}

export function retractSessionWidget(id: string, name: string, lock: SessionWidgetLock): { name: string; removed: boolean } {
  requireName(name)
  return lock(id, () => {
    requireSession(id)
    const widgets = readWidgets(id)
    if (!widgets.some((entry) => entry.name === name)) return { name, removed: false }
    writeWidgets(id, widgets.filter((entry) => entry.name !== name))
    return { name, removed: true }
  })
}

export const sessionWidgetsPath = (id: string) => widgetsPath(id)
