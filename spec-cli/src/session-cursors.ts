import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sessionArtifactPath, sessionStoreDir } from './layout.js'
import type { TimelineEvent } from './session-timeline.js'

// @@@ session-cursors - a reader's durable place in a log. One `cursors.json` per session in its global store
// dir: `inbox` is its place in its OWN timeline, `follows` one entry per followed session. A position is an
// event INDEX into timeline.ndjson (lines already consumed), so it is also the index of the next unread event.

export type Cursors = { version: 1; inbox: number; follows: Record<string, number> }

const cursorsPath = (id: string): string => sessionArtifactPath(id, 'cursors.json')
const at = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

// Never throws: a missing, empty, or unparseable file reads as "nothing consumed", because re-showing a
// message is the honest recovery for a lost position and skipping one is not. Followed entries whose target
// store dir is gone are dropped here — expiry is this read, and the next write persists it.
export function readCursors(id: string): Cursors {
  let raw: { inbox?: unknown; follows?: unknown } | null = null
  try { raw = JSON.parse(readFileSync(cursorsPath(id), 'utf8')) } catch { /* no cursors yet */ }
  const follows: Record<string, number> = {}
  const stored = raw?.follows
  if (stored && typeof stored === 'object') {
    for (const [target, pos] of Object.entries(stored as Record<string, unknown>)) {
      if (!target || !existsSync(sessionStoreDir(target))) continue
      follows[target] = at(pos)
    }
  }
  return { version: 1, inbox: at(raw?.inbox), follows }
}

// Written whole and atomically, one field per line — the same shape as the session record, so the mark-active
// hook can read its inbox position with an exact whole-line match in pure shell.
function writeCursors(id: string, cursors: Cursors): void {
  const dir = sessionStoreDir(id)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.cursors.json.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(cursors, null, 2) + '\n')
  renameSync(tmp, cursorsPath(id))
}

export const inboxCursor = (id: string): number => readCursors(id).inbox

// A reader that has shown everything up to `to`. Monotonic: a stale read can leave the position too low
// (a message shown twice), never too high (a message lost).
export function advanceInbox(id: string, to: number): void {
  const cursors = readCursors(id)
  if (to <= cursors.inbox) return
  writeCursors(id, { ...cursors, inbox: to })
}

export const followCursor = (id: string, target: string): number | null => {
  const stored = readCursors(id).follows[target]
  return stored === undefined ? null : stored
}

// Start or advance a follow. Following IS this entry existing, so the first call registers the relationship.
export function advanceFollow(id: string, target: string, to: number): void {
  const cursors = readCursors(id)
  const stored = cursors.follows[target]
  if (stored !== undefined && to <= stored) return
  writeCursors(id, { ...cursors, follows: { ...cursors.follows, [target]: Math.max(0, Math.floor(to)) } })
}

export const followedSessions = (id: string): string[] => Object.keys(readCursors(id).follows)

const sameStatus = (a: TimelineEvent, b: TimelineEvent): boolean =>
  a.kind === 'status' && b.kind === 'status' && a.status === b.status
  && (a.proposal ?? null) === (b.proposal ?? null) && (a.note ?? null) === (b.note ?? null)

// @@@ edges, not lines - what a reader has not yet seen, with repeated status lines dropped. X→X IS NOT A
// TRANSITION: the log is append-only and already holds runs of identical status lines from before the
// timeline observer was deleted (every stray `spex serve` process ran an fs.watch over the same store and
// re-recorded each real move, so ONE transition landed as up to 6 lines within ~200ms). Those bytes are
// history and stay. Any consumer that decides "did it move?" must therefore compare VALUES, never adjacency,
// and must compare against the last status the reader ALREADY saw — otherwise a duplicate straddling the
// cursor boundary reads as a fresh move on the very next tick. `next` is where the cursor goes after consuming
// the WHOLE slice: the full length, because a dropped duplicate is still consumed. `at[i]` is the absolute
// index of `events[i]`, which is what lets a reader that STOPS on one event ([[session-follow]]'s take-one
// wait) advance to exactly `at[i] + 1` and leave the lines behind it unread for the next reader.
export function unreadSince(events: TimelineEvent[], from: number): { events: TimelineEvent[]; at: number[]; next: number } {
  const start = Math.min(Math.max(0, Math.floor(from)), events.length)
  let prev: TimelineEvent | null = null
  for (let i = start - 1; i >= 0; i--) if (events[i].kind === 'status') { prev = events[i]; break }
  const out: TimelineEvent[] = []
  const at: number[] = []
  for (let i = start; i < events.length; i++) {
    const e = events[i]
    if (e.kind === 'status') {
      if (prev && sameStatus(prev, e)) continue
      prev = e
    }
    out.push(e)
    at.push(i)
  }
  return { events: out, at, next: events.length }
}
