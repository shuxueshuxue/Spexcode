import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listSessions, alive } from './sessions.js'

const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
// cold fallback size for a session no viewer has ever sized (see lastFit).
const DEFAULT_COLS = 120, DEFAULT_ROWS = 40
// a viewer that connects without a measurable size (a still-hidden warm pane) defers its first paint to its
// first resize; this bounds the wait so a viewer that NEVER resizes still gets a frame and is never blank.
const FIRST_PAINT_FALLBACK_MS = 250
// a size-changing `refresh-client -C` is confirmed by a %layout-change carrying the converged WxH (~2-10ms);
// a no-op resize (size unchanged) emits none, so cap the wait and paint at the already-known size anyway.
const LAYOUT_SETTLE_MS = 120
// the FIRST frame of a bridge's life seeds this much of tmux's recent scrollback into the browser terminal
// (commensurate with xterm's own scrollback), so the wheel reaches output from before the client attached.
const HISTORY_SEED_LINES = 4000

// a viewer: anything we can push pane bytes to (a WebSocket, wrapped).
export type Viewer = { send: (data: Buffer) => void }

// resolver for one control-mode command's %begin..%end reply lines.
type Pending = (lines: string[]) => void
type Bridge = {
  id: string; pty: IPty; cols: number; rows: number; prewarmed: boolean
  repaintToken: number
  firstPaintTimer?: ReturnType<typeof setTimeout>
  // control-mode parser state: an incomplete-line buffer, the in-flight command block (%begin..%end) with
  // its command number, a FIFO of one resolver per command sent (tmux answers in order), and the last
  // %layout-change size so a repaint knows the pane already converged and needn't wait for the event.
  buf: string
  block: string[] | null
  blockNum: string
  cmdQ: Pending[]
  lastLayout?: string
  layoutWaiter?: { want: string; done: () => void; timer: ReturnType<typeof setTimeout> }
  // set once this bridge has flushed history into a viewer; later resizes re-seed only the visible screen.
  seededHistory?: boolean
}
const bridges = new Map<string, Bridge>()
// viewers keyed by session id (not the Bridge), so a subscription outlives any bridge death/respawn.
const subscribers = new Map<string, Set<Viewer>>()

// last size each viewer fitted (per session + a global fallback), so pre-warm spawns at the wanted size.
const lastFit = new Map<string, { cols: number; rows: number }>()
let lastFitAny: { cols: number; rows: number } | null = null
function prewarmSize(id: string): { cols: number; rows: number } {
  return lastFit.get(id) ?? lastFitAny ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
}

// push pane bytes to every viewer of a session (the set survives a bridge swap).
function broadcast(id: string, buf: Buffer): void {
  for (const v of subscribers.get(id) ?? []) { try { v.send(buf) } catch { /* drop a wedged viewer */ } }
}

// %output data is octal-escaped by tmux (\NNN per non-printable / high byte, backslash as \134, printable
// ASCII verbatim); decode back to the raw bytes the pane emitted before broadcasting.
function unescapeOutput(data: string): Buffer {
  const raw = data.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
  return Buffer.from(raw, 'latin1')
}

async function tmuxRaw(args: string[]): Promise<void> {
  try { await pexec('tmux', ['-L', TMUX_SOCK, ...args]) } catch { /* best-effort */ }
}
// how many clients are attached — pre-warm skips a session a human is already in (avoids a size-fight). Read
// once at reconcile time (before our own control client attaches), so it counts only foreign/human clients.
async function attachedCount(id: string): Promise<number> {
  try {
    const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, 'display-message', '-p', '-t', id, '-F', '#{session_attached}'])
    return Number(stdout.trim()) || 0
  } catch { return 0 }
}

// mouse on + deep history. set -g is the server default: mouse is inherited live, history-limit applies
// only to panes created afterwards.
let optsEnsured = false
async function ensureTmuxOpts(): Promise<void> {
  if (optsEnsured) return
  optsEnsured = true
  await tmuxRaw(['set', '-g', 'mouse', 'on'])
  await tmuxRaw(['set', '-g', 'history-limit', '50000'])
}

// --- control-mode protocol ---------------------------------------------------
// The one client per session is a tmux control-mode connection (`tmux -CC attach-session`). tmux speaks a
// line protocol on this pty: %output events push pane bytes, %begin/%end frame each command's reply, and
// %layout-change announces the converged size. So resize is deterministic (refresh-client -C, told done by
// %layout-change) and bytes arrive as events — no pty resize + geometry poll, no per-repaint tmux exec.

// send one control-mode command; resolve with its %begin..%end reply lines. tmux answers in order, so a FIFO
// of resolvers matches each block to its command.
function command(b: Bridge, cmd: string): Promise<string[]> {
  return new Promise((resolve) => {
    b.cmdQ.push(resolve)
    try { b.pty.write(cmd + '\n') } catch { b.cmdQ = b.cmdQ.filter((r) => r !== resolve); resolve([]) }
  })
}

// parse the control stream line by line (an incomplete tail is held in b.buf until its newline arrives).
function feed(b: Bridge, chunk: string): void {
  b.buf += chunk
  let i: number
  while ((i = b.buf.indexOf('\n')) >= 0) {
    const line = b.buf.slice(0, i).replace(/\r$/, '')
    b.buf = b.buf.slice(i + 1)
    onLine(b, line)
  }
}

function onLine(b: Bridge, line: string): void {
  // control mode wraps the stream in a DCS (`\x1bP1000p` on enter, `\x1b\\` on exit) that prefixes the very
  // first notification; strip it so that %begin parses cleanly.
  line = line.replace(/^\x1bP\d+p/, '').replace(/\x1b\\$/, '')
  if (b.block) {
    // Inside a command reply everything is verbatim content until %end/%error — but only one whose command
    // number matches this %begin's closes it, so a pane row that merely starts with "%end" can't false-close.
    const m = line.match(/^%(?:end|error) \S+ (\d+)/)
    if (m && m[1] === b.blockNum) {
      const lines = b.block; b.block = null
      const resolve = b.cmdQ.shift(); if (resolve) resolve(lines)
    } else {
      b.block.push(line)
    }
    return
  }
  if (line.startsWith('%output ')) {
    const sp = line.indexOf(' ', 8)   // skip "%output %<pane> " to the raw (escaped) data
    if (sp > 0) broadcast(b.id, unescapeOutput(line.slice(sp + 1)))
    return
  }
  const beg = line.match(/^%begin \S+ (\d+)/)
  if (beg) { b.block = []; b.blockNum = beg[1]; return }
  if (line.startsWith('%layout-change ')) {
    const m = line.match(/,(\d+x\d+),/)   // layout token = checksum,WIDTHxHEIGHT,x,y,… — the window size
    onLayout(b, m ? m[1] : undefined)
    return
  }
  // %exit / %client-detached / window close → the client is gone; pty.onExit drives the re-bind.
}

function onLayout(b: Bridge, size?: string): void {
  if (!size) return
  b.lastLayout = size
  const w = b.layoutWaiter
  if (w && w.want === size) { clearTimeout(w.timer); b.layoutWaiter = undefined; w.done() }
}

// resolve when a %layout-change reports the wanted size (the pane has re-wrapped) — or after a short bound if
// none comes (a no-op resize emits no event). No polling: the event, not a geometry read, tells us it settled.
function awaitConverged(b: Bridge, want: string): Promise<void> {
  if (b.lastLayout === want) return Promise.resolve()
  return new Promise((resolve) => {
    if (b.layoutWaiter) { clearTimeout(b.layoutWaiter.timer); const prev = b.layoutWaiter.done; b.layoutWaiter = undefined; prev() }
    let timer: ReturnType<typeof setTimeout>
    // eslint-disable-next-line prefer-const
    timer = setTimeout(() => { if (b.layoutWaiter?.timer === timer) b.layoutWaiter = undefined; resolve() }, LAYOUT_SETTLE_MS)
    b.layoutWaiter = { want, done: resolve, timer }
  })
}

// spawn the shared control-mode client for a session (idempotent). Returns null if node-pty can't spawn.
function ensureBridge(id: string, prewarm = false): Bridge | null {
  let b = bridges.get(id)
  if (b) { if (prewarm) b.prewarmed = true; return b }
  // spawn at the last-known viewer size so a pre-warmed bridge already matches the dashboard's pane.
  const { cols, rows } = prewarmSize(id)
  let p: IPty
  try {
    // -CC = control mode (event stream); -u + a UTF-8 LANG force UTF-8 output even when the host locale is
    // empty (a LaunchAgent gives LANG="" → tmux would substitute `_` for every wide char).
    p = pty.spawn('tmux', ['-u', '-CC', '-L', TMUX_SOCK, 'attach-session', '-t', id], {
      name: 'xterm-256color', cols, rows,
      env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' } as Record<string, string>,
    })
  } catch { return null }
  b = { id, pty: p, cols, rows, prewarmed: prewarm, repaintToken: 0, buf: '', block: null, blockNum: '', cmdQ: [] }
  bridges.set(id, b)
  const bx = b
  p.onData((d) => feed(bx, d))
  // attach-session exited (session died or we detached): drop the bridge, unblock any awaiting command, and
  // if viewers remain kick a reconcile to re-bind fast instead of waiting a full tick (alive-gated + serialized).
  p.onExit(() => {
    if (bx.firstPaintTimer) { clearTimeout(bx.firstPaintTimer); bx.firstPaintTimer = undefined }
    if (bx.layoutWaiter) { clearTimeout(bx.layoutWaiter.timer); bx.layoutWaiter = undefined }
    const q = bx.cmdQ; bx.cmdQ = []; for (const r of q) r([])
    if (bridges.get(id) === bx) bridges.delete(id)
    if ((subscribers.get(id)?.size ?? 0) > 0) kickSupervisor()
  })
  return b
}

function killBridge(id: string): void {
  const b = bridges.get(id)
  if (!b) return
  if (b.firstPaintTimer) { clearTimeout(b.firstPaintTimer); b.firstPaintTimer = undefined }
  if (b.layoutWaiter) { clearTimeout(b.layoutWaiter.timer); b.layoutWaiter = undefined }
  bridges.delete(id)
  try { b.pty.kill() } catch { /* already gone */ }
}

// a browser viewer connects: subscribe it to the (warm or fresh) bridge, then paint one coherent frame at
// the converged size (see repaint), never a guessed-size splice. Two connect shapes:
//   - VISIBLE (re)connect — the client could measure its pane and carried its real size on the URL (the
//     size-first handshake), so size the bridge to it FIRST and draw that very frame at the correct size.
//   - HIDDEN connect — a warm pane is still 0×0, so the client carries no size. DON'T paint a guessed
//     prewarm frame now: it'd be undersized and, landing in a still-hidden buffer, would only have to be
//     covered the instant the pane becomes visible (the old two-stage scramble). Defer the one first-frame
//     paint to the client's first resize — which fires the moment the pane becomes visible and the client
//     measures its real size — so the first frame is drawn at the true visible size. A bounded fallback
//     covers a viewer that never resizes, so a pane is never left blank.
export function attachViewer(id: string, v: Viewer, initialSize?: { cols: number; rows: number }): boolean {
  let s = subscribers.get(id)
  if (!s) subscribers.set(id, s = new Set())
  s.add(v)
  const b = ensureBridge(id)
  if (!b) return false   // spawn failed → caller closes the socket → detachViewer prunes this subscriber
  if (initialSize && initialSize.cols > 0 && initialSize.rows > 0) {
    applySize(b, initialSize.cols, initialSize.rows)   // resize-then-repaint at the client's true size
  } else {
    scheduleFirstPaintFallback(b)   // hidden connect → defer the first paint to the first resize; bound it
  }
  return true
}
// fail-loud bound on the deferred first paint: if the client's first resize never arrives (a non-dashboard
// viewer that never fits), paint once at the prewarm size after FIRST_PAINT_FALLBACK_MS so the pane is
// never permanently blank. A real repaint (the first resize, a re-bind) supersedes this by clearing the
// timer in repaint — so on the dashboard path it's a safety net that normally never fires visibly.
function scheduleFirstPaintFallback(b: Bridge): void {
  if (b.firstPaintTimer) return   // one timer per bridge — a second hidden viewer doesn't stack another
  b.firstPaintTimer = setTimeout(() => { b.firstPaintTimer = undefined; void repaint(b) }, FIRST_PAINT_FALLBACK_MS)
}

// every (re)attach and resize routes here. Deterministic, event-driven, zero polling: set the size with
// refresh-client -C, wait to be TOLD it converged by %layout-change (bounded), then seed one coherent full
// frame from a bounded capture-pane at that size. A per-bridge token supersedes a stale run at every await.
// The capture frame broadcasts synchronously at its block-end, so any %output that follows in the stream
// lands AFTER the frame and is never overwritten by it — the frame is the attach seed, %output the live tail.
//
// The FIRST frame of a bridge's life (attach / re-bind) captures tmux's recent scrollback (`-S`), so those
// history lines write into the browser terminal and scroll into ITS scrollback — the wheel then reaches
// output from before the client attached (the "wheel scrolls real history" contract). Later resizes re-seed
// only the visible screen: re-flushing thousands of lines on every resize would be costly and flicker, and
// the clear is `\x1b[H\x1b[2J` (viewport only, never `\x1b[3J`), so it never wipes the seeded scrollback.
async function repaint(b: Bridge): Promise<void> {
  if (b.firstPaintTimer) { clearTimeout(b.firstPaintTimer); b.firstPaintTimer = undefined }   // a real repaint supersedes the deferred-first-paint fallback
  const token = ++b.repaintToken
  const want = `${b.cols}x${b.rows}`
  await command(b, `refresh-client -C ${want}`)
  if (token !== b.repaintToken) return
  await awaitConverged(b, want)
  if (token !== b.repaintToken) return
  const withHistory = !b.seededHistory
  b.cmdQ.push((lines) => {
    if (token !== b.repaintToken) return
    if (withHistory) b.seededHistory = true   // set only once the history frame actually reaches a viewer
    // capture-pane reply lines are RAW bytes (real escapes + UTF-8, not octal-escaped); replay them under a
    // clear+home so the frame is one coherent screen (plus, on the first frame, the seeded history above it).
    broadcast(b.id, Buffer.from('\x1b[H\x1b[2J' + lines.join('\r\n'), 'utf8'))
  })
  const cap = withHistory ? `capture-pane -e -p -S -${HISTORY_SEED_LINES} -t ${b.id}` : `capture-pane -e -p -t ${b.id}`
  try { b.pty.write(cap + '\n') } catch { b.cmdQ.pop() }
}

export function detachViewer(id: string, v: Viewer): void {
  const s = subscribers.get(id)
  if (!s) return
  s.delete(v)
  if (s.size > 0) return
  // last viewer gone → drop the registry entry, then release the client unless it's kept warm. An empty
  // subscriber set is the single authority for "no one watching" (used here and in the supervisor reap).
  subscribers.delete(id)
  const b = bridges.get(id)
  if (b && !b.prewarmed) killBridge(id)
}
// a viewer fitted xterm → record the size as the last-known fit (even with no bridge yet, for pre-warm)
// and resize the shared client. Repaints even on an unchanged size (a reconnect needs the frame).
export function resizeBridge(id: string, cols: number, rows: number): void {
  if (!(cols > 0 && rows > 0)) return
  lastFit.set(id, { cols, rows }); lastFitAny = { cols, rows }
  const b = bridges.get(id)
  if (b) applySize(b, cols, rows)
}
// resize the client + repaint WITHOUT recording a viewer fit — the primitive both a real resize and the
// supervisor's pre-sizing share, so the supervisor can't clobber lastFit/lastFitAny with a stale value.
function applySize(b: Bridge, cols: number, rows: number): void {
  b.cols = cols; b.rows = rows
  void repaint(b)
}

// one reconcile pass: warm a bridge per live session, re-bind a watched session whose client died, reap a
// dead+unwatched bridge. Re-bind lives here (not pty.onExit) because this pass is alive-gated and
// rate-limited, so a flaky session can't storm respawns.
async function reconcileOnce(): Promise<void> {
  const live = new Set<string>()
  for (const s of await listSessions()) {
    if (!(await alive(s.id))) continue
    live.add(s.id)
    // already ours → keep warm and resize a stale warm bridge to the last-known viewer size off-screen,
    // so a first open finds the pane already at its size. The size-diff guard makes a converged bridge a no-op.
    const existing = bridges.get(s.id)
    if (existing) {
      existing.prewarmed = true
      const want = prewarmSize(s.id)
      if (want.cols !== existing.cols || want.rows !== existing.rows) applySize(existing, want.cols, want.rows)
      continue
    }
    // no bridge for a live session: viewers waiting → re-bind and repaint (nothing else re-arms an idle
    // pane); else pre-warm an idle detached session, but only if no human client is already attached.
    if ((subscribers.get(s.id)?.size ?? 0) > 0) {
      const b = ensureBridge(s.id, true)
      if (b) void repaint(b)
    } else if ((await attachedCount(s.id)) === 0) {
      ensureBridge(s.id, true)
    }
  }
  for (const [id, b] of bridges) {
    if (live.has(id)) continue
    if ((subscribers.get(id)?.size ?? 0) === 0) killBridge(id)   // dead + unwatched → release
    else b.prewarmed = false                                     // dead but still watched → serve until they leave
  }
}

// serialize reconcile passes (one running, one queued), so a burst of onExit kicks collapses to one rerun.
let reconciling = false
let reconcilePending = false
async function runReconcile(): Promise<void> {
  if (reconciling) { reconcilePending = true; return }
  reconciling = true
  try { await reconcileOnce() } catch { /* transient git/tmux hiccup; the periodic tick retries */ }
  reconciling = false
  if (reconcilePending) { reconcilePending = false; void runReconcile() }
}

let supervising = false
export function superviseBridges(intervalMs = 4000): void {
  if (supervising) return
  supervising = true
  void ensureTmuxOpts()
  const tick = () => { void runReconcile(); setTimeout(tick, intervalMs) }
  tick()
}

// a watched bridge's client died — recover now instead of waiting a full tick (alive-gated + serialized).
function kickSupervisor(): void {
  if (supervising) void runReconcile()
}
