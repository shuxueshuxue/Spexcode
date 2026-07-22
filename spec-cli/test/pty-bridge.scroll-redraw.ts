// Regression proof for "the bottom garbles when I scroll up then down". A live inline TUI (Claude Code / Ink)
// redraws its frame by ERASING THE PREVIOUS ONE RELATIVE TO THE CURSOR (move up N lines from where it left
// off, clear, rewrite). Scrolling up freezes the browser in copy-mode while the pane keeps advancing; on the
// way back down copy-mode exits and the bridge re-seeds the view from a capture. A capture restores the GRID
// but not the CURSOR, so if the re-seed leaves the cursor at the body's end, the TUI's next relative redraw
// erases the wrong rows and the bottom UI DOUBLES. Fix: the frame ends by placing the cursor where the pane
// really has it. This drives the REAL bridge (attachViewer + native SGR wheel reports over forwardInput) against an Ink-style redrawer and
// replays the viewer stream through a small emulator to count how many times the frame's single marker survives.
//
// Run (from spec-cli/): SPEXCODE_TMUX=redraw-<pid> npx tsx test/pty-bridge.scroll-redraw.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'
import { attachViewer, detachViewer, forwardInput, resizeBridge, type Viewer } from '../src/pty-bridge.js'

// what a native mouse-report-mode xterm emits for one wheel notch — the browser no longer synthesizes
// wheel controls, so the test speaks the same SGR bytes through the ordinary input path.
const wheelReport = (up: boolean, col: number, row: number) => `\x1b[<${up ? 64 : 65};${col};${row}M`

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `redraw-${process.pid}`
const SESSION = 'redraw'
const COLS = 80, ROWS = 16
const MARKER = 'MARKER-SENTINEL'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function tmux(...a: string[]) { return pexec('tmux', ['-L', SOCK, ...a]) }

// an Ink-style redrawer that reproduces the REAL pane shape: the cursor is parked ABOVE trailing content (like
// Claude Code's cursor sitting on the ❯ input line with a separator + "bypass permissions" hint below it —
// measured live: cursor_y=58 while content runs to row 61). Each frame erases relative to that parked cursor
// (move up to the frame top, clear to end of screen) and rewrites, then re-parks the cursor 2 rows up. This
// erase is CURSOR-RELATIVE: if a re-seed leaves the browser cursor at the body's end instead of the parked
// spot, the up-move lands wrong and the top of the old frame is never erased → a doubled frame.
const PROG = `
const W = process.stdout
for (let i=1;i<=40;i++) W.write('history-line-'+i+'\\n')
let n = 0, first = true
setInterval(() => {
  if (!first) { W.write('\\x1b[2A\\x1b[G'); W.write('\\x1b[0J') }   // from parked cursor: up to frame top, col 0, clear frame
  first = false
  n++
  W.write('BOX counter='+n+'\\n')
  W.write('BOX ${MARKER}\\n')
  W.write('> input line\\n')            // the cursor parks HERE (mid-frame)
  W.write('---- separator ----\\n')
  W.write('bypass hint')                // trailing content BELOW the parked cursor
  W.write('\\x1b[2A\\x1b[8G')            // park cursor 2 rows up (the input line), col 8
}, 250)
`

// a minimal VT emulator: enough of cursor motion + line clears to detect a doubled frame.
function emulate(bytes: Buffer, cols: number, rows: number): string[] {
  const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(' '))
  let r = 0, c = 0
  const clampR = () => { if (r < 0) r = 0; if (r > rows - 1) r = rows - 1 }
  const scroll = () => { grid.shift(); grid.push(Array(cols).fill(' ')) }
  const s = bytes
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === 0x1b) {
      if (s[i + 1] === 0x5d) { // OSC \x1b] … terminated by BEL or ST(\x1b\\)
        i += 2; while (i < s.length && !(s[i] === 0x07 || (s[i] === 0x1b && s[i + 1] === 0x5c))) i++
        if (s[i] === 0x1b) i++ // consume the backslash of ST
        continue
      }
      if (s[i + 1] === 0x5b) { // CSI \x1b[
        let j = i + 2, params = ''
        while (j < s.length && !((s[j] >= 0x40 && s[j] <= 0x7e))) { params += String.fromCharCode(s[j]); j++ }
        const final = String.fromCharCode(s[j]); i = j
        const nums = params.replace(/^\?/, '').split(';').map((x) => parseInt(x || '0', 10))
        const n0 = nums[0] || 0
        if (params.startsWith('?')) continue // DEC private mode set/reset — ignore
        switch (final) {
          case 'H': case 'f': r = (nums[0] || 1) - 1; c = (nums[1] || 1) - 1; clampR(); break
          case 'A': r -= (n0 || 1); clampR(); break
          case 'B': r += (n0 || 1); clampR(); break
          case 'C': c += (n0 || 1); break
          case 'D': c -= (n0 || 1); if (c < 0) c = 0; break
          case 'G': c = (n0 || 1) - 1; break
          case 'J': { // erase in display: 0=below,1=above,2=all
            if (n0 === 2) { for (let y = 0; y < rows; y++) grid[y].fill(' ') }
            else if (n0 === 0) { for (let x = c; x < cols; x++) grid[r][x] = ' '; for (let y = r + 1; y < rows; y++) grid[y].fill(' ') }
            else { for (let y = 0; y < r; y++) grid[y].fill(' '); for (let x = 0; x <= c; x++) grid[r][x] = ' ' }
            break
          }
          case 'K': { // erase in line
            if (n0 === 2) grid[r].fill(' ')
            else if (n0 === 0) { for (let x = c; x < cols; x++) grid[r][x] = ' ' }
            else { for (let x = 0; x <= c; x++) grid[r][x] = ' ' }
            break
          }
          default: break // SGR 'm' and everything else: ignore
        }
        continue
      }
      // other ESC (e.g. ESC \\ stray ST, ESC 7/8): skip the next byte
      i++; continue
    }
    if (ch === 0x0d) { c = 0; continue }
    if (ch === 0x0a) { r++; if (r > rows - 1) { r = rows - 1; scroll() } continue }
    if (ch === 0x08) { if (c > 0) c--; continue }
    if (ch < 0x20) continue
    // printable (treat each byte as a column; multi-byte UTF-8 continuation bytes get their own cells but the
    // marker is pure ASCII so its count is unaffected)
    if (c < cols) { grid[r][c] = String.fromCharCode(ch); c++ }
  }
  return grid.map((row) => row.join('').replace(/\s+$/, ''))
}

async function main() {
  const progFile = `/tmp/spex-redraw-${process.pid}.mjs`
  writeFileSync(progFile, PROG)
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', String(COLS), '-y', String(ROWS))

  const chunks: Buffer[] = []
  const viewer: Viewer = { send: (d) => { chunks.push(Buffer.from(d)) } }
  attachViewer(SESSION, viewer)
  resizeBridge(SESSION, viewer, COLS, ROWS)
  await sleep(500)
  await tmux('send-keys', '-t', SESSION, '-l', `node ${progFile}`); await tmux('send-keys', '-t', SESSION, 'Enter')
  await sleep(1500)   // let the box redraw a few times live

  // scroll UP (enter copy-mode, freeze) while the box keeps advancing underneath
  for (let i = 0; i < 5; i++) { forwardInput(SESSION, viewer, wheelReport(true, 40, 5)); await sleep(200) }
  await sleep(800)
  // scroll DOWN past the bottom → copy-mode exits → re-seed → live redraws resume
  for (let i = 0; i < 8; i++) { forwardInput(SESSION, viewer, wheelReport(false, 40, 5)); await sleep(200) }
  await sleep(1500)   // let several relative redraws land on the re-seeded screen

  detachViewer(SESSION, viewer)
  await tmux('kill-session', '-t', SESSION).catch(() => {})

  const screen = emulate(Buffer.concat(chunks), COLS, ROWS)
  const markerRows = screen.filter((l) => l.includes(MARKER))
  console.log('final emulated screen (last 8 rows):')
  for (const l of screen.slice(-8)) console.log('   | ' + l)
  console.log(`marker rows on screen: ${markerRows.length}`)
  if (markerRows.length === 0) { console.error('INCONCLUSIVE: the box never reached the final view'); process.exit(2) }
  if (markerRows.length > 1) { console.error(`FAIL: the redraw doubled — ${markerRows.length} copies of the frame's single marker survive (bottom garbled)`); process.exit(1) }
  console.log('PASS: exactly one frame on screen after scroll-up-then-down — the re-seed restored the cursor, no doubled redraw')
  process.exit(0)
}
main().catch((e) => { console.error('ERROR', e); process.exit(1) })
