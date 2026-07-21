// A hidden viewer in a second backend instance owns no helper at all, so it cannot collapse the geometry
// watched through the visible backend.
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
  attachViewer(SESSION, hidden)
  process.stdout.write('READY\n')
  setInterval(() => {}, 60_000)
} else {
  await main()
}

async function main(): Promise<void> {
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '200', '-y', '50')

  const viewer: Viewer = { send: () => {} }
  attachViewer(SESSION, viewer)
  resizeBridge(SESSION, viewer, 221, 63)
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
    if (!visibleSize || clientCount !== 1 || neutralCount !== 0) {
      throw new Error(`hidden foreign subscription created a client (window=${final}, clients=${clientCount}, neutral=${neutralCount})`)
    }
    console.log('PASS: foreign hidden subscription held no PTY; only the visible native client existed')
  } finally {
    foreign.kill()
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}
