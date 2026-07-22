// Each visible browser viewer is one native tmux client. Hidden sockets own none; hiding lingers only that
// viewer, while socket detach removes it immediately. tmux's largest policy, not bridge size voting, lets a
// large client own the application grid without losing the small client's native viewport.
//
// Run: SPEXCODE_TMUX=visibility-<pid> npx tsx test/pty-bridge.visibility-lifecycle.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Viewer } from '../src/pty-bridge.js'

process.env.SPEXCODE_TERM_LINGER_MS ||= '700'
const LINGER = Number(process.env.SPEXCODE_TERM_LINGER_MS)
const { attachViewer, detachViewer, forwardInput, hideViewer, resizeBridge } = await import('../src/pty-bridge.js')

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `visibility-${process.pid}`
const SESSION = 'visibility-lifecycle'
const SMALL = { cols: 96, rows: 29 }
const LARGE = { cols: 144, rows: 44 }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

async function clients(): Promise<string[]> {
  try {
    const { stdout } = await tmux('list-clients', '-t', SESSION, '-F', '#{client_pid}|#{client_flags}|#{client_width}x#{client_height}')
    return stdout.trim().split('\n').filter(Boolean)
  } catch { return [] }
}

async function windowSize(): Promise<string> {
  try { return (await tmux('display-message', '-p', '-t', SESSION, '#{window_width}x#{window_height}')).stdout.trim() } catch { return '' }
}

async function windowPolicy(): Promise<string> {
  try { return (await tmux('show-window-options', '-v', '-t', SESSION, 'window-size')).stdout.trim() } catch { return '' }
}

async function pane(): Promise<string> {
  try { return (await tmux('capture-pane', '-p', '-t', SESSION)).stdout } catch { return '' }
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeout = 5000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(25)
  }
}

function pidForSize(rows: string[], size: { cols: number; rows: number }): string | undefined {
  return rows.find((row) => row.endsWith(`|${size.cols}x${size.rows}`))?.split('|')[0]
}

async function main(): Promise<void> {
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24')

  const smallChunks: Buffer[] = []
  const smallEvents: string[] = []
  const smallViewer: Viewer = {
    send: (data) => { smallChunks.push(Buffer.from(data)); smallEvents.push(`frame:${data.length}`) },
    commitSize: (cols, rows) => smallEvents.push(`commit:${cols}x${rows}`),
  }
  const largeChunks: Buffer[] = []
  const largeEvents: string[] = []
  const largeViewer: Viewer = {
    send: (data) => { largeChunks.push(Buffer.from(data)); largeEvents.push(`frame:${data.length}`) },
    commitSize: (cols, rows) => largeEvents.push(`commit:${cols}x${rows}`),
  }

  try {
    attachViewer(SESSION, smallViewer)
    attachViewer(SESSION, largeViewer)
    await sleep(250)
    if ((await clients()).length) throw new Error('hidden subscriptions created tmux clients')
    if (await windowSize() !== '80x24') throw new Error(`hidden subscriptions changed geometry (${await windowSize()})`)

    resizeBridge(SESSION, smallViewer, SMALL.cols, SMALL.rows)
    const firstClients = await waitFor(clients, (value) => value.length === 1 && !!pidForSize(value, SMALL), 'small native client')
    await waitFor(async () => smallChunks.length, (value) => value > 0, 'small initial repaint')
    const smallPid = pidForSize(firstClients, SMALL)
    if (!smallPid) throw new Error(`small client did not own ${SMALL.cols}x${SMALL.rows}`)
    if (smallEvents[0] !== `commit:${SMALL.cols}x${SMALL.rows}` || !smallEvents[1]?.startsWith('frame:')) {
      throw new Error(`small viewer did not receive commit before repaint (${smallEvents.join(', ')})`)
    }
    if (forwardInput(SESSION, largeViewer, 'hidden-must-not-land')) throw new Error('hidden viewer injected input')
    if (!forwardInput(SESSION, smallViewer, 'printf native-input-789\r')) throw new Error('visible viewer input was refused')
    await waitFor(pane, (value) => value.includes('native-input-789'), 'small viewer input')

    resizeBridge(SESSION, largeViewer, LARGE.cols, LARGE.rows)
    const pairedClients = await waitFor(
      clients,
      (value) => value.length === 2 && !!pidForSize(value, SMALL) && !!pidForSize(value, LARGE),
      'independent small and large clients',
    )
    await waitFor(async () => largeChunks.length, (value) => value > 0, 'large initial repaint')
    const largePid = pidForSize(pairedClients, LARGE)
    if (!largePid || largePid === smallPid) throw new Error(`viewers shared one client (${pairedClients.join(', ')})`)
    if (await windowPolicy() !== 'largest') throw new Error(`window did not use tmux largest policy (${await windowPolicy()})`)
    await waitFor(windowSize, (value) => value === `${LARGE.cols}x${LARGE.rows}`, 'large client owning window')
    if (largeEvents[0] !== `commit:${LARGE.cols}x${LARGE.rows}` || !largeEvents[1]?.startsWith('frame:')) {
      throw new Error(`large viewer did not receive its own commit before repaint (${largeEvents.join(', ')})`)
    }

    // A dead browser bypasses linger: its exact native client disappears and tmux recomputes from the peer.
    const detachedAt = Date.now()
    detachViewer(SESSION, largeViewer)
    const afterLargeDetach = await waitFor(clients, (value) => value.length === 1 && !!pidForSize(value, SMALL), 'large socket detach')
    if (Date.now() - detachedAt >= LINGER) throw new Error('dead socket incorrectly waited for hidden-tab linger')
    if (afterLargeDetach[0]?.startsWith(`${largePid}|`)) throw new Error('large viewer left a ghost client')
    await waitFor(windowSize, (value) => value === `${SMALL.cols}x${SMALL.rows}`, 'tmux recompute after large detach')

    // A live but hidden tab keeps only its own client for the bounded continuity window.
    hideViewer(SESSION, smallViewer)
    if (forwardInput(SESSION, smallViewer, 'hidden-after-hide')) throw new Error('hidden viewer injected input')
    await sleep(Math.min(300, LINGER / 2))
    const lingeringClients = await clients()
    if (lingeringClients.length !== 1 || !lingeringClients[0]?.startsWith(`${smallPid}|`)) {
      throw new Error(`hidden viewer did not retain its own client during linger (${lingeringClients.join(', ')})`)
    }
    const chunksBefore = smallChunks.length
    await tmux('send-keys', '-t', SESSION, 'printf linger-flow-123', 'Enter')
    await waitFor(async () => smallChunks.length, (value) => value > chunksBefore, 'lingering viewer stream')

    const commitsBeforeReturn = smallEvents.filter((event) => event.startsWith('commit:')).length
    resizeBridge(SESSION, smallViewer, SMALL.cols, SMALL.rows)
    await sleep(500)
    const resumed = await clients()
    if (resumed.length !== 1 || !resumed[0]?.startsWith(`${smallPid}|`)) throw new Error('unchanged return replaced the client')
    if (smallEvents.filter((event) => event.startsWith('commit:')).length !== commitsBeforeReturn) {
      throw new Error('unchanged return repainted a continuously streamed buffer')
    }

    hideViewer(SESSION, smallViewer)
    await waitFor(clients, (value) => value.length === 0, 'bounded per-viewer release', LINGER + 4000)
    resizeBridge(SESSION, smallViewer, LARGE.cols, LARGE.rows)
    const restored = await waitFor(clients, (value) => value.length === 1 && !!pidForSize(value, LARGE), 'fresh client after linger')
    const restoredPid = pidForSize(restored, LARGE)
    if (!restoredPid || restoredPid === smallPid) throw new Error('expired viewer reused a dead client')

    detachViewer(SESSION, smallViewer)
    await waitFor(clients, (value) => value.length === 0, 'final immediate socket detach')
    console.log(`PASS: hidden sockets held 0 clients; visible viewers owned native clients ${smallPid}/${largePid}; largest selected ${LARGE.cols}x${LARGE.rows}; large detach immediately recomputed ${SMALL.cols}x${SMALL.rows}; small hide lingered only ${smallPid}, resumed continuously, expired, and reattached as ${restoredPid}`)
  } finally {
    detachViewer(SESSION, smallViewer)
    detachViewer(SESSION, largeViewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
