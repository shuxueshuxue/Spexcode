// A lone hidden dashboard is the warm size owner: it prepares the pane at final panel geometry before the
// click. Activation flips visibility without attaching or replaying the pane. A foreign-owner case lives in
// pty-bridge.foreign-instance.ts.
//
// Run: SPEXCODE_TMUX=prewarm-<pid> npx tsx test/pty-bridge.prewarm.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, resizeBridge, setViewerVisible, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `prewarm-${process.pid}`
const SESSION = 'prewarm'
const SIZE = { cols: 160, rows: 48 }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

async function clients(): Promise<string[]> {
  const { stdout } = await tmux('list-clients', '-t', SESSION, '-F', '#{client_pid}|#{client_flags}|#{client_width}x#{client_height}')
  return stdout.trim().split('\n').filter(Boolean)
}

async function waitForRawClient(timeout = 5000): Promise<string[]> {
  const deadline = Date.now() + timeout
  for (;;) {
    const current = await clients()
    if (current.some((line) => !line.includes('control-mode'))) return current
    if (Date.now() >= deadline) return current
    await sleep(50)
  }
}

async function main(): Promise<void> {
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24')

  const chunks: Buffer[] = []
  const viewer: Viewer = { send: (data) => chunks.push(Buffer.from(data)) }
  try {
    if (!attachViewer(SESSION, viewer, SIZE, false)) throw new Error('hidden attach failed')
    const before = await waitForRawClient()
    const raw = before.find((line) => !line.includes('control-mode'))
    const windowSize = (await tmux('display-message', '-p', '-t', SESSION, '#{window_width}x#{window_height}')).stdout.trim()
    if (!raw || raw.includes('ignore-size') || !raw.endsWith(`|${SIZE.cols}x${SIZE.rows}`)) {
      throw new Error(`lone warm helper did not own final geometry (${before.join(', ')})`)
    }
    if (windowSize !== `${SIZE.cols}x${SIZE.rows - 1}`) throw new Error(`pane was not pre-sized (${windowSize})`)
    const rawPid = raw.split('|')[0]

    chunks.length = 0
    resizeBridge(SESSION, viewer, SIZE.cols, SIZE.rows)
    await sleep(600)
    const after = await clients()
    const activatedRaw = after.find((line) => !line.includes('control-mode'))
    const activation = Buffer.concat(chunks)
    if (!activatedRaw?.startsWith(`${rawPid}|`)) throw new Error('activation replaced the warm native client')
    if (activation.length >= 4096 || activation.includes(Buffer.from('\x1b[H\x1b[2J'))) {
      throw new Error(`activation replayed the pane (${activation.length} bytes)`)
    }

    setViewerVisible(SESSION, viewer, false)
    await sleep(300)
    const hiddenAgain = (await clients()).find((line) => !line.includes('control-mode'))
    if (!hiddenAgain || hiddenAgain.includes('ignore-size')) throw new Error('the elected warm owner dropped its pre-sized geometry')
    console.log(`PASS: hidden prewarm owned ${windowSize}; activation kept client ${rawPid} and sent ${activation.length} status bytes`)
  } finally {
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
