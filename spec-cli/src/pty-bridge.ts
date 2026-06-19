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
const DEFAULT_COLS = 120, DEFAULT_ROWS = 40

// a viewer: anything we can push pane bytes to (a WebSocket, wrapped).
export type Viewer = { send: (data: Buffer) => void }

type Bridge = { id: string; pty: IPty; viewers: Set<Viewer>; cols: number; rows: number; prewarmed: boolean }
const bridges = new Map<string, Bridge>()

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
  let p: IPty
  try {
    p = pty.spawn('tmux', ['-L', TMUX_SOCK, 'attach-session', '-t', id], {
      name: 'xterm-256color', cols: DEFAULT_COLS, rows: DEFAULT_ROWS,
      env: process.env as Record<string, string>,
    })
  } catch { return null }
  b = { id, pty: p, viewers: new Set(), cols: DEFAULT_COLS, rows: DEFAULT_ROWS, prewarmed: prewarm }
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

// a browser viewer connects: subscribe it to the (warm or fresh) bridge, then SEED just this viewer with
// the current screen so a mid-stream join paints instantly. The seed is coherent because the live feed is
// the SAME tmux client — it's the real current screen, not the old approximate-snapshot-then-raw-delta
// splice. capture-pane is per-viewer (not a refresh-client, which would re-flicker everyone else); the
// live stream continues seamlessly and the viewer's open-time resize re-syncs the cursor.
export function attachViewer(id: string, v: Viewer): boolean {
  const b = ensureBridge(id)
  if (!b) return false
  b.viewers.add(v)
  void seedViewer(id, v)
  return true
}
async function seedViewer(id: string, v: Viewer): Promise<void> {
  try {
    const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, 'capture-pane', '-e', '-p', '-t', id])
    v.send(Buffer.from('\x1b[H\x1b[2J' + stdout.replace(/\n/g, '\r\n'), 'utf8'))
  } catch { /* fresh attach/resize will paint instead */ }
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
// a viewer fitted xterm to its panel → resize the shared client so tmux re-renders at that exact size.
export function resizeBridge(id: string, cols: number, rows: number): void {
  const b = bridges.get(id)
  if (!b || !(cols > 0 && rows > 0) || (cols === b.cols && rows === b.rows)) return
  b.cols = cols; b.rows = rows
  try { b.pty.resize(cols, rows) } catch { /* dead pty; next fit retries */ }
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
        // (the dashboard can still open it on demand — that's a user-initiated choice).
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
