import { existsSync } from 'node:fs'
import { sessionStoreDir } from './layout.js'
import { advanceFollow, followCursor, inboxCursor, unreadSince } from './session-cursors.js'
import { timelineDisplay, timelineEvents, timelineStamp } from './session-timeline.js'
import { sessionLabel, type DisplayStatus, type Session } from './sessions.js'

// @@@ session-follow - supervision is FOLLOWING a log past a cursor, never polling a derived board. One tick
// costs ONE stat per target: if timeline.ndjson has not grown, nothing is opened and nothing is parsed. No
// call here reaches the backend, a rendezvous socket, or tmux, which is the whole point — M followers over N
// sessions cost the control plane zero, where the old poll cost one board build (a connect + a tmux spawn per
// live session) per follower per interval.

// Actionable = a state whose arrival means "a human/supervisor must now act". `offline` is deliberately ABSENT
// where the old poll had it: liveness is a present-tense probe derivation, never authored, so it can never
// appear on a log ([[state]]). A follower learns what a session DECLARED and never that it died.
const ACTIONABLE = new Set<DisplayStatus>(['review', 'done', 'close-pending', 'error', 'asking'])
const NEXT: Record<string, string> = {
  review: 'merge | close',
  done: 'merge | close',
  'close-pending': 'close',
  error: 'resume (relaunch & retry) | show --capture | close',
  asking: 'send "<msg>" | show --capture',
  idle: 'send "<msg>" | show --capture',
  queued: 'waiting for a free slot — starts automatically | close',
}
const trunc = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)

export function sessionEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  const asked = s.promptPreview ? ` · asked: ${s.promptPreview}` : ''
  return `[spex] ${s.status} · ${sessionLabel(s)} — act: ${NEXT[s.status] || '—'}${note}${asked}  [id ${s.id}]`
}
// @@@ launchEvent - a session's FIRST sighting, emitted once per id whatever its status, so the stream is a
// complete lifecycle feed: launched → [transitions] → closed. A launch's own first line is `active` (not
// actionable), so without this the feed would be blind to new sessions starting.
export function launchEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  const asked = s.promptPreview ? ` · asked: ${s.promptPreview}` : ''
  return `[spex] launched · ${sessionLabel(s)} — act: capture | send "<msg>"${note}${asked}  [id ${s.id}]`
}

// `targets` is re-read every tick so a BROAD follow picks up sessions that launch while it runs; an explicit
// selector resolves once and hands back a fixed list. `self` is the follower's own session: its inbox rides the
// same follow, and it is where the durable cursors live — a follower with no session record (a human shell)
// keeps them in memory for the life of the process.
export type FollowOpts = {
  targets: () => string[]
  self?: string | null
  statuses?: string[]
  includeIdle?: boolean
  intervalMs?: number
  as?: string
  take?: boolean
  timeoutMs?: number
  onObserved?: (id: string, status: DisplayStatus, previous: DisplayStatus | null) => void
  row?: (id: string, status: DisplayStatus, note: string | null) => Session | null
}
// Only `take` mode (what `spex session wait` runs) resolves; a stream follow never returns. There is no
// transport outcome, because there is no transport: following is reading a file, so the failure that once
// needed its own vocabulary — a backend that could not be reached, misread as a session verdict — cannot occur.
export type FollowOutcome =
  | { reached: DisplayStatus; id: string; path: DisplayStatus[] }
  | { mail: { from: string | null; text: string } }
  | { timedOut: true; path: DisplayStatus[] }
  | { gone: string }

type FollowState = { pos: number; prev: DisplayStatus | null; path: DisplayStatus[]; stamp: string | null }

export async function followSessions(emit: (line: string) => void, opts: FollowOpts): Promise<FollowOutcome> {
  const { targets, self = null, statuses, includeIdle = false, intervalMs = 1000, as, take = false, timeoutMs = 1_200_000, onObserved, row } = opts
  const tag = as ? `[${as}] ` : ''
  const state = new Map<string, FollowState>()
  const memo = new Map<string, number>()   // cursors for a follower that has no record of its own to store them in
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // the no-hang wall: a fixed deadline computed ONCE, checked before EVERY sleep below.
  const deadline = take ? Date.now() + Math.max(1000, timeoutMs) : 0
  const isActionable = (st: DisplayStatus) => ACTIONABLE.has(st) || (includeIdle && st === 'idle')
  const passes = (st: DisplayStatus) => !statuses?.length || statuses.includes(st)
  const anyPath = (): DisplayStatus[] => {
    for (const f of state.values()) if (f.path.length) return f.path
    return []
  }
  const readCursor = (id: string): number | null => (self ? followCursor(self, id) : memo.get(id) ?? null)
  const writeCursor = (id: string, to: number): void => { if (self) advanceFollow(self, id, to); else memo.set(id, to) }
  const line = (id: string, st: DisplayStatus, note: string | null, first: boolean): void => {
    const s = row?.(id, st, note)
    if (!s) return
    if (first) emit(tag + launchEvent(s))
    else if (passes(st) && isActionable(st)) emit(tag + sessionEvent(s))
  }
  let first = true
  let shown = -1   // stream mode: the last inbox line this process printed (see the INBOX read below)

  for (;;) {
    const ids = targets()
    const seen = new Set<string>()
    for (const id of ids) {
      if (id === self) continue   // the follower's own log is its INBOX, followed below on its own cursor rule
      seen.add(id)
      if (!existsSync(sessionStoreDir(id))) {
        if (state.delete(id)) emit(`${tag}[spex] closed · removed  [id ${id}]`)
        if (take) return { gone: id }
        continue
      }
      let f = state.get(id)
      if (!f) {
        const evs = timelineEvents(id)
        // A stored cursor always wins — that IS the resume, losing nothing across a follower's death. With
        // none: a target already present when the follow started predates it, so we begin at the log's END
        // (its history is not news); a target that appears on a LATER tick genuinely just launched, so its
        // whole log is read from 0 and its `launched` line reaches the feed.
        const pos = readCursor(id) ?? (first ? evs.length : 0)
        // The ARRIVAL state is the last status line BEFORE the cursor — a fact on the log, not whatever a poll
        // happened to catch. With no such line the first status we read is the arrival instead.
        let prev: DisplayStatus | null = null
        for (let i = Math.min(pos, evs.length) - 1; i >= 0; i--) {
          const e = evs[i]
          if (e.kind === 'status') { prev = timelineDisplay(e); break }
        }
        f = { pos, prev, path: prev ? [prev] : [], stamp: null }
        state.set(id, f)
        if (prev) { onObserved?.(id, prev, null); line(id, prev, null, true) }
      }
      const stamp = timelineStamp(id)
      if (stamp !== null && stamp === f.stamp) continue   // THE cheap tick: nothing appended, nothing parsed
      f.stamp = stamp
      const evs = timelineEvents(id)
      const slice = unreadSince(evs, f.pos)
      let hit: FollowOutcome | null = null
      for (let k = 0; k < slice.events.length && !hit; k++) {
        const e = slice.events[k]
        if (e.kind === 'sent') {
          const s = row?.(id, f.prev ?? 'unknown', null)
          if (s) emit(`${tag}[spex] message · ${sessionLabel(s)} — from ${e.from ?? 'human'}: ${trunc(e.text, 120)}  [id ${id}]`)
          continue
        }
        const st = timelineDisplay(e)
        const was = f.prev
        f.prev = st
        f.path.push(st)
        onObserved?.(id, st, was)
        line(id, st, e.note, was === null)
        // THE edge: a previously-observed NON-actionable status moving INTO an actionable one. An actionable
        // ARRIVAL (was === null) is not an edge — that standing level is what a level-triggered wait falsely
        // returned on; nor is an actionable→actionable hop (review→done). The rise OUT of non-actionable is the
        // one signal that means "the target needs you AGAIN". The previous state is the previous LINE, so two
        // moves inside one tick are two edges rather than one collapsed sample.
        if (take && was !== null && !isActionable(was) && isActionable(st)) hit = { reached: st, id, path: f.path }
        // Consume exactly up to the event we stopped on, so the lines behind it stay unread for the next wait.
        if (hit) { f.pos = slice.at[k] + 1; writeCursor(id, f.pos) }
      }
      if (hit) return hit
      f.pos = slice.next
      writeCursor(id, f.pos)
    }
    for (const id of [...state.keys()]) {
      if (seen.has(id)) continue
      state.delete(id)
      emit(`${tag}[spex] closed · removed  [id ${id}]`)
    }
    // THE INBOX — the follower's own log, read past the cursor `cursors.json` already holds and NEVER advanced
    // here: the turn-boundary mark-active hook is the inbox's one reader ([[session-timeline]]), and advancing
    // behind its back would wake this process on a message the agent is then never shown. Re-read every tick, so
    // a line that hook has since injected stops counting as unread and cannot wake a later wait twice.
    if (self && existsSync(sessionStoreDir(self))) {
      const mine = unreadSince(timelineEvents(self), inboxCursor(self))
      for (let k = 0; k < mine.events.length; k++) {
        const e = mine.events[k]
        if (e.kind !== 'sent') continue
        if (take) return { mail: { from: e.from, text: e.text } }
        // a stream has no turn boundary to advance that cursor, so its own high-water mark — process-local,
        // never written — is what keeps an unread line from being re-printed on every tick.
        if (mine.at[k] <= shown) continue
        shown = mine.at[k]
        emit(`${tag}[spex] message · you — from ${e.from ?? 'human'}: ${trunc(e.text, 120)}  [id ${self}]`)
      }
    }
    first = false
    if (take && Date.now() >= deadline) return { timedOut: true, path: anyPath() }
    await sleep(intervalMs)
  }
}
