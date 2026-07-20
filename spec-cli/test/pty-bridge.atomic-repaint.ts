// Regression proof for the terminal-wide scroll visible on session entry and browser resize. A resize sends
// SIGWINCH to the pane; a TUI redraw can reach control mode as many `%output` events before the bridge's
// capture frame. Those events are already present in the capture, so a viewer must see the frame first and
// only the live tail after it, never both render paths in sequence.
//
// Run (from spec-cli/): SPEXCODE_TMUX=atomic-repaint-<pid> npx tsx test/pty-bridge.atomic-repaint.ts
import { execFile } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `atomic-repaint-${process.pid}`
const SESSION = 'atomic-repaint'
const FIRST = { cols: 140, rows: 44 }
const NEXT = { cols: 96, rows: 30 }
const FRAME_CLEAR = Buffer.from('\x1b[H\x1b[2J')
const LIVE_TAIL = Buffer.from('LIVE-TAIL-AFTER-REPAINT')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

const PROG = String.raw`
const W = process.stdout
const draw = (label) => {
  const cols = W.columns || 96, rows = W.rows || 30
  const line = (label + ' | ' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(8)).slice(0, Math.max(1, cols - 1))
  W.write('\x1b[2J\x1b[H' + Array.from({ length: Math.max(1, rows - 1) }, (_, i) =>
    String(i + 1).padStart(2, '0') + ' ' + line
  ).join('\r\n'))
}
draw('READY')
process.on('SIGWINCH', () => {
  draw('SIGWINCH-REDRAW')
  setTimeout(() => W.write('\x1b[H${LIVE_TAIL.toString()}'), 600)
})
setInterval(() => {}, 1 << 30)
`

async function main(): Promise<void> {
  const progFile = `/tmp/spex-atomic-repaint-${process.pid}.mjs`
  writeFileSync(progFile, PROG)
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', String(FIRST.cols), '-y', String(FIRST.rows))

  const chunks: Buffer[] = []
  const viewer: Viewer = { send: (data) => chunks.push(Buffer.from(data)) }
  try {
    if (!attachViewer(SESSION, viewer, FIRST)) throw new Error('attachViewer failed')
    await sleep(350)
    await tmux('send-keys', '-t', SESSION, '-l', `node ${progFile}`)
    await tmux('send-keys', '-t', SESSION, 'Enter')
    await sleep(500)

    chunks.length = 0
    resizeBridge(SESSION, NEXT.cols, NEXT.rows)
    await sleep(1400)

    const frameIndex = chunks.findIndex((chunk) => chunk.indexOf(FRAME_CLEAR) >= 0)
    const tailIndex = chunks.findIndex((chunk) => chunk.indexOf(LIVE_TAIL) >= 0)
    const order = chunks.map((chunk) => chunk.indexOf(FRAME_CLEAR) >= 0 ? `frame:${chunk.length}`
      : chunk.indexOf(LIVE_TAIL) >= 0 ? `tail:${chunk.length}` : `raw:${chunk.length}`)
    console.log(`viewer payload order: ${order.join(' -> ')}`)
    console.log(`frame index: ${frameIndex}; live-tail index: ${tailIndex}`)

    if (frameIndex < 0) throw new Error('no reconstructed frame reached the viewer')
    if (frameIndex !== 0) throw new Error(`${frameIndex} raw SIGWINCH redraw payload(s) reached the viewer before the frame`)
    if (tailIndex <= frameIndex) throw new Error('ordinary live output did not resume after the frame')
    console.log('PASS: resize reached the viewer as one coherent frame, then the ordinary live tail resumed')
  } finally {
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
    try { unlinkSync(progFile) } catch { /* already removed */ }
  }
  process.exit(0)
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
