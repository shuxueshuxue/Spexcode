// Multi-instance size-neutrality proof for live-view: TWO real bridge instances (separate processes =
// separate backend instances, e.g. the deploy and a worktree's test `spex serve`) share one tmux socket.
// Instance A has a SIZED viewer (the human's browser); instance B holds only a HIDDEN viewer (a board-load
// connect that never sized its pane — what a dashboard open drives for every session). A layout event makes
// B's bridge repaint and send `refresh-client -C` at its own cold size — the multi-instance shrink that hit
// the live deploy (watched terminals collapsing to the foreign instance's 120x40).
//
// PASS = the watched window stays at A's viewer size: a bridge with no sized viewer is size-NEUTRAL (its
// client carries tmux's ignore-size flag, so its -C cannot move the window while a sized viewer votes).
// FAIL (the pre-fix behaviour) = the window ends at B's cold default and A's repaint cannot reclaim it
// (its -C is a same-client-size no-op).
//
// Run (from spec-cli/): SPEXCODE_TMUX=foreign-$$ npx tsx test/pty-bridge.foreign-instance.ts
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { attachViewer, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
const SESSION = 'foreign-instance'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])
const windowSize = async () => (await tmux('display-message', '-p', '-t', SESSION, '#{window_width}x#{window_height}')).stdout.trim()

// child role: instance B — a foreign backend whose only viewer is HIDDEN (board-load connect, no size).
// Its bridge spawns at the cold default and must never move the shared window.
if (process.argv[2] === 'foreign') {
  const hidden: Viewer = { send: () => {} }
  if (!attachViewer(SESSION, hidden)) throw new Error('foreign attachViewer failed')
  setInterval(() => {}, 60_000)   // stay attached until killed
} else {
  await main()
}

async function main() {
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '200', '-y', '50')

  // instance A: the watched side — a real sized viewer.
  const viewer: Viewer = { send: () => {} }
  if (!attachViewer(SESSION, viewer, { cols: 221, rows: 63 })) throw new Error('attachViewer failed')
  await sleep(800)
  const watched = await windowSize()

  // instance B: a separate process running the same bridge code, hidden viewer only.
  const foreign = spawn(process.execPath, ['--import', 'tsx', process.argv[1], 'foreign'], {
    stdio: 'inherit',
    env: { ...process.env, SPEXCODE_TMUX: SOCK },
  })
  const deadline = Date.now() + 10_000
  for (;;) {
    const { stdout } = await tmux('list-clients', '-t', SESSION, '-F', 'x')
    if (stdout.trim().split('\n').filter(Boolean).length >= 2) break
    if (Date.now() > deadline) throw new Error('foreign client never attached')
    await sleep(200)
  }
  await sleep(500)

  // two layout events (the first only primes the foreign bridge's lastLayout; the second is the
  // unsolicited change that makes it repaint — and, pre-fix, assert its own cold size).
  resizeBridge(SESSION, 220, 63)
  await sleep(800)
  resizeBridge(SESSION, 219, 63)
  await sleep(1500)

  const final = await windowSize()
  const { stdout: clients } = await tmux('list-clients', '-t', SESSION, '-F', '#{client_flags} #{client_width}x#{client_height}')
  foreign.kill()
  await tmux('kill-session', '-t', SESSION).catch(() => {})

  console.log(`watched window: ${watched} -> after foreign instance events: ${final}`)
  console.log(`clients:\n${clients.trim()}`)
  if (final === '219x63') {
    console.log('PASS — the sized viewer kept the window; the foreign viewer-less bridge stayed size-neutral')
    process.exit(0)
  }
  console.log(`FAIL — foreign viewer-less bridge moved the watched window to ${final}`)
  process.exit(1)
}
