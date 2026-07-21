// A TUI without DEC 2026 still must not expose its delayed clear as a browser frame during resize. The native
// client wraps its own updates; the bounded geometry window coalesces the clear with its final replacement.
//
// Run: SPEXCODE_TMUX=unsync-<pid> npx tsx test/pty-bridge.unsynchronized-repaint.ts
import { execFile } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `unsync-${process.pid}`
const SESSION = 'unsync'
const FIRST = { cols: 140, rows: 44 }
const NEXT = { cols: 96, rows: 30 }
const INTERMEDIATE = Buffer.from('UNSYNC-INTERMEDIATE-CLEAR')
const FINAL = Buffer.from('UNSYNC-FINAL')
const TAIL = Buffer.from('UNSYNC-LIVE-TAIL')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

const PROGRAM = String.raw`
const W = process.stdout
const draw = (label) => {
  const cols = W.columns || 96, rows = W.rows || 30
  const line = (label + ' ' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(8)).slice(0, Math.max(1, cols - 1))
  W.write('\x1b[2J\x1b[H' + Array.from({ length: Math.max(1, rows - 1) }, (_, i) =>
    String(i + 1).padStart(2, '0') + ' ' + line
  ).join('\r\n'))
}
draw('UNSYNC-READY')
process.on('SIGWINCH', () => {
  W.write('\x1b[2J\x1b[H${INTERMEDIATE.toString()}')
  setTimeout(() => draw('${FINAL.toString()}'), 120)
  setTimeout(() => W.write('\x1b[H${TAIL.toString()}'), 650)
})
setInterval(() => {}, 1 << 30)
`

async function main(): Promise<void> {
  const program = `/tmp/spex-unsync-${process.pid}.mjs`
  writeFileSync(program, PROGRAM)
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', String(FIRST.cols), '-y', String(FIRST.rows))

  const chunks: Buffer[] = []
  const viewer: Viewer = { send: (data) => chunks.push(Buffer.from(data)) }
  try {
    attachViewer(SESSION, viewer)
    resizeBridge(SESSION, viewer, FIRST.cols, FIRST.rows)
    await sleep(350)
    await tmux('send-keys', '-t', SESSION, '-l', `node ${program}`); await tmux('send-keys', '-t', SESSION, 'Enter')
    await sleep(500)

    chunks.length = 0
    resizeBridge(SESSION, viewer, NEXT.cols, NEXT.rows)
    await sleep(1200)
    const output = Buffer.concat(chunks)
    const finalChunk = chunks.find((chunk) => chunk.includes(FINAL))
    if (!finalChunk) throw new Error('the final unsynchronized screen never arrived')
    const intermediateChunk = chunks.find((chunk) => chunk.includes(INTERMEDIATE))
    if (intermediateChunk !== finalChunk) throw new Error('the unsynchronized temporary clear became a separate browser frame')
    if (!output.includes(TAIL)) throw new Error('ordinary output did not resume after fallback')
    console.log(`PASS: unsynchronized clear and final redraw coalesced to one ${finalChunk.length}-byte browser frame, then resumed live output`)
  } finally {
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
    try { unlinkSync(program) } catch { /* already removed */ }
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
