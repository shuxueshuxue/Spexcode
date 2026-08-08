import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, appendFileSync, mkdirSync, statSync, readdirSync, openSync, closeSync, readSync } from 'node:fs'
import { basename, join } from 'node:path'
import { sessionStoreDir, sessionArtifactPath, readAliasedRawRecord } from './layout.js'
import type { Lifecycle, Proposal } from './sessions.js'
import type { ExecutionTurn } from './execution-trace.js'

// @@@ session-timeline - the session's append-only log in its global store dir: every authored-lifecycle
// transition (status + proposal + the FULL note text) and every message addressed to it. It is what a
// terminal-free surface renders as the conversation, and it is the DELIVERY itself — a message is delivered
// when its bytes are in this file.
//
// There is exactly ONE writer path for the authored axis: every lifecycle hook shells to `spex internal
// session-*`, the same TypeScript writer the CLI declarations use, so no move reaches session.json without
// reaching this log. That is why there is no observer process, no repair tick, and no read-time folding of a
// move recorded twice — nothing writes state behind this module's back.

export type TimelineEvent =
  | { ts: string; kind: 'status'; status: Lifecycle; proposal: Proposal | null; note: string | null; display?: string }
  | { ts: string; kind: 'sent'; mid: string; text: string; from: string | null; replyVia?: 'note' }

export type SentDispatchReceipt = {
  operation: 'merge'
  requestDigest: string
  payloadHash: string
  delivery?: { text: string; from: string | null }
}
type DispatchSettlement = { ts: string; kind: 'dispatch-settled'; operation: 'merge'; requestDigest: string; mid: string }
type StoredTimelineEvent =
  | Extract<TimelineEvent, { kind: 'status' }>
  | (Extract<TimelineEvent, { kind: 'sent' }> & { dispatchReceipt?: SentDispatchReceipt })
  | DispatchSettlement

const timelinePath = (id: string): string => sessionArtifactPath(id, 'timeline.ndjson')
const segmentsDir = (id: string): string => sessionArtifactPath(id, 'timeline')
const SEGMENT = /^(\d+)\.ndjson$/
const SEGMENT_NAME_WIDTH = 12
const TAIL_BLOCK_BYTES = 64 * 1024

// One logical timeline is legacy timeline.ndjson followed by immutable numbered segments. The directory
// listing is its only index: numbering is append order, so there is no mutable manifest to repair.
function segmentFiles(id: string): string[] {
  try {
    const dir = segmentsDir(id)
    const names = readdirSync(dir).filter((name) => SEGMENT.test(name)).sort((a, b) => {
      const an = BigInt(SEGMENT.exec(a)![1]), bn = BigInt(SEGMENT.exec(b)![1])
      return an < bn ? -1 : an > bn ? 1 : 0
    })
    return names.map((name) => join(dir, name))
  } catch { /* no numbered segments yet */ }
  return []
}

function timelineFiles(id: string): string[] {
  const files: string[] = []
  const legacy = timelinePath(id)
  if (existsSync(legacy)) files.push(legacy)
  files.push(...segmentFiles(id))
  return files
}

const segmentLimit = (): number => {
  const configured = Number(process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES)
  return Number.isFinite(configured) ? Math.max(1024, Math.floor(configured)) : 4 * 1024 * 1024
}

function activeSegment(id: string, bytes: number): string {
  const dir = segmentsDir(id)
  mkdirSync(dir, { recursive: true })
  const segments = segmentFiles(id)
  const current = segments.at(-1)
  if (!current) return join(dir, `${String(1).padStart(SEGMENT_NAME_WIDTH, '0')}.ndjson`)
  try {
    if (statSync(current).size === 0 || statSync(current).size + bytes <= segmentLimit()) return current
  } catch { /* a vanished active segment is recreated under its next number */ }
  const n = BigInt(SEGMENT.exec(basename(current))![1]) + 1n
  return join(dir, `${String(n).padStart(SEGMENT_NAME_WIDTH, '0')}.ndjson`)
}

function append(id: string, ev: StoredTimelineEvent): void {
  mkdirSync(sessionStoreDir(id), { recursive: true })
  const line = JSON.stringify(ev) + '\n'
  appendFileSync(activeSegment(id, Buffer.byteLength(line)), line)
}

function parseLines(lines: string[]): StoredTimelineEvent[] {
  return lines.map((l) => {
    try { return JSON.parse(l) as StoredTimelineEvent } catch { return null }
  }).filter((e): e is StoredTimelineEvent => e != null && (e.kind === 'status' || e.kind === 'sent' || e.kind === 'dispatch-settled'))
}

function tailPublicEvents(path: string, limit: number): Exclude<StoredTimelineEvent, DispatchSettlement>[] {
  let fd: number | null = null
  try {
    const size = statSync(path).size
    fd = openSync(path, 'r')
    let start = size
    let text = ''
    while (start > 0) {
      const next = Math.max(0, start - TAIL_BLOCK_BYTES)
      const buf = Buffer.alloc(start - next)
      readSync(fd, buf, 0, buf.length, next)
      text = buf.toString('utf8') + text
      const publicCount = parseLines(text.split('\n').filter(Boolean)).filter((event) => event.kind !== 'dispatch-settled').length
      if (publicCount >= limit || next === 0) break
      start = next
    }
    return parseLines(text.split('\n').filter(Boolean))
      .filter((event): event is Exclude<StoredTimelineEvent, DispatchSettlement> => event.kind !== 'dispatch-settled')
      .slice(-limit)
  } catch { return [] }
  finally { if (fd !== null) closeSync(fd) }
}

// Record a lifecycle value that has already landed in session.json. TypeScript state writers call this
// synchronously before returning, so a later write cannot erase an intermediate declaration note from the
// conversation. Best-effort: history is an accessory to the state machine, and failing to write it must never
// break the transition that already happened.
export function recordStatus(id: string, status: Lifecycle, proposal: Proposal | null, note: string | null): void {
  try { append(id, { ts: new Date().toISOString(), kind: 'status', status, proposal, note }) }
  catch { /* the record already moved; the history line is the only loss */ }
}

// The DELIVERY ([[dispatch]]): appending this line IS the send, so unlike a status line it must fail LOUD —
// the caller reports the throw rather than a false success. `text` is the message BEFORE any mechanism insert
// (hints are transport, not conversation); `replyVia` is the effective channel the prompt seam chose. Returns
// the new line's `mid`, which a best-effort poke carries.
export function appendSent(id: string, text: string, from: string | null, replyVia?: 'note', dispatchReceipt?: SentDispatchReceipt): { mid: string } {
  const mid = randomUUID()
  append(id, { ts: new Date().toISOString(), kind: 'sent', mid, text, from, ...(replyVia ? { replyVia } : {}), ...(dispatchReceipt ? { dispatchReceipt } : {}) })
  return { mid }
}

export type SentDispatchState = {
  mid: string
  payloadHash: string
  delivery: SentDispatchReceipt['delivery'] | null
  delivered: boolean
}

export function sentDispatchReceipt(id: string, operation: SentDispatchReceipt['operation'], requestDigest: string): SentDispatchState | null {
  let found: Omit<SentDispatchState, 'delivered'> | null = null
  const settled = new Set<string>()
  for (const path of timelineFiles(id)) {
    for (const event of parseLines(readFileSync(path, 'utf8').split('\n').filter(Boolean))) {
      if (event.kind === 'sent' && !found && event.dispatchReceipt?.operation === operation && event.dispatchReceipt.requestDigest === requestDigest) {
        found = { mid: event.mid, payloadHash: event.dispatchReceipt.payloadHash, delivery: event.dispatchReceipt.delivery ?? null }
      } else if (event.kind === 'dispatch-settled' && event.operation === operation && event.requestDigest === requestDigest) {
        settled.add(event.mid)
      }
    }
  }
  return found ? { ...found, delivered: settled.has(found.mid) } : null
}

export function settleSentDispatch(id: string, mid: string): void {
  let receipt: SentDispatchReceipt | null = null
  let settled = false
  for (const path of timelineFiles(id)) {
    for (const event of parseLines(readFileSync(path, 'utf8').split('\n').filter(Boolean))) {
      if (event.kind === 'sent' && event.mid === mid && event.dispatchReceipt?.delivery) receipt = event.dispatchReceipt
      if (event.kind === 'dispatch-settled' && event.mid === mid) settled = true
    }
  }
  if (!receipt || settled) return
  append(id, { ts: new Date().toISOString(), kind: 'dispatch-settled', operation: receipt.operation, requestDigest: receipt.requestDigest, mid })
}

// The unowned read: any process may take it with nothing but filesystem access, and taking it perturbs
// nothing. Index = event position, which is what a cursor names ([[session-cursors]]).
export function timelineEvents(id: string): TimelineEvent[] {
  try {
    return timelineFiles(id).flatMap((path) => parseLines(readFileSync(path, 'utf8').split('\n').filter(Boolean)))
      .flatMap((stored): TimelineEvent[] => {
        if (stored.kind === 'dispatch-settled') return []
        if (stored.kind === 'status') return [stored]
        const { dispatchReceipt: _receipt, ...event } = stored
        return [event]
      })
  } catch { return [] }
}

// the same L0 read taken as CHEAPLY as it can be: a follower ([[session-follow]]) ticks over many logs, so it
// stats first and parses only what grew. null = no log yet (a session that has authored nothing).
export function timelineStamp(id: string): string | null {
  try {
    const path = timelineFiles(id).at(-1)
    if (!path) return null
    const s = statSync(path)
    return `${path}:${s.size}:${s.mtimeMs}`
  }
  catch { return null }
}

// the display word for an authored state — the SAME vocabulary every other surface speaks (awaiting → its
// proposal's label, active → working), duplicated here as a tiny read-time map rather than importing the state
// machine (sessions.ts imports THIS module for appendSent; a value import back would be a cycle — the
// Lifecycle/Proposal imports above are type-only, erased at runtime).
const PROPOSAL_DISPLAY: Record<string, DisplayWord> = { merge: 'review', nothing: 'done', close: 'close-pending' }
type DisplayWord = 'working' | 'idle' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued'
export const timelineDisplay = (e: { status: Lifecycle; proposal: Proposal | null }): DisplayWord =>
  e.status === 'awaiting' ? (PROPOSAL_DISPLAY[e.proposal ?? 'nothing'] ?? 'done')
  : e.status === 'active' ? 'working' : e.status

// the channel of the LAST HUMAN send (from == null): 'note' when the note-reply hint rode along, else null.
// This is what makes the reply-channel hints SYMMETRIC ([[session-timeline]]): a human send with no note flag
// arriving after a note-send is the "back at a terminal" transition, and the delivery gets the counter-insert.
// Derived from the durable log — no new state, and it survives a server restart. Agent senders (`from` set)
// say nothing about where the HUMAN is reading, so they neither set nor clear it.
export function lastHumanSendVia(id: string): 'note' | null {
  const evs = timelineEvents(id)
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i]
    if (e.kind === 'sent' && e.from == null) return e.replyVia === 'note' ? 'note' : null
  }
  return null
}

// The current human turn is a durable fact from the accepted-message log, not a backend-local generation.
export function currentHumanTurn(id: string): ExecutionTurn | null {
  const evs = timelineEvents(id)
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i]
    if (e.kind === 'sent' && e.from == null) return { token: e.mid, acceptedAt: e.ts }
  }
  return null
}

// the read surface behind GET /api/sessions/:id/timeline: the last `limit` events, oldest first, each status
// event carrying its composed display word. null = no such session (the route 404s).
export function readTimeline(id: string, limit = 500): { events: TimelineEvent[] } | null {
  let raw: ReturnType<typeof readAliasedRawRecord>
  try { raw = readAliasedRawRecord(id) } catch { return null }
  if (!raw || !raw.governed) return null
  const wanted = Math.max(1, limit)
  const tail: Exclude<StoredTimelineEvent, DispatchSettlement>[] = []
  for (const path of timelineFiles(id).reverse()) {
    const remaining = wanted - tail.length
    if (remaining <= 0) break
    tail.unshift(...tailPublicEvents(path, remaining))
  }
  return { events: tail.map((e) => {
    if (e.kind === 'status') return { ...e, display: timelineDisplay(e) }
    const { dispatchReceipt: _receipt, ...event } = e
    return event
  }) }
}
