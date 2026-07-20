// Companion to pty-bridge.scroll-redraw.ts. Kill the isolated helper while the viewer subscription stays
// open, let the bridge restore a fresh native client, then prove cursor-relative redraws remain coherent.
//
// Run (from spec-cli/): SPEXCODE_TMUX=reconnect-<pid> npx tsx test/pty-bridge.reseed-reconnect.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import { attachViewer, detachViewer, superviseBridges, type Viewer } from '../src/pty-bridge.js'
import { emulate } from './vt-emulate.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `reconnect-${process.pid}`
const SESSION = 'reconnect'
const COLS = 80, ROWS = 16
const MARKER = 'MARKER-SENTINEL'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function tmux(...a: string[]) { return pexec('tmux', ['-L', SOCK, ...a]) }

function helperPid(): number | undefined {
  const children = readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8').trim()
  for (const raw of children.split(/\s+/)) {
    const pid = Number(raw)
    if (!pid) continue
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('pty-helper.ts')) return pid
    } catch { /* child raced away */ }
  }
  return undefined
}

// same Ink-style redrawer as the scroll proof: cursor parked ABOVE trailing content, each frame erased
// relative to that parked cursor.
const PROG = `
const W = process.stdout
for (let i=1;i<=40;i++) W.write('history-line-'+i+'\\n')
let n = 0, first = true
setInterval(() => {
  if (!first) { W.write('\\x1b[2A\\x1b[G'); W.write('\\x1b[0J') }
  first = false
  n++
  W.write('BOX counter='+n+'\\n'); W.write('BOX ${MARKER}\\n'); W.write('> input line\\n')
  W.write('---- separator ----\\n'); W.write('bypass hint')
  W.write('\\x1b[2A\\x1b[8G')
}, 250)
`

async function main() {
  const progFile = `/tmp/spex-reconnect-${process.pid}.mjs`
  writeFileSync(progFile, PROG)
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', String(COLS), '-y', String(ROWS))

  const chunks: Buffer[] = []
  const viewer: Viewer = { send: (d) => { chunks.push(Buffer.from(d)) } }
  superviseBridges(250)
  if (!attachViewer(SESSION, viewer, { cols: COLS, rows: ROWS })) throw new Error('attachViewer failed')
  await sleep(500)
  await tmux('send-keys', '-t', SESSION, '-l', `node ${progFile}`); await tmux('send-keys', '-t', SESSION, 'Enter')
  await sleep(1500)   // several live redraws

  const helper = helperPid()
  if (!helper) throw new Error('helper did not start')
  process.kill(helper, 'SIGKILL')
  await sleep(2500)

  detachViewer(SESSION, viewer)
  await tmux('kill-session', '-t', SESSION).catch(() => {})

  const screen = emulate(Buffer.concat(chunks), COLS, ROWS)
  const markerRows = screen.filter((l) => l.includes(MARKER))
  console.log('final emulated screen (last 8 rows):')
  for (const l of screen.slice(-8)) console.log('   | ' + l)
  console.log(`marker rows on screen: ${markerRows.length}`)
  if (markerRows.length === 0) { console.error('INCONCLUSIVE: the box never reached the final view'); process.exit(2) }
  if (markerRows.length > 1) { console.error(`FAIL: a bare re-seed doubled the redraw — ${markerRows.length} copies of the marker (bottom garbled, no scroll needed)`); process.exit(1) }
  console.log('PASS: a reconnect-style re-seed did not double the redraw — the cursor was restored, so the relative redraw stayed coherent')
  process.exit(0)
}
main().catch((e) => { console.error('ERROR', e); process.exit(1) })
