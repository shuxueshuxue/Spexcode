import { watch, existsSync, readFileSync, appendFileSync, mkdirSync, type FSWatcher } from 'node:fs'
import { sessionsRoot, sessionStoreDir, sessionArtifactPath, listSessionIds, readAliasedRawRecord } from './layout.js'
import type { Lifecycle, Proposal } from './sessions.js'

// @@@ session-timeline - the PERSISTED interaction history of a session: every authored-lifecycle
// transition (status + proposal + the FULL note text) and every delivered prompt, timestamped, appended to
// `timeline.ndjson` in the session's global store dir. This is what a TERMINAL-FREE surface (the phone face,
// [[mobile-ui]]) renders instead of a live pane: without the terminal, the declaration notes ARE the agent's
// replies, and the timeline is the whole conversation.
//
// WHY an observer, not writer instrumentation: the lifecycle has a writer the TS layer never sees — the
// mark-active hook value-replaces status/proposal/note in session.json with pure-shell sed ([[state]]).
// Instrumenting every writer would always miss that one, so the recorder OBSERVES the store instead: one
// fs.watch on the sessions root (debounced) plus a slow reconcile tick (the fs.watch is best-effort, same
// stance as [[graph-stream]]'s source 1), and on each tick it diffs every governed record's
// (status, proposal, note) against the last seen and appends what moved. One mechanism covers every writer
// by construction. Granularity is the debounce window — a flap faster than ~100ms can collapse, exactly like
// the board itself.
//
// The recorder runs ONLY in the serve process (superviseTimeline is called from index.ts) so exactly one
// process appends; timestamps are observation times, honest to within the debounce. Only the AUTHORED axis
// is recorded — liveness (offline/starting/unknown) is a present-tense derivation ([[state]]), re-derived
// per probe and never history, so it stays off the durable log; a surface shows the CURRENT liveness from
// the board row. The timeline lives and dies with the session record (close sweeps the store dir), like
// comms.ndjson. `sent` events are appended by sendText on a CONFIRMED post-launch delivery (dashboard/phone
// input, `spex session send`, merge and issue dispatch); the initial launch prompt passes through the same
// composition seam but has no adapter confirmation to record here. `from` is the sending session's id,
// null = a human surface.

export type TimelineEvent =
  | { ts: string; kind: 'status'; status: Lifecycle; proposal: Proposal | null; note: string | null; display?: string }
  | { ts: string; kind: 'sent'; text: string; from: string | null; replyVia?: 'note' }

const timelinePath = (id: string): string => sessionArtifactPath(id, 'timeline.ndjson')

function append(id: string, ev: TimelineEvent): void {
  try {
    mkdirSync(sessionStoreDir(id), { recursive: true })
    appendFileSync(timelinePath(id), JSON.stringify(ev) + '\n')
  } catch { /* best-effort: a failed history append must never break the state machine or a delivery */ }
}

function readEvents(id: string): TimelineEvent[] {
  try {
    const p = timelinePath(id)
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l) as TimelineEvent } catch { return null }
    }).filter((e): e is TimelineEvent => e != null && (e.kind === 'status' || e.kind === 'sent'))
  } catch { return [] }
}

// the display word for an authored state — the SAME composition reconcile uses for the authored axis
// (awaiting → its proposal's label, active → working), duplicated here as a tiny read-time map rather than
// importing the state machine (sessions.ts imports THIS module for recordSent; a value import back would
// be a cycle — the Lifecycle/Proposal imports above are type-only, erased at runtime).
const PROPOSAL_DISPLAY: Record<string, string> = { merge: 'review', nothing: 'done', close: 'close-pending' }
const displayOf = (e: { status: Lifecycle; proposal: Proposal | null }): string =>
  e.status === 'awaiting' ? (PROPOSAL_DISPLAY[e.proposal ?? 'nothing'] ?? 'done')
  : e.status === 'active' ? 'working' : e.status

// ---- the recorder (serve-process only) ----

// id → fingerprint of the last recorded (status, proposal, note); seeded per id from the persisted last
// status line so a server restart appends nothing for a session that didn't move while the server was down —
// and DOES append (with an honest observed-now timestamp) when it did.
const lastSeen = new Map<string, string>()
const fpOf = (status: string, proposal: string | null, note: string | null): string => JSON.stringify([status, proposal, note])

function lastStatusEvent(id: string): { status: string; proposal: string | null; note: string | null } | null {
  const evs = readEvents(id)
  for (let i = evs.length - 1; i >= 0; i--) { const e = evs[i]; if (e.kind === 'status') return e }
  return null
}

function scan(): void {
  let ids: string[] = []
  try { ids = listSessionIds() } catch { return }
  for (const id of ids) {
    try {
      const raw = readAliasedRawRecord(id)
      if (!raw || !raw.governed) continue
      const status = (raw.status || 'active') as Lifecycle
      const proposal = (raw.proposal || null) as Proposal | null
      const note = raw.note || null
      const fp = fpOf(status, proposal, note)
      if (lastSeen.get(id) === fp) continue
      if (!lastSeen.has(id)) {
        const last = lastStatusEvent(id)
        if (last && fpOf(last.status, last.proposal ?? null, last.note ?? null) === fp) { lastSeen.set(id, fp); continue }
      }
      lastSeen.set(id, fp)
      append(id, { ts: new Date().toISOString(), kind: 'status', status, proposal, note })
    } catch { /* one bad record must not stall the sweep */ }
  }
  const live = new Set(ids)
  for (const k of [...lastSeen.keys()]) if (!live.has(k)) lastSeen.delete(k)
}

let watcher: FSWatcher | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
let reconcile: ReturnType<typeof setInterval> | null = null

// start the recorder: one debounced fs.watch on the store (a lifecycle write lands as a session.json write)
// backstopped by a slow reconcile tick, plus an immediate first sweep. Idempotent; never throws — the
// timeline is an accessory record, and its failure must never take the server down.
export function superviseTimeline(): void {
  if (!reconcile) reconcile = setInterval(scan, 60000)
  if (!watcher) {
    const root = sessionsRoot()
    try { mkdirSync(root, { recursive: true }) } catch { /* best-effort */ }
    try {
      watcher = watch(root, { recursive: true }, () => {
        if (debounce) return
        debounce = setTimeout(() => { debounce = null; scan() }, 100)
      })
    } catch { watcher = null /* the reconcile tick still covers */ }
  }
  scan()
}

// the channel of the LAST HUMAN send (from == null): 'note' when the note-reply hint rode along, else null.
// This is what makes the reply-channel hints SYMMETRIC ([[sessions-core]] sendText): a human send with no
// note flag arriving after a note-send is the "back at a terminal" transition, and the delivery gets the
// counter-insert. Derived from the durable log — no new state, and it survives a server restart. Agent
// senders (`from` set) say nothing about where the HUMAN is reading, so they neither set nor clear it.
export function lastHumanSendVia(id: string): 'note' | null {
  const evs = readEvents(id)
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i]
    if (e.kind === 'sent' && e.from == null) return e.replyVia === 'note' ? 'note' : null
  }
  return null
}

// record a CONFIRMED prompt delivery (called by sendText after the harness accepted it). `text` is the
// caller's message BEFORE any mechanism insert (the note-reply hint is transport, not conversation);
// `replyVia` is the effective channel chosen by the shared prompt seam, whether explicit or derived from the
// target adapter, so the durable history records where the reply was actually readable.
export function recordSent(id: string, text: string, from: string | null, replyVia?: 'note'): void {
  try { if (!readAliasedRawRecord(id)?.governed) return } catch { return }
  append(id, { ts: new Date().toISOString(), kind: 'sent', text, from, ...(replyVia ? { replyVia } : {}) })
}

// the read surface behind GET /api/sessions/:id/timeline: the last `limit` events, oldest first, each
// status event carrying its composed display word. null = no such session (the route 404s).
// Adjacent status lines with identical (status, proposal, note) fold into their first: TWO serve processes
// observing one store (a throwaway worktree/eval serve beside the live one) each keep their own lastSeen,
// so a single record move can append twice — cross-process write locking isn't worth buying, so the log
// stays best-effort append-only and the read is where duplicates die, same stance as the board.
export function readTimeline(id: string, limit = 500): { events: TimelineEvent[] } | null {
  let raw: ReturnType<typeof readAliasedRawRecord>
  try { raw = readAliasedRawRecord(id) } catch { return null }
  if (!raw || !raw.governed) return null
  const folded: TimelineEvent[] = []
  for (const e of readEvents(id)) {
    const prev = folded[folded.length - 1]
    if (e.kind === 'status' && prev?.kind === 'status' && prev.status === e.status
      && (prev.proposal ?? null) === (e.proposal ?? null) && (prev.note ?? null) === (e.note ?? null)) continue
    folded.push(e)
  }
  const tail = folded.slice(Math.max(0, folded.length - Math.max(1, limit)))
  return { events: tail.map((e) => (e.kind === 'status' ? { ...e, display: displayOf(e) } : e)) }
}
