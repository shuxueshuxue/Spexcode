// A hidden viewer in a second backend instance stays warm, but its native helper and pipe observer are both
// ignore-size, so they cannot collapse the geometry watched through the first backend.
//
// Run: SPEXCODE_TMUX=foreign-$$ npx tsx test/pty-bridge.foreign-instance.ts
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `foreign-${process.pid}`
const SESSION = 'foreign-instance'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])
const windowSize = async () => (await tmux('display-message', '-p', '-t', SESSION, '#{window_width}x#{window_height}')).stdout.trim()

if (process.argv[2] === 'foreign') {
  const hidden: Viewer = { send: () => {} }
  if (!attachViewer(SESSION, hidden)) throw new Error('foreign attachViewer failed')
  process.stdout.write('READY\n')
  setInterval(() => {}, 60_000)
} else {
  await main()
}

async function main(): Promise<void> {
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '200', '-y', '50')

  const viewer: Viewer = { send: () => {} }
  if (!attachViewer(SESSION, viewer, { cols: 221, rows: 63 })) throw new Error('attachViewer failed')
  await sleep(800)

  const foreign = spawn(process.execPath, ['--import', 'tsx', process.argv[1], 'foreign'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, SPEXCODE_TMUX: SOCK },
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('foreign process did not start')), 10_000)
      foreign.stdout.on('data', (data) => {
        if (!String(data).includes('READY')) return
        clearTimeout(timer)
        resolve()
      })
    })
    await sleep(300)

    resizeBridge(SESSION, viewer, 220, 63)
    await sleep(500)
    resizeBridge(SESSION, viewer, 219, 63)
    await sleep(800)

    const final = await windowSize()
    const { stdout: clients } = await tmux('list-clients', '-t', SESSION, '-F', '#{client_flags}|#{client_width}x#{client_height}')
    const clientLines = clients.trim().split('\n').filter(Boolean)
    const clientCount = clientLines.length
    const neutralCount = clientLines.filter((line) => line.includes('ignore-size')).length
    const visibleSize = clientLines.some((line) => line.endsWith('|219x63'))
    console.log(`watched window after foreign hidden viewer: ${final}`)
    console.log(`tmux clients: ${clientCount} (${clients.trim()})`)
    if (!visibleSize || clientCount !== 4 || neutralCount !== 3) {
      throw new Error(`hidden foreign helper was not size-neutral (window=${final}, clients=${clientCount}, neutral=${neutralCount})`)
    }
    console.log('PASS: foreign helper stayed warm but ignore-size neutral; the visible client kept 219x63')
  } finally {
    foreign.kill()
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}
