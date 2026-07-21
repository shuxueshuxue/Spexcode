// A fresh browser terminal is empty. Native attach must therefore deliver its complete repaint even when a
// busy pane appends incremental cursor/spinner transactions inside the attach coalescing window.
//
// Run: SPEXCODE_TMUX=cold-incremental-<pid> npx tsx test/pty-bridge.cold-incremental.ts
import { execFile } from 'node:child_process'
import { unlinkSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `cold-incremental-${process.pid}`
const SESSION = 'cold-incremental'
const SIZE = { cols: 96, rows: 30 }
const FULL = Buffer.from('FULL-STABLE-LINE')
const DIFF = Buffer.from('BUSY-DIFF-')
const BSU = Buffer.from('\x1b[?2026h')
const ESU = Buffer.from('\x1b[?2026l')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

const PROGRAM = String.raw`
const out = process.stdout
const cols = out.columns || ${SIZE.cols}, rows = out.rows || ${SIZE.rows}
const line = ('${FULL.toString()} ' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(4)).slice(0, cols - 1)
out.write('\x1b[?1049h\x1b[?2026h\x1b[2J\x1b[H' + Array.from({ length: rows - 1 }, (_, i) =>
  String(i + 1).padStart(2, '0') + ' ' + line).join('\r\n') + '\x1b[?2026l')
let tick = 0
setInterval(() => out.write('\x1b[H${DIFF.toString()}' + String(tick++ % 10)), 20)
`

async function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for first attach batch')
    await sleep(10)
  }
}

async function main(): Promise<void> {
  const program = `/tmp/spex-cold-incremental-${process.pid}.mjs`
  writeFileSync(program, PROGRAM)
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', String(SIZE.cols), '-y', String(SIZE.rows))
  await tmux('set-option', '-t', SESSION, 'status', 'off')
  await tmux('respawn-pane', '-k', '-t', SESSION, `node ${program}`)
  await sleep(250)
  const paneBeforeAttach = (await tmux('capture-pane', '-p', '-N', '-t', SESSION)).stdout
  if (!paneBeforeAttach.includes(FULL.toString())) throw new Error('fixture pane was not fully drawn before attach')

  const chunks: Buffer[] = []
  const commits: string[] = []
  const viewer: Viewer = {
    send: (data) => chunks.push(Buffer.from(data)),
    commitSize: (cols, rows) => commits.push(`${cols}x${rows}`),
  }
  try {
    attachViewer(SESSION, viewer)
    resizeBridge(SESSION, viewer, SIZE.cols, SIZE.rows)
    await waitFor(() => chunks.length > 0)
    const first = chunks[0]
    if (!first.includes(FULL)) {
      throw new Error(`first attach batch kept only an incremental diff (${first.length} bytes), leaving a fresh xterm black`)
    }
    if (first.indexOf(BSU) < 0 || first.lastIndexOf(ESU) < first.indexOf(FULL)) {
      throw new Error('first attach batch was not a complete native transaction sequence')
    }
    if (commits.join(',') !== `${SIZE.cols}x${SIZE.rows}`) throw new Error(`unexpected size commits: ${commits.join(',')}`)
    console.log(`PASS: first attach batch preserved the full repaint plus busy diff in ${first.length} native bytes`)
  } finally {
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
    unlinkSync(program)
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
