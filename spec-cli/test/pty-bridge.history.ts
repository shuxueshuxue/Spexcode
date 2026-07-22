// Proof for the wheel-owned history path (the 'attach-seed-carries-pre-attach-history' scenario), re-measured
// because the repaint frame changed (it now leads with an SGR/OSC8 reset and ends by restoring the cursor).
// Drives the REAL bridge: seed more lines than the pane holds so most land in tmux history BEFORE attach, then
// (1) wheel-up must enter copy-mode (scroll_position rises) and repaint OLDER history the bottom view never
// showed, (2) fresh pane output produced WHILE scrolled must be held back from the viewer (copy-mode freeze),
// and (3) wheel-down must return toward the bottom and then release the held output.
//
// Run (from spec-cli/): SPEXCODE_TMUX=hist-<pid> npx tsx test/pty-bridge.history.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, forwardWheel, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `hist-${process.pid}`
const SESSION = 'hist'
const COLS = 80, ROWS = 12
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function tmux(...a: string[]) { return pexec('tmux', ['-L', SOCK, ...a]) }
async function scrollPos(): Promise<number> { const { stdout } = await tmux('display', '-p', '-t', SESSION, '#{scroll_position}'); return Number(stdout.trim()) || 0 }
const histNums = (s: string) => [...s.matchAll(/hist-(\d+)/g)].map((m) => Number(m[1]))

async function main() {
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', String(COLS), '-y', String(ROWS))
  // seed 300 lines into the 12-row pane → ~288 scroll into history before any bridge exists
  await tmux('send-keys', '-t', SESSION, '-l', 'for i in $(seq 1 300); do echo hist-$i; done'); await tmux('send-keys', '-t', SESSION, 'Enter')
  await sleep(800)

  let chunks: Buffer[] = []
  const viewer: Viewer = { send: (d) => { chunks.push(Buffer.from(d)) } }
  attachViewer(SESSION, viewer)
  resizeBridge(SESSION, viewer, COLS, ROWS)
  await sleep(600)
  const bottomNums = histNums(Buffer.concat(chunks).toString('utf8'))
  const bottomTop = Math.min(...bottomNums)   // smallest hist number visible at the bottom
  console.log(`bottom view shows hist-${bottomTop}..hist-${Math.max(...bottomNums)}`)

  // schedule fresh output to appear ~1.5s from now, i.e. WHILE we're scrolled up in copy-mode
  await tmux('send-keys', '-t', SESSION, '-l', '(sleep 1.5; echo FRESH-SENTINEL) &'); await tmux('send-keys', '-t', SESSION, 'Enter')
  await sleep(150)

  // (1) wheel up → copy-mode + older history
  chunks = []
  for (let i = 0; i < 6; i++) { forwardWheel(SESSION, viewer, true, 40, 5, 1); await sleep(200) }
  await sleep(400)
  const posUp = await scrollPos()
  const upText = Buffer.concat(chunks).toString('utf8')
  const upNums = histNums(upText)
  const reachedOlder = upNums.length > 0 && Math.min(...upNums) < bottomTop

  // (2) freeze: the FRESH-SENTINEL fires ~now while we're scrolled — it must NOT reach the viewer yet
  chunks = []
  await sleep(1800)   // span the moment the scheduled echo fires
  const frozenLeak = Buffer.concat(chunks).toString('utf8').includes('FRESH-SENTINEL')
  const stillScrolled = (await scrollPos()) > 0

  // (3) wheel down to the bottom → exit copy-mode, then the held output releases
  chunks = []
  for (let i = 0; i < 12; i++) { forwardWheel(SESSION, viewer, false, 40, 5, 1); await sleep(180) }
  await sleep(600)
  const posDown = await scrollPos()
  const releasedText = Buffer.concat(chunks).toString('utf8')

  detachViewer(SESSION, viewer)
  await tmux('kill-session', '-t', SESSION).catch(() => {})

  console.log(`wheel-up: scroll_position=${posUp} reachedOlderHistory=${reachedOlder} (min hist seen=${upNums.length ? Math.min(...upNums) : 'none'})`)
  console.log(`while scrolled: fresh output leaked to viewer=${frozenLeak} stillInCopyMode=${stillScrolled}`)
  console.log(`wheel-down: scroll_position=${posDown} (0 = back at live bottom) released FRESH-SENTINEL=${releasedText.includes('FRESH-SENTINEL')}`)

  const ok = posUp > 0 && reachedOlder && !frozenLeak && stillScrolled && posDown === 0
  if (!ok) { console.error('FAIL: the wheel/copy-mode history contract did not hold'); process.exit(1) }
  console.log('PASS: wheel-up reaches older tmux history (coherent repaint), live output is frozen while scrolled, wheel-down returns to the live bottom')
  process.exit(0)
}
main().catch((e) => { console.error('ERROR', e); process.exit(1) })
