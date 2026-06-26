import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listSessions, alive } from './sessions.js'

// @@@ pty-bridge - the live terminal is now a REAL tmux client, not an output tap. For each session we
// spawn ONE node-pty running `tmux attach-session -t <id>` (a genuine tmux client on a real PTY) and
// share it across every browser viewer. The browser's xterm forwards raw keystrokes AND mouse bytes
// down the PTY, so the wheel drives tmux copy-mode — you scroll the actual pane history like real tmux.
// This replaces the old capture-pane snapshot + raw pipe-pane delta splice (the source of the scramble:
// deltas assumed a screen the snapshot only approximated, and the tail could start mid-escape-sequence).
// A fresh attach makes tmux emit ONE coherent full repaint at the PTY size — no splice, no scramble.
//
// ONE client per session (not one per viewer): all viewers subscribe to the same PTY's output and write
// into the same PTY, so there's exactly one tmux client and one authoritative size (last fit wins). Two
// clients would fight over the session size; one never does.
//
// Pre-warm (the cache): a supervisor keeps a bridge attached to every live session, so the PTY + tmux
// client are already streaming before a tab is opened. Opening a tab just subscribes to a warm bridge
// and nudges a refresh — paint is instant, no cold capture-pane/spawn chain.

const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
// only a COLD fallback for a session no viewer has ever sized — see lastFit below. The bug was
// pre-warming EVERY bridge at this fixed size: the dashboard viewer is smaller, so reattaching to a
// 120x40 pre-warm and shrinking it to (e.g.) 103x33 raced the repaint and doubled the status bar.
const DEFAULT_COLS = 120, DEFAULT_ROWS = 40
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// a viewer: anything we can push pane bytes to (a WebSocket, wrapped).
export type Viewer = { send: (data: Buffer) => void }

type Bridge = { id: string; pty: IPty; cols: number; rows: number; prewarmed: boolean; clientTty?: string; repaintToken: number }
const bridges = new Map<string, Bridge>()
// @@@ stable subscription registry - the fix for the frozen-pane bug. Viewers are keyed by SESSION ID and
// live HERE, never on the Bridge. The old Bridge.viewers Set died with the pty (p.onExit → bridges.delete),
// orphaning the still-open WebSocket onto a deleted object — inactive, unscrollable, no repaint, until a
// manual page refresh. Now only detachViewer (a real socket close) removes a viewer; a bridge dying and
// respawning underneath is invisible to the browser, so client reconnection is unnecessary for bridge churn.
const subscribers = new Map<string, Set<Viewer>>()

// @@@ last-known viewer size - the cure for the pre-warm mismatch. Every viewer fit records its
// cols/rows here (per session, plus a global fallback for a session this viewer hasn't opened before),
// so the supervisor pre-warms a bridge at the size a viewer will actually want — no shrink on attach,
// no shrink-vs-repaint race. Only a session NO viewer has ever sized falls back to DEFAULT_COLS/ROWS.
const lastFit = new Map<string, { cols: number; rows: number }>()
let lastFitAny: { cols: number; rows: number } | null = null
function prewarmSize(id: string): { cols: number; rows: number } {
  return lastFit.get(id) ?? lastFitAny ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
}

async function tmuxRaw(args: string[]): Promise<void> {
  try { await pexec('tmux', ['-L', TMUX_SOCK, ...args]) } catch { /* best-effort */ }
}
// how many clients are attached to this session. Used to keep pre-warm from attaching to a session a
// HUMAN is already in (their real terminal) — a second client would fight over the pane size.
async function attachedCount(id: string): Promise<number> {
  try {
    const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, 'display-message', '-p', '-t', id, '-F', '#{session_attached}'])
    return Number(stdout.trim()) || 0
  } catch { return 0 }
}

// @@@ tmux opts - mouse on (wheel → copy-mode scrollback) + a deep history. set -g sets the server
// default; mouse is inherited live by all sessions, history-limit applies to panes created afterwards.
let optsEnsured = false
async function ensureTmuxOpts(): Promise<void> {
  if (optsEnsured) return
  optsEnsured = true
  await tmuxRaw(['set', '-g', 'mouse', 'on'])
  await tmuxRaw(['set', '-g', 'history-limit', '50000'])
}

// spawn the shared tmux client for a session (idempotent). Returns null if node-pty can't spawn.
function ensureBridge(id: string, prewarm = false): Bridge | null {
  let b = bridges.get(id)
  if (b) { if (prewarm) b.prewarmed = true; return b }
  // spawn at the LAST-KNOWN viewer size (not a fixed default) so a pre-warmed bridge already matches
  // the dashboard's pane — the on-attach shrink that doubled the status bar simply never happens.
  const { cols, rows } = prewarmSize(id)
  let p: IPty
  try {
    // -u + a UTF-8 LANG force this tmux CLIENT to emit UTF-8 even when the host's locale is empty/non-UTF-8
    // (a macOS LaunchAgent gives LANG="" → tmux would substitute `_` for every wide char: CJK, ▸, ★, …).
    // Locale-independent so the live terminal renders non-ASCII intact regardless of how the backend started.
    p = pty.spawn('tmux', ['-u', '-L', TMUX_SOCK, 'attach-session', '-t', id], {
      name: 'xterm-256color', cols, rows,
      env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' } as Record<string, string>,
    })
  } catch { return null }
  b = { id, pty: p, cols, rows, prewarmed: prewarm, repaintToken: 0 }
  bridges.set(id, b)
  // tmux output (string, utf8-boundary-safe from node-pty) → broadcast as raw bytes to every viewer. The
  // viewer set lives in `subscribers` (keyed by session id), so it survives this bridge being replaced.
  p.onData((data) => {
    const buf = Buffer.from(data, 'utf8')
    for (const v of subscribers.get(id) ?? []) { try { v.send(buf) } catch { /* drop a wedged viewer */ } }
  })
  // attach-session exits when the session dies or we detach — drop the bridge so it's re-made if needed.
  // The subscribers are untouched; if any remain, kick a reconcile to RE-BIND fast (respawn + repaint)
  // instead of waiting up to a full supervisor tick. The kick is alive-gated + serialized, so a session
  // that died for real just reaps (no respawn) and a burst of exits collapses to one pass — never a storm.
  p.onExit(() => {
    if (bridges.get(id) === b) bridges.delete(id)
    if ((subscribers.get(id)?.size ?? 0) > 0) kickSupervisor()
  })
  return b
}

function killBridge(id: string): void {
  const b = bridges.get(id)
  if (!b) return
  bridges.delete(id)
  try { b.pty.kill() } catch { /* already gone */ }
}

// a browser viewer connects: subscribe it to the (warm or fresh) bridge, then trigger ONE coherent full
// repaint so the freshly-reset xterm paints in a single clean frame. We do NOT splice a capture-pane
// snapshot into the mid-flight live stream — THAT was the tab-switch scramble: the snapshot is an
// out-of-band screen state, the live deltas assume a different cursor/size, and the join can land
// mid-escape-sequence, so the two splice into a garbled screen (doubled status bars, interleaved text).
// Instead we ask tmux to `refresh-client` OUR attach client, which emits a full redraw down the SAME pty
// the deltas flow on — coherent with them by construction. The redraw reaches every viewer of this bridge
// (a brief, harmless re-paint for any others — far better than a persistent splice). The client resets its
// xterm on (re)connect and its open-time resize re-syncs the size; the repaint is DEFERRED until that
// resize has actually landed in tmux (see settleAndRepaint), so it paints at the viewer's exact rows and
// the status bar lands exactly once. There is no per-viewer partial seed, so rapid attach/detach can
// never leave a half-seed behind.
export function attachViewer(id: string, v: Viewer): boolean {
  let s = subscribers.get(id)
  if (!s) subscribers.set(id, s = new Set())
  s.add(v)
  const b = ensureBridge(id)
  if (!b) return false   // spawn failed → caller closes the socket → detachViewer prunes this subscriber
  void settleAndRepaint(b)
  return true
}
// our tmux attach client's tty, matched by pid (b.pty.pid === the attach process === client_pid) and cached.
// refresh-client must target OUR client specifically so the redraw hits only the dashboard's pty — never a
// human's separate terminal that happens to share the same session.
async function clientTty(b: Bridge): Promise<string | null> {
  if (b.clientTty) return b.clientTty
  try {
    const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, 'list-clients', '-t', b.id, '-F', '#{client_pid} #{client_tty}'])
    for (const line of stdout.split('\n')) {
      const sp = line.indexOf(' ')
      if (sp > 0 && Number(line.slice(0, sp)) === b.pty.pid) return (b.clientTty = line.slice(sp + 1).trim())
    }
  } catch { /* client not registered yet; a size-changing open resize will repaint instead */ }
  return null
}
// force tmux to emit a full, coherent repaint of our client down the shared pty (in-band with the live
// stream → no splice). All viewers of this bridge see it — an acceptable brief redraw, never a scramble.
// @@@ fail-loud on re-bind - the repaint MUST land. On a fresh respawn (the re-bind path) the new tmux
// client may not be registered with the server yet, so clientTty is briefly null; the old code's silent
// `if (tty)` skip then left a re-bound idle pane frozen forever (no browser resize re-arms it, because the
// socket never reopened). So retry until the client resolves, bounded (~0.5s), and bail if a newer attach/
// resize supersedes us (token) so we never clobber a fresher size.
async function repaint(b: Bridge, token: number): Promise<void> {
  for (let i = 0; i < 24; i++) {
    if (token !== b.repaintToken) return
    const tty = await clientTty(b)
    if (tty) { await tmuxRaw(['refresh-client', '-t', tty]); return }
    await sleep(20)
  }
}
// tmux's actual pane geometry for our session — the ground truth we wait on before repainting.
async function paneSize(b: Bridge): Promise<{ cols: number; rows: number } | null> {
  try {
    const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, 'display-message', '-p', '-t', b.id, '-F', '#{pane_width}x#{pane_height}'])
    const m = stdout.trim().match(/^(\d+)x(\d+)$/)
    if (m) return { cols: Number(m[1]), rows: Number(m[2]) }
  } catch { /* session momentarily ungettable; treat as not-yet-settled */ }
  return null
}
// @@@ the single clean frame - the heart of the fix. Every (re)attach and every resize routes here.
// We bump a per-bridge token so a rapid burst (attach + the client's open-time resize) COALESCES to one
// run: a brief settle window lets the final size win, then we POLL tmux's real pane geometry until it
// equals the size we asked the pty for (xterm rows == tmux pane rows), and ONLY THEN fire a SINGLE
// refresh-client. Repainting before the shrink lands is exactly what doubled the status bar — the redraw
// drew 40 rows while the screen was settling to 33. A later token supersedes us at every checkpoint, so
// no stale repaint ever races a newer size. Bounded (~0.5s) so a wedged tmux can't hang the attach.
async function settleAndRepaint(b: Bridge): Promise<void> {
  const token = ++b.repaintToken
  await sleep(30)                                   // coalesce an attach+resize burst to the final size
  for (let i = 0; i < 24; i++) {
    if (token !== b.repaintToken) return            // superseded by a newer attach/resize → let it win
    const sz = await paneSize(b)
    if (sz && sz.cols === b.cols && sz.rows === b.rows) break
    await sleep(20)
  }
  if (token !== b.repaintToken) return
  await repaint(b, token)
}
export function detachViewer(id: string, v: Viewer): void {
  const s = subscribers.get(id)
  if (!s) return
  s.delete(v)
  if (s.size > 0) return
  // last viewer gone → drop the registry entry, then release the tmux client unless it's kept warm (the
  // session itself stays alive, detached). Subscriber-set emptiness is now the single authority for "no one
  // watching" — used here AND in the supervisor reap, so the two never disagree.
  subscribers.delete(id)
  const b = bridges.get(id)
  if (b && !b.prewarmed) killBridge(id)
}
// raw terminal input (keystrokes + mouse) straight into the shared tmux client.
export function writeViewer(id: string, data: Buffer): void {
  bridges.get(id)?.pty.write(data.toString('utf8'))
}
// a viewer fitted xterm to its panel → resize the shared client so tmux re-renders at that exact size,
// then fire the single settled repaint. We RECORD the size as the last-known viewer fit even if there's
// no bridge yet, so a future pre-warm spawns at it. When the size is unchanged (a reconnect re-sends its
// current size) we still settle+repaint, because the client just reset its xterm and needs the frame.
export function resizeBridge(id: string, cols: number, rows: number): void {
  if (!(cols > 0 && rows > 0)) return
  lastFit.set(id, { cols, rows }); lastFitAny = { cols, rows }
  const b = bridges.get(id)
  if (b) applySize(b, cols, rows)
}
// resize the tmux client + repaint, WITHOUT recording the size as a viewer fit. This is the primitive both
// a real viewer resize and the supervisor's pre-sizing use; only resizeBridge updates lastFit/lastFitAny,
// so the supervisor applying a per-session size can never clobber the global last-fit with a stale value.
// Always settles+repaints (a viewer reconnect re-sends its current size and still needs the frame after its
// xterm reset); the supervisor avoids the per-tick repaint by only calling this when the size truly differs.
function applySize(b: Bridge, cols: number, rows: number): void {
  if (cols !== b.cols || rows !== b.rows) {
    b.cols = cols; b.rows = rows
    try { b.pty.resize(cols, rows) } catch { /* dead pty; next fit/tick retries */ }
  }
  void settleAndRepaint(b)
}

// @@@ supervisor - the cache AND the re-bind owner. One reconciliation pass: ensure a warm bridge per live
// session, RE-BIND (respawn + repaint) any watched session whose pty just died, and reap bridges whose
// session is gone and that no one is watching. Re-bind lives HERE, not in pty.onExit, because this pass is
// alive-gated (a genuinely dead session reaps, never respawns) and rate-limited (the tick + the serialize
// guard below), so a flaky session can't trigger a respawn storm. Started once at serve().
async function reconcileOnce(): Promise<void> {
  const live = new Set<string>()
  for (const s of await listSessions()) {
    if (!(await alive(s.id))) continue
    live.add(s.id)
    // already ours → keep warm AND keep at the last-known viewer size. A bridge spawned before any viewer
    // fit (e.g. right after a cold start) sits at the fixed default; once a viewer has fitted, prewarmSize
    // is the real dashboard size, so we resize the stale warm bridge here — off-screen, while no one watches.
    // That way a first open finds the pane ALREADY at its size: no on-attach resize, no visible reflow. The
    // size-diff guard makes a converged bridge a no-op (no per-tick repaint); watched sessions match too,
    // since prewarmSize returns their own recorded fit.
    const existing = bridges.get(s.id)
    if (existing) {
      existing.prewarmed = true
      const want = prewarmSize(s.id)
      if (want.cols !== existing.cols || want.rows !== existing.rows) applySize(existing, want.cols, want.rows)
      continue
    }
    // no bridge for a live session: either viewers are already waiting (their bridge died → RE-BIND, which
    // must fire settleAndRepaint so an idle pane doesn't sit frozen on the dead frame — nothing else re-arms
    // it, since the socket never reopened), or it's an idle detached session to pre-warm. Pre-warm spawns at
    // the last-known viewer size (prewarmSize), so a reattach finds the bridge already at the dashboard's
    // pane size — no shrink, no shrink-vs-repaint race. A watched session attaches regardless of any human
    // client (matching attachViewer), since refresh-client targets only our own client's tty.
    if ((subscribers.get(s.id)?.size ?? 0) > 0) {
      const b = ensureBridge(s.id, true)
      if (b) void settleAndRepaint(b)
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

// serialize reconcile passes: at most one runs at a time, at most one queued. A burst of onExit kicks
// therefore collapses to a single rerun — the natural rate-limit that stops a flaky session from storming.
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

// a watched bridge's pty just died — recover NOW instead of waiting up to a full tick. Safe by construction:
// runReconcile is alive-gated (a dead session reaps, never respawns) and serialized (kicks collapse), so no storm.
function kickSupervisor(): void {
  if (supervising) void runReconcile()
}
