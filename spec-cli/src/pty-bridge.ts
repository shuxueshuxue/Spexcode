import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listSessions, alive } from './sessions.js'

const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
// cold fallback size for a session no viewer has ever sized (see lastFit).
const DEFAULT_COLS = 120, DEFAULT_ROWS = 40
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// a viewer: anything we can push pane bytes to (a WebSocket, wrapped).
export type Viewer = { send: (data: Buffer) => void }

type Bridge = { id: string; pty: IPty; cols: number; rows: number; prewarmed: boolean; clientTty?: string; repaintToken: number }
const bridges = new Map<string, Bridge>()
// viewers keyed by session id (not the Bridge), so a subscription outlives any bridge death/respawn.
const subscribers = new Map<string, Set<Viewer>>()

// last size each viewer fitted (per session + a global fallback), so pre-warm spawns at the wanted size.
const lastFit = new Map<string, { cols: number; rows: number }>()
let lastFitAny: { cols: number; rows: number } | null = null
function prewarmSize(id: string): { cols: number; rows: number } {
  return lastFit.get(id) ?? lastFitAny ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
}

async function tmuxRaw(args: string[]): Promise<void> {
  try { await pexec('tmux', ['-L', TMUX_SOCK, ...args]) } catch { /* best-effort */ }
}
// how many clients are attached — pre-warm skips a session a human is already in (avoids a size-fight).
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

// spawn the shared tmux client for a session (idempotent). Returns null if node-pty can't spawn.
function ensureBridge(id: string, prewarm = false): Bridge | null {
  let b = bridges.get(id)
  if (b) { if (prewarm) b.prewarmed = true; return b }
  // spawn at the last-known viewer size so a pre-warmed bridge already matches the dashboard's pane.
  const { cols, rows } = prewarmSize(id)
  let p: IPty
  try {
    // -u + a UTF-8 LANG force this client to emit UTF-8 even when the host locale is empty (a LaunchAgent
    // gives LANG="" → tmux substitutes `_` for every wide char).
    p = pty.spawn('tmux', ['-u', '-L', TMUX_SOCK, 'attach-session', '-t', id], {
      name: 'xterm-256color', cols, rows,
      env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' } as Record<string, string>,
    })
  } catch { return null }
  b = { id, pty: p, cols, rows, prewarmed: prewarm, repaintToken: 0 }
  bridges.set(id, b)
  // tmux output → broadcast as raw bytes to every viewer in `subscribers` (which survives a bridge swap).
  p.onData((data) => {
    const buf = Buffer.from(data, 'utf8')
    for (const v of subscribers.get(id) ?? []) { try { v.send(buf) } catch { /* drop a wedged viewer */ } }
  })
  // attach-session exited (session died or we detached): drop the bridge, and if viewers remain kick a
  // reconcile to re-bind fast instead of waiting a full tick (the kick is alive-gated + serialized).
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

// a browser viewer connects: subscribe it to the (warm or fresh) bridge, then settleAndRepaint for one
// coherent frame (a refresh-client down the same pty, never a spliced capture-pane snapshot).
export function attachViewer(id: string, v: Viewer): boolean {
  let s = subscribers.get(id)
  if (!s) subscribers.set(id, s = new Set())
  s.add(v)
  const b = ensureBridge(id)
  if (!b) return false   // spawn failed → caller closes the socket → detachViewer prunes this subscriber
  void settleAndRepaint(b)
  return true
}
// our attach client's tty, matched by pid (b.pty.pid === client_pid) and cached. refresh-client must
// target OUR client so the redraw hits only the dashboard's pty, not a human sharing the same session.
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
// force a full coherent repaint of our client down the shared pty. On a fresh respawn the new client may
// not be registered yet (clientTty briefly null), so retry until it resolves, bounded (~0.5s); a newer
// token supersedes us so we never clobber a fresher size.
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
// every (re)attach and resize routes here. A per-bridge token coalesces a burst (attach + open-time
// resize) to one run: settle, poll tmux's real pane geometry until it equals the size we asked for, then
// fire a single refresh-client. A newer token supersedes us at every checkpoint. Bounded (~0.5s).
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
  // last viewer gone → drop the registry entry, then release the client unless it's kept warm. An empty
  // subscriber set is the single authority for "no one watching" (used here and in the supervisor reap).
  subscribers.delete(id)
  const b = bridges.get(id)
  if (b && !b.prewarmed) killBridge(id)
}
// raw terminal input (keystrokes + mouse) straight into the shared tmux client.
export function writeViewer(id: string, data: Buffer): void {
  bridges.get(id)?.pty.write(data.toString('utf8'))
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
  if (cols !== b.cols || rows !== b.rows) {
    b.cols = cols; b.rows = rows
    try { b.pty.resize(cols, rows) } catch { /* dead pty; next fit/tick retries */ }
  }
  void settleAndRepaint(b)
}

// one reconcile pass: warm a bridge per live session, re-bind a watched session whose pty died, reap a
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
    // no bridge for a live session: viewers waiting → re-bind and settleAndRepaint (nothing else re-arms an
    // idle pane); else pre-warm an idle detached session, but only if no human client is already attached.
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

// a watched bridge's pty died — recover now instead of waiting a full tick (alive-gated + serialized).
function kickSupervisor(): void {
  if (supervising) void runReconcile()
}
