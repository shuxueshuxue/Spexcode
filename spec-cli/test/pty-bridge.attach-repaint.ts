// A first visible viewer can change tmux geometry merely by attaching. Treat that initial native repaint as
// the same transaction as an active resize, so a delayed application clear cannot become the first frame.
//
// Run: SPEXCODE_TMUX=attach-repaint-<pid> npx tsx test/pty-bridge.attach-repaint.ts
import { execFile } from 'node:child_process'
import { unlinkSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `attach-repaint-${process.pid}`
const SESSION = 'attach-repaint'
const SIZE = { cols: 96, rows: 30 }
const BSU = Buffer.from('\x1b[?2026h')
const ESU = Buffer.from('\x1b[?2026l')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

const PROGRAM = String.raw`
const out = process.stdout
function frame(label) {
  const cols = out.columns || 120, rows = out.rows || 40
  const lines = Array.from({ length: rows - 1 }, (_, i) =>
    (String(i + 1).padStart(2, '0') + ' ' + label + ' ' + 'abcdefghijklmnopqrstuvwxyz'.repeat(8)).slice(0, cols - 1))
  return '\x1b[?2026h\x1b[H' + lines.join('\r\n') + '\x1b[?2026l'
}
out.write('\x1b[?1049h' + frame('INITIAL'))
process.on('SIGWINCH', () => setTimeout(() => {
  out.write('\x1b[r\x1b[0m\x1b[H\x1b[2J\x1b[3J\x1b[H')
  setTimeout(() => out.write(frame('FINAL')), 55)
}, 200))
setInterval(() => {}, 1 << 30)
`

async function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for final attach repaint')
    await sleep(20)
  }
}

async function main(): Promise<void> {
  const program = `/tmp/spex-attach-repaint-${process.pid}.mjs`
  writeFileSync(program, PROGRAM)
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '140', '-y', '45', `node ${program}`)
  await sleep(250)

  const chunks: Buffer[] = []
  const commits: string[] = []
  const viewer: Viewer = {
    send: (data) => chunks.push(Buffer.from(data)),
    commitSize: (cols, rows) => commits.push(`${cols}x${rows}`),
  }
  try {
    attachViewer(SESSION, viewer)
    resizeBridge(SESSION, viewer, SIZE.cols, SIZE.rows)
    await waitFor(() => Buffer.concat(chunks).includes(Buffer.from('FINAL')))
    await sleep(100)

    const payload = Buffer.concat(chunks)
    const begin = payload.lastIndexOf(BSU)
    const end = payload.lastIndexOf(ESU)
    console.log(`attach viewer frames: ${chunks.map((chunk) => `${chunk.length}:${chunk.includes(Buffer.from('INITIAL')) ? 'I' : ''}${chunk.includes(Buffer.from('FINAL')) ? 'F' : ''}`).join(' ')}`)
    if (chunks.length !== 2) throw new Error(`attach produced ${chunks.length} frames instead of one complete initial paint plus one stabilized redraw`)
    const initial = payload.indexOf(Buffer.from('INITIAL'))
    const final = payload.indexOf(Buffer.from('FINAL'))
    if (initial < 0 || final < initial) throw new Error('attach batch did not preserve native repaint order')
    if (!chunks[0].includes(Buffer.from('INITIAL')) || chunks[0].includes(Buffer.from('FINAL')) || !chunks[1].includes(Buffer.from('FINAL'))) {
      throw new Error('attach did not separate its fast complete initial paint from the stabilized app redraw')
    }
    if (begin < 0 || end < begin || !payload.includes(Buffer.from('FINAL'))) throw new Error('attach did not emit one complete final transaction')
    if (commits.join(',') !== `${SIZE.cols}x${SIZE.rows},${SIZE.cols}x${SIZE.rows}`) {
      throw new Error(`initial and stabilized frames were not both transaction-marked: ${commits.join(',')}`)
    }
    const geometry = (await tmux('display-message', '-p', '-t', SESSION, '#{status}|#{window_width}x#{window_height}')).stdout.trim()
    if (geometry !== `off|${SIZE.cols}x${SIZE.rows}`) {
      throw new Error(`native client chrome consumed pane rows (${geometry})`)
    }
    console.log(`PASS: cold attach emitted a fast complete INITIAL frame then one stabilized FINAL frame (${payload.length} bytes total) at ${commits[0]}`)
  } finally {
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
    unlinkSync(program)
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
