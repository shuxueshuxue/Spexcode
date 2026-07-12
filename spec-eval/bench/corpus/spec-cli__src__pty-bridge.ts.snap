import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listSessions, alive } from './sessions.js'

const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
// cold fallback size for a session no viewer has ever sized (see lastFit).
const DEFAULT_COLS = 120, DEFAULT_ROWS = 40

// a viewer: anything we can push pane bytes to (a WebSocket, wrapped).
export type Viewer = { send: (data: Buffer) => void }

// resolver for one control-mode command's %begin..%end reply lines (raw bytes — a capture-pane body is UTF-8).
type Pending = (lines: Buffer[]) => void
type Bridge = {
  id: string; pty: IPty; cols: number; rows: number; prewarmed: boolean
  repaintToken: number
  // the size VOTE: whether this client currently asserts window size. Only a bridge some viewer has SIZED
  // (visible connect / resize — never a hidden board-load connect) votes; all others carry tmux's
  // ignore-size client flag and are size-NEUTRAL, so a foreign backend instance sharing the socket can
  // never move a window a human is watching (see setVote).
  voting: boolean
  // control-mode parser state: an incomplete-line BYTE buffer, the in-flight command block (%begin..%end) with
  // its command number, a FIFO of one resolver per command sent (tmux answers in order), and the last
  // %layout-change size so a repaint knows the pane already converged and needn't wait for the event.
  buf: Buffer
  block: Buffer[] | null
  blockNum: string
  cmdQ: Pending[]
  lastLayout?: string
  // one waiter for the %layout-change that confirms the wanted size — no timer: `refresh-client -C` is
  // PROVEN to always emit exactly one %layout-change carrying the requested WxH (even a same-size no-op), so
  // the event is a guaranteed arrival, not a hope that needs a settle-timeout ([[deterministic-convergence]]).
  layoutWaiter?: { want: string; resolve: () => void }
  // the next repaint must be a FULL frame — the DEC-mode prelude (so xterm mirrors the pane's alt-screen /
  // mouse state), not a resize's visible-only re-seed. Set on every (re)attach and re-bind, since a
  // (re)connecting viewer's xterm is blank / just reset.
  needsFull?: boolean
  // Copy-mode freezes the pane's view. While that mode owns the screen, raw %output still describes the
  // underlying live grid; repaint owns what viewers see until mode exit snaps them back to the bottom.
  paneInMode?: boolean
}
const bridges = new Map<string, Bridge>()
// viewers keyed by session id (not the Bridge), so a subscription outlives any bridge death/respawn.
const subscribers = new Map<string, Set<Viewer>>()

type PaneMode = {
  inMode: boolean
  alternate: boolean
  mouseStandard: boolean
  mouseButton: boolean
  mouseAny: boolean
  mouseSgr: boolean
  scrollPosition: number
  paneHeight: number
  cursorX: number
  cursorY: number
}
// cursor_x/cursor_y are the underlying program's cursor (0-based), NOT the copy-mode cursor — so a frame can
// restore it and any following live %output that moves the cursor RELATIVELY resumes from the right origin.
const PANE_MODE_FORMAT = '#{pane_in_mode},#{alternate_on},#{mouse_standard_flag},#{mouse_button_flag},#{mouse_any_flag},#{mouse_sgr_flag},#{scroll_position},#{pane_height},#{cursor_x},#{cursor_y}'
const flag = (v?: string) => v === '1'
function num(v?: string): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

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

const isOct = (c: number) => c >= 0x30 && c <= 0x37   // ASCII '0'..'7'

// %output escaping (MEASURED against tmux 3.4, not assumed): tmux octal-escapes ONLY the C0 control bytes and
// backslash (`\015` `\012` `\033` `\134`, all < 0x80) — every high byte is passed THROUGH RAW. We parse the
// whole control stream as BYTES (never a string), because node-pty's own utf8 decode splits a multi-byte
// character straddling two OS reads into a U+FFFD before we could see it — the corruption this closes. So work
// on the raw `%output` byte segment: a `\NNN` (backslash 0x5C + three octal-digit bytes) becomes that one
// byte, every other byte passes through UNTOUCHED. The result is already the pane's exact UTF-8 byte stream —
// broadcast it verbatim, with NO string round-trip to shatter a wide character (`我` / `┌` / `😀`).
function unescapeOutput(data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(data.length)
  let j = 0
  for (let i = 0; i < data.length; i++) {
    const c = data[i]
    if (c === 0x5C && i + 3 < data.length && isOct(data[i + 1]) && isOct(data[i + 2]) && isOct(data[i + 3])) {
      out[j++] = ((data[i + 1] - 0x30) << 6) | ((data[i + 2] - 0x30) << 3) | (data[i + 3] - 0x30)
      i += 3
    } else {
      out[j++] = c
    }
  }
  return out.subarray(0, j)
}

// join capture-pane reply lines (each already raw UTF-8 bytes) with CRLF at the byte level — no string round-trip.
const CRLF = Buffer.from('\r\n')
function joinLines(lines: Buffer[]): Buffer {
  if (lines.length === 0) return Buffer.alloc(0)
  const parts: Buffer[] = []
  for (let i = 0; i < lines.length; i++) { if (i) parts.push(CRLF); parts.push(lines[i]) }
  return Buffer.concat(parts)
}

async function tmuxRaw(args: string[]): Promise<void> {
  try { await pexec('tmux', ['-L', TMUX_SOCK, ...args]) } catch { /* best-effort */ }
}
async function tmuxOut(args: string[]): Promise<string> {
  try {
    const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, ...args])
    return stdout.trim()
  } catch { return '' }
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
function command(b: Bridge, cmd: string): Promise<Buffer[]> {
  return new Promise((resolve) => {
    b.cmdQ.push(resolve)
    try { b.pty.write(cmd + '\n') } catch { b.cmdQ = b.cmdQ.filter((r) => r !== resolve); resolve([]) }
  })
}

// parse the control stream line by line AT THE BYTE LEVEL (an incomplete tail is held in b.buf until its 0x0A
// arrives). Splitting on the newline byte — never on a decoded string — is what keeps a multi-byte UTF-8
// character intact when it straddles two OS reads: node-pty hands us raw Buffers (encoding:null), so no read
// boundary can shatter a wide char into a U+FFFD before we reassemble the line.
function feed(b: Bridge, chunk: Buffer): void {
  b.buf = b.buf.length ? Buffer.concat([b.buf, chunk]) : chunk
  let i: number
  while ((i = b.buf.indexOf(0x0A)) >= 0) {
    let line = b.buf.subarray(0, i)
    if (line.length && line[line.length - 1] === 0x0D) line = line.subarray(0, line.length - 1)
    b.buf = b.buf.subarray(i + 1)
    onLine(b, line)
  }
}

// strip the control-mode DCS wrapper (`\x1bP<n>p` on enter, `\x1b\\` on exit) at the byte level — its bytes are
// all ASCII and it only ever brackets the first/last notification, never %output data or capture content.
function stripDcs(line: Buffer): Buffer {
  if (line.length >= 2 && line[0] === 0x1b && line[1] === 0x50) {   // ESC P … p
    const p = line.indexOf(0x70, 2)
    if (p >= 0) line = line.subarray(p + 1)
  }
  if (line.length >= 2 && line[line.length - 2] === 0x1b && line[line.length - 1] === 0x5c) line = line.subarray(0, line.length - 2)   // ESC backslash
  return line
}

function onLine(b: Bridge, lineBuf: Buffer): void {
  // Inside a command reply everything is verbatim content until %end/%error. Capture-pane body lines are RAW
  // pane bytes (real escapes + UTF-8), so they must NOT go through stripDcs: a captured row can legitimately
  // END in \x1b\\ — the ST that terminates an OSC 8 hyperlink (`\x1b]8;;\x1b\\`, e.g. a Claude Code URL) — and
  // stripDcs's trailing-\x1b\\ strip would eat it, leaving the hyperlink unterminated so xterm never closes it
  // and paints the rest of the screen underlined. The DCS-exit wrapper only ever ends a control line at stream
  // exit, never a reply body, so the strip belongs to the protocol path below, not here. Classify %end/%error
  // on the raw line — but only one whose command number matches this %begin's closes it, so a pane row that
  // merely starts with "%end" can't false-close.
  if (b.block) {
    const h = lineBuf.toString('latin1')
    const m = h.match(/^%(?:end|error) \S+ (\d+)/)
    if (m && m[1] === b.blockNum) {
      const lines = b.block; b.block = null
      const resolve = b.cmdQ.shift(); if (resolve) resolve(lines)
    } else {
      b.block.push(lineBuf)   // raw bytes verbatim — escapes (incl. OSC 8 ST) + UTF-8, not to be string-mangled
    }
    return
  }
  const line = stripDcs(lineBuf)
  // The control PROTOCOL (%begin/%end/%error/%output/%layout-change prefixes, command numbers, layout tokens)
  // is pure ASCII, so decode as latin1 for classification only — a total 1-byte↔1-char map, so a byte index
  // in `head` is the same byte index in `line`; the DATA is taken from the raw Buffer, never from `head`.
  const head = line.toString('latin1')
  if (head.startsWith('%output ')) {
    if (b.paneInMode) return
    const sp = head.indexOf(' ', 8)   // skip "%output %<pane> " to the raw (escaped) data
    if (sp > 0) broadcast(b.id, unescapeOutput(line.subarray(sp + 1)))
    return
  }
  const beg = head.match(/^%begin \S+ (\d+)/)
  if (beg) { b.block = []; b.blockNum = beg[1]; return }
  if (head.startsWith('%layout-change ')) {
    const m = head.match(/,(\d+x\d+),/)   // layout token = checksum,WIDTHxHEIGHT,x,y,… — the window size
    onLayout(b, m ? m[1] : undefined)
    return
  }
  // Mode enter/exit emits no pane bytes of its own. Route through repaint only: paneInMode is written solely
  // by repaint under its token, so racing mode flips can't leave a stale read as the last freeze-state write.
  // ALWAYS repaint — even with a full attach frame pending (needsFull): skipping here left the flip's freeze
  // state to a repaint that could be superseded and never land, latching %output frozen. The token machinery
  // already dedups (the newest repaint wins); a spare repaint is cheap, a dropped mode flip mutes the bridge.
  if (head.startsWith('%pane-mode-changed')) {
    void repaint(b)
    return
  }
  // %exit / %client-detached / window close → the client is gone; pty.onExit drives the re-bind.
}

function onLayout(b: Bridge, size?: string): void {
  if (!size) return
  const changed = b.lastLayout !== undefined && b.lastLayout !== size
  b.lastLayout = size
  const w = b.layoutWaiter
  if (w) { b.layoutWaiter = undefined; w.resolve() }
  // an UNSOLICITED geometry change (another control client resized the shared window) with no repaint in
  // flight: re-seed the viewers at the new size, or they keep painting deltas onto stale geometry (garble).
  else if (changed) void repaint(b)
}

// resolve when the NEXT %layout-change arrives — the pane has re-wrapped at whatever size tmux CONVERGED to.
// DETERMINISTIC, NO TIMER: `refresh-client -C WxH` is measured to ALWAYS emit exactly one %layout-change
// (even a same-size no-op), so the event is a guaranteed arrival. Crucially the waiter accepts ANY announced
// size, never an exact match on the size we asked for: every viewer/peek/prewarm is its own control client
// sharing ONE window under `window-size latest`, so the announcement routinely carries a DIFFERENT client's
// size — an exact-size wait deadlocks the seed frame forever (needsFull latches, %output stays frozen: the
// mute black terminal). Immediate when already converged at `want`. A newer repaint supersedes an older
// waiter by resolving it — the superseded repaint then falls out on its stale token.
function awaitLayout(b: Bridge, want: string): Promise<void> {
  if (b.lastLayout === want) return Promise.resolve()
  return new Promise((resolve) => {
    b.layoutWaiter?.resolve()
    b.layoutWaiter = { want, resolve }
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
    // empty (a LaunchAgent gives LANG="" → tmux would substitute `_` for every wide char). encoding:null makes
    // onData deliver raw Buffers so a wide char split across two reads can't be pre-decoded into a U+FFFD.
    p = pty.spawn('tmux', ['-u', '-CC', '-L', TMUX_SOCK, 'attach-session', '-t', id], {
      name: 'xterm-256color', cols, rows, encoding: null,
      env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' } as Record<string, string>,
    })
  } catch { return null }
  b = { id, pty: p, cols, rows, prewarmed: prewarm, repaintToken: 0, voting: false, buf: Buffer.alloc(0), block: null, blockNum: '', cmdQ: [], needsFull: true }
  bridges.set(id, b)
  const bx = b
  p.onData((d) => feed(bx, d as unknown as Buffer))   // encoding:null → d is a Buffer (typings say string)
  // every client starts size-NEUTRAL: flag it before any refresh-client -C can enter the FIFO (a bare
  // attach asserts nothing — measured: only -C moves a window — so there is no pre-flag race). Sent as a
  // stream command, not an attach-time `-f`, so a pre-3.2 tmux degrades to a harmless in-stream %error
  // (old size-fight behaviour) instead of a client that cannot attach at all.
  void command(b, 'refresh-client -f ignore-size')
  // attach-session exited (session died or we detached): drop the bridge, unblock any awaiting command AND any
  // %layout-change waiter (no timer backs it now, so a bridge that dies mid-convergence MUST resolve its
  // waiter or the awaiting repaint hangs), and if viewers remain kick a reconcile to re-bind fast.
  p.onExit(() => {
    if (bx.layoutWaiter) { const w = bx.layoutWaiter; bx.layoutWaiter = undefined; w.resolve() }
    const q = bx.cmdQ; bx.cmdQ = []; for (const r of q) r([])
    if (bridges.get(id) === bx) bridges.delete(id)
    if ((subscribers.get(id)?.size ?? 0) > 0) kickSupervisor()
  })
  return b
}

// flip this client's size vote — the arbitration that makes ANY number of backend instances share one tmux
// socket without size-fights. tmux's `ignore-size` client flag means "yield while any unflagged client is
// attached" (server-wide, and void when ALL clients are flagged — then everyone counts again, which is what
// keeps the single-backend warm hold working). So: a bridge votes (unflags) from the moment a viewer SIZES
// it, and goes neutral again when its last viewer leaves. A suppressed refresh-client -C still receives its
// one %layout-change (measured — announcing the window's real size), so the deterministic resize wait and
// the accept-any-announced-size rule need no change on either side of the flag.
function setVote(b: Bridge, on: boolean): void {
  if (b.voting === on) return
  b.voting = on
  void command(b, `refresh-client -f ${on ? '!' : ''}ignore-size`)
}

function killBridge(id: string): void {
  const b = bridges.get(id)
  if (!b) return
  if (b.layoutWaiter) { const w = b.layoutWaiter; b.layoutWaiter = undefined; w.resolve() }
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
//     paint — purely — to the client's first resize, which fires the moment the pane becomes visible and the
//     client measures its real size, so the first frame is drawn at the true visible size. NO timer fallback:
//     a pane that never resizes is a pane no one ever looks at (a viewer sends its real size the instant it
//     becomes visible), so it needs no frame — the first paint is a pure resize event, zero timer.
export function attachViewer(id: string, v: Viewer, initialSize?: { cols: number; rows: number }): boolean {
  let s = subscribers.get(id)
  if (!s) subscribers.set(id, s = new Set())
  s.add(v)
  const b = ensureBridge(id)
  if (!b) return false   // spawn failed → caller closes the socket → detachViewer prunes this subscriber
  b.needsFull = true     // a (re)connecting viewer's xterm is blank / just reset → its first frame must be FULL
  if (initialSize && initialSize.cols > 0 && initialSize.rows > 0) {
    setVote(b, true)                                   // a sized viewer → this client asserts window size
    applySize(b, initialSize.cols, initialSize.rows)   // resize-then-repaint at the client's true size
  }
  // else HIDDEN connect (0×0, no size): paint nothing now — the first frame is driven purely by the client's
  // first resize (fires when the pane becomes visible at its true size). No timer, never a guessed frame.
  return true
}

async function readPaneMode(id: string): Promise<PaneMode> {
  const raw = await tmuxOut(['display-message', '-p', '-t', id, '-F', PANE_MODE_FORMAT])
  const [inMode, alternate, mouseStandard, mouseButton, mouseAny, mouseSgr, scrollPosition, paneHeight, cursorX, cursorY] = raw.split(',')
  return {
    inMode: flag(inMode),
    alternate: flag(alternate),
    mouseStandard: flag(mouseStandard),
    mouseButton: flag(mouseButton),
    mouseAny: flag(mouseAny),
    mouseSgr: flag(mouseSgr),
    scrollPosition: num(scrollPosition),
    paneHeight: num(paneHeight),
    cursorX: num(cursorX),
    cursorY: num(cursorY),
  }
}

function canInjectSgrWheel(mode: PaneMode): boolean {
  return mode.mouseSgr && (mode.mouseStandard || mode.mouseButton || mode.mouseAny)
}

// a control-mode bare attach REPLAYS NOTHING (unlike a raw attach, where tmux resends the pane's whole terminal
// state — alt-screen switch, mouse-tracking modes, …). So a FULL (re)attach frame must RECONSTRUCT that state:
// emit the matching DEC private-mode prelude from the same pane-mode abstraction used for wheel routing. The
// browser xterm mirrors the pane on the ALTERNATE screen and in the app's mouse-tracking mode; live mode
// changes flow through %output naturally.
function paneModePrelude(mode: PaneMode): string {
  let s = ''
  if (mode.alternate) s += '\x1b[?1049h'                                   // alternate screen (full-screen TUI)
  if (mode.mouseStandard) s += '\x1b[?1000h'
  if (mode.mouseButton) s += '\x1b[?1002h'
  if (mode.mouseAny) s += '\x1b[?1003h'
  if (mode.mouseSgr) s += '\x1b[?1006h'                                    // SGR-encoded mouse reports
  return s
}

function wheelMouseReport(up: boolean, col: number, row: number, ticks: number): string {
  const button = up ? 64 : 65
  return `\x1b[<${button};${col};${row}M`.repeat(ticks)
}

function capturePaneCommand(b: Bridge, mode: PaneMode): string {
  if (!mode.inMode) return `capture-pane -e -p -t ${b.id}`
  // tmux capture-pane's default "visible pane" ignores the copy-mode viewport. In copy-mode,
  // scroll_position is the offset above the bottom visible screen; capture that history window explicitly.
  const rows = Math.max(1, mode.paneHeight || b.rows)
  const scroll = mode.scrollPosition
  const start = scroll === 0 ? '0' : `-${scroll}`
  const end = rows - 1 - scroll
  return `capture-pane -e -p -t ${b.id} -S ${start} -E ${end}`
}

// A wheel always enters at the tmux adapter boundary. If the pane is in copy-mode, or is a normal pane with
// tmux history, tmux scrolls its own copy-mode view and we repaint that view. If the pane is a mouse-owning
// TUI with SGR mouse reports enabled, inject that wheel report. No harness-specific branch exists.
export function forwardWheel(id: string, up: boolean, col: number, row: number, ticks: number): void {
  const b = bridges.get(id)
  if (!b) return
  const c = Math.max(1, Math.floor(col) || 1), r = Math.max(1, Math.floor(row) || 1)
  const n = Math.max(1, Math.min(10, Math.floor(ticks) || 1))
  void (async () => {
    const mode = await readPaneMode(id)
    if (mode.inMode || !canInjectSgrWheel(mode)) {
      if (up && !mode.inMode) await tmuxRaw(['copy-mode', '-e', '-t', id])
      if (up || mode.inMode) {
        await tmuxRaw(['send-keys', '-t', id, '-X', '-N', String(n * 5), up ? 'scroll-up' : 'scroll-down'])
        await repaint(b)
      }
      return
    }
    await tmuxRaw(['send-keys', '-t', id, '-l', '--', wheelMouseReport(up, c, r, n)])
  })()
}

// every (re)attach and resize routes here. Deterministic, event-driven, zero polling: set the size with
// refresh-client -C, wait to be TOLD it converged by the guaranteed %layout-change (NO timer), then seed one
// coherent frame from a capture-pane at that size. A per-bridge token supersedes a stale run at every await.
// The capture frame broadcasts synchronously at its block-end, so any %output that follows in the stream
// lands AFTER the frame and is never overwritten by it — the frame is the attach seed, %output the live tail.
//
// A frame is a COMPLETE reconstruction of the pane's terminal state at the converged size — so the live
// %output that follows renders coherently on top of it. A `capture-pane` seed carries only the GRID (cells +
// their attributes + hyperlinks, byte-verbatim); the frame wraps the rest of the state around it, in stream
// order:
//   modes  — alt-screen + mouse tracking, reconstructed from the pane's live flags (FULL frames only — a
//            plain resize keeps the modes the browser already holds; control mode never re-emits them).
//   pen    — reset SGR + close any open OSC 8 hyperlink, so no attribute/hyperlink state leaks across the
//            clear from the prior frame (xterm renders an unclosed hyperlink as a whole-screen underline).
//   clear  — blank the viewport (`\x1b[H\x1b[2J`, never the scrollback `\x1b[3J`).
//   grid   — the captured rows, joined at the BYTE level so a wide char / an OSC 8 ST is never string-mangled.
//   cursor — put the cursor where the pane REALLY has it, so a relative live redraw resumes from the right
//            origin. An inline TUI (Ink) erases its previous frame by moving up from where it left the cursor
//            — which sits on the input line, above trailing hint rows; a frame that left the cursor at the
//            body's end would make the next redraw erase the wrong rows and double the bottom UI.
// Each live-view rendering bug was ONE missing piece of this reconstruction (a mangled grid byte, a leaked
// hyperlink, a dropped cursor); building the whole state in one place is what keeps them all fixed.
function reconstructFrame(mode: PaneMode, lines: Buffer[], full: boolean): Buffer {
  const modes = full ? paneModePrelude(mode) : ''
  const pen = '\x1b[m\x1b]8;;\x1b\\'
  const clear = '\x1b[H\x1b[2J'
  const cursor = `\x1b[${mode.cursorY + 1};${mode.cursorX + 1}H`
  return Buffer.concat([Buffer.from(modes + pen + clear, 'utf8'), joinLines(lines), Buffer.from(cursor, 'utf8')])
}

// every (re)attach and resize routes here to broadcast one reconstructed frame (see reconstructFrame). The
// frame reflects the pane at its command boundary, so live %output that follows lands after it, never under it.
async function repaint(b: Bridge): Promise<void> {
  const token = ++b.repaintToken
  const want = `${b.cols}x${b.rows}`
  const full = !!b.needsFull   // consumed only when the frame lands (below), so a superseding repaint still sees it
  await command(b, `refresh-client -C ${want}`)
  if (token !== b.repaintToken) return
  await awaitLayout(b, want)
  if (token !== b.repaintToken) return
  const mode = await readPaneMode(b.id)
  if (token !== b.repaintToken) return
  b.paneInMode = mode.inMode
  b.cmdQ.push((lines) => {
    if (token !== b.repaintToken) return
    if (full) b.needsFull = false   // cleared only once the full frame actually reaches a viewer
    broadcast(b.id, reconstructFrame(mode, lines, full))
  })
  const cap = capturePaneCommand(b, mode)
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
  else if (b) setVote(b, false)   // kept warm → back to size-neutral: an unwatched client must not out-vote a watched one
}
// a viewer fitted xterm → record the size as the last-known fit (even with no bridge yet, for pre-warm)
// and resize the shared client. Repaints even on an unchanged size (a reconnect needs the frame). `full` (a
// resize right after the viewer reset its xterm) forces the next frame to be a FULL one — mode prelude +
// history — so a just-reset terminal re-enters the pane's alt-screen / mouse modes, not just its visible screen.
export function resizeBridge(id: string, cols: number, rows: number, full = false): void {
  if (!(cols > 0 && rows > 0)) return
  lastFit.set(id, { cols, rows }); lastFitAny = { cols, rows }
  const b = bridges.get(id)
  if (b) { if (full) b.needsFull = true; setVote(b, true); applySize(b, cols, rows) }
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
    // so a first open finds the pane already at its size. TWO staleness guards, by vote state: a NEUTRAL
    // client's hold is suppressed while any sized viewer votes on the socket, so its own client size would
    // read "converged" after one suppressed attempt and wedge the hold forever — compare against the
    // WINDOW's real size (lastLayout) instead, retrying each tick (one suppressed no-op command) until the
    // first tick after the socket goes quiet: deferred, not lost. A VOTING client keeps the client-size
    // guard: its -C lands, and when two voting instances watch ONE session the window is genuinely
    // contended — latest assert wins and STOPS (a window-truth guard would re-assert every tick and turn
    // that contention into a visible size ping-pong war).
    const existing = bridges.get(s.id)
    if (existing) {
      existing.prewarmed = true
      const want = prewarmSize(s.id)
      const stale = existing.voting
        ? want.cols !== existing.cols || want.rows !== existing.rows
        : existing.lastLayout !== `${want.cols}x${want.rows}`
      if (stale) applySize(existing, want.cols, want.rows)
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
