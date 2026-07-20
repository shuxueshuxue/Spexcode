// Regression proof for the terminal-wide flash visible on browser resize. The fixture deliberately clears,
// pauses, and only then emits its final synchronized redraw. The viewer must receive neither that temporary
// state nor a reconstructed SpexCode frame: it resumes at one complete native tmux refresh transaction.
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
const RECONSTRUCTED_HEADER = Buffer.from('\x1b[m\x1b]8;;\x1b\\\x1b[H\x1b[2J')
const ED2 = Buffer.from('\x1b[2J')
const INTERMEDIATE = Buffer.from('INTERMEDIATE-CLEAR')
const FINAL = Buffer.from('FINAL-SYNCHRONIZED')
const LIVE_TAIL = Buffer.from('LIVE-TAIL-AFTER-REPAINT')
const BSU = Buffer.from('\x1b[?2026h')
const ESU = Buffer.from('\x1b[?2026l')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

async function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for fixture output')
    await sleep(25)
  }
}

const PROG = String.raw`
const W = process.stdout
const draw = (label) => {
  const cols = W.columns || 96, rows = W.rows || 30
  const line = (label + ' | ' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(8)).slice(0, Math.max(1, cols - 1))
  W.write('\x1b[?2026h\x1b[2J\x1b[H' + Array.from({ length: Math.max(1, rows - 1) }, (_, i) =>
    String(i + 1).padStart(2, '0') + ' ' + line
  ).join('\r\n') + '\x1b[?2026l')
}
draw('READY')
process.on('SIGWINCH', () => {
  W.write('\x1b[2J\x1b[H${INTERMEDIATE.toString()}')
  setTimeout(() => draw('${FINAL.toString()}'), 120)
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
    await waitFor(() => Buffer.concat(chunks).includes(Buffer.from('READY')))
    await sleep(100)

    chunks.length = 0
    resizeBridge(SESSION, viewer, NEXT.cols, NEXT.rows)
    await waitFor(() => Buffer.concat(chunks).includes(LIVE_TAIL))
    await sleep(100)

    const all = Buffer.concat(chunks)
    const finalChunks = chunks.filter((chunk) => chunk.indexOf(FINAL) >= 0)
    const finalIndex = chunks.findIndex((chunk) => chunk.indexOf(FINAL) >= 0)
    const tailIndex = chunks.findIndex((chunk) => chunk.indexOf(LIVE_TAIL) >= 0)
    const order = chunks.map((chunk) => chunk.indexOf(FINAL) >= 0 ? `atomic:${chunk.length}` : chunk.indexOf(LIVE_TAIL) >= 0 ? `tail:${chunk.length}` : `tmux:${chunk.length}`)
    const clientLines = (await tmux('list-clients', '-t', SESSION, '-F', '#{client_flags}|#{client_width}x#{client_height}')).stdout.trim().split('\n')
    const size = clientLines.find((line) => !line.includes('ignore-size'))?.split('|').at(-1) || ''
    console.log(`viewer payload order: ${order.join(' -> ')}`)
    console.log(`window size: ${size}; live-tail index: ${tailIndex}`)

    if (all.includes(RECONSTRUCTED_HEADER)) throw new Error('SpexCode reconstructed frame leaked into native tmux stream')
    if (all.includes(ED2)) throw new Error('pane ED2 escaped tmux as a browser-visible full clear')
    if (all.includes(INTERMEDIATE)) throw new Error('the temporary clear state escaped the resize barrier')
    if (finalIndex < 0) throw new Error('the final synchronized screen was not refreshed')
    if (finalChunks.length !== 1) throw new Error(`the final screen was replayed ${finalChunks.length} times`)
    const finalChunk = chunks[finalIndex]
    const begin = finalChunk.indexOf(BSU), end = finalChunk.indexOf(ESU)
    if (begin < 0 || end < finalChunk.indexOf(FINAL)) throw new Error('the final screen was not one complete synchronized tmux transaction')
    if (tailIndex < 0) throw new Error('ordinary live output did not continue after resize')
    if (size !== `${NEXT.cols}x${NEXT.rows}`) throw new Error(`tmux converged to ${size}`)
    console.log('PASS: the delayed clear was discarded and one complete native tmux refresh became visible')
  } finally {
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
    try { unlinkSync(progFile) } catch { /* already removed */ }
  }
  process.exit(0)
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
