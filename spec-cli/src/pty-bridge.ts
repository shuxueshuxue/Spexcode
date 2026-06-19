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

type Bridge = { id: string; pty: IPty; viewers: Set<Viewer>; cols: number; rows: number; prewarmed: boolean; clientTty?: string; repaintToken: number }
const bridges = new Map<string, Bridge>()

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
    p = pty.spawn('tmux', ['-L', TMUX_SOCK, 'attach-session', '-t', id], {
      name: 'xterm-256color', cols, rows,
      env: process.env as Record<string, string>,
    })
  } catch { return null }
  b = { id, pty: p, viewers: new Set(), cols, rows, prewarmed: prewarm, repaintToken: 0 }
  bridges.set(id, b)
  // tmux output (string, utf8-boundary-safe from node-pty) → broadcast as raw bytes to every viewer.
  p.onData((data) => {
    const buf = Buffer.from(data, 'utf8')
    for (const v of b!.viewers) { try { v.send(buf) } catch { /* drop a wedged viewer */ } }
  })
  // attach-session exits when the session dies or we detach — drop the bridge so it's re-made if needed.
  p.onExit(() => { if (bridges.get(id) === b) bridges.delete(id) })
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
  const b = ensureBridge(id)
  if (!b) return false
  b.viewers.add(v)
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
async function repaint(b: Bridge): Promise<void> {
  const tty = await clientTty(b)
  if (tty) await tmuxRaw(['refresh-client', '-t', tty])
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
  await repaint(b)
}
export function detachViewer(id: string, v: Viewer): void {
  const b = bridges.get(id)
  if (!b) return
  b.viewers.delete(v)
  // no one watching and not kept warm → release the tmux client (the session itself stays alive, detached).
  if (b.viewers.size === 0 && !b.prewarmed) killBridge(id)
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
  if (!b) return
  if (cols !== b.cols || rows !== b.rows) {
    b.cols = cols; b.rows = rows
    try { b.pty.resize(cols, rows) } catch { /* dead pty; next fit retries */ }
  }
  void settleAndRepaint(b)
}

// @@@ supervisor - the cache. Every tick, ensure a warm bridge for each live session and reap bridges
// whose session has died (and that no viewer is still holding). Idempotent; started once at serve().
let supervising = false
export function superviseBridges(intervalMs = 4000): void {
  if (supervising) return
  supervising = true
  void ensureTmuxOpts()
  const tick = async () => {
    try {
      const live = new Set<string>()
      for (const s of await listSessions()) {
        if (!(await alive(s.id))) continue
        live.add(s.id)
        if (bridges.has(s.id)) { bridges.get(s.id)!.prewarmed = true; continue }  // already ours → keep warm
        // only pre-warm DETACHED sessions; if a human is attached in their own terminal, leave it alone
        // (the dashboard can still open it on demand — that's a user-initiated choice). Pre-warm spawns
        // at the last-known viewer size (prewarmSize), so a reattach finds the bridge already at the
        // dashboard's pane size — no shrink, no shrink-vs-repaint race.
        if ((await attachedCount(s.id)) === 0) ensureBridge(s.id, true)
      }
      for (const [id, b] of bridges) {
        if (live.has(id)) continue
        if (b.viewers.size === 0) killBridge(id)   // dead + unwatched → release
        else b.prewarmed = false                   // dead but still watched → serve until they leave
      }
    } catch { /* transient git/tmux hiccup; next tick retries */ }
    setTimeout(tick, intervalMs)
  }
  void tick()
}
