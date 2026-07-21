// Hidden sockets are the lightweight prewarm boundary: they keep their subscription but own no PTY, pixels,
// or tmux geometry. Visible viewers share the smallest grid that fits all of them; hiding the last releases it.
//
// Run: SPEXCODE_TMUX=visibility-<pid> npx tsx test/pty-bridge.visibility-lifecycle.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, hideViewer, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `visibility-${process.pid}`
const SESSION = 'visibility-lifecycle'
const FIRST = { cols: 132, rows: 41 }
const SECOND = { cols: 144, rows: 44 }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

async function clients(): Promise<string[]> {
  try {
    const { stdout } = await tmux('list-clients', '-t', SESSION, '-F', '#{client_pid}|#{client_flags}|#{client_width}x#{client_height}')
    return stdout.trim().split('\n').filter(Boolean)
  } catch { return [] }
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

async function main(): Promise<void> {
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24')

  const chunks: Buffer[] = []
  const commits: string[] = []
  const viewer: Viewer = {
    send: (data) => chunks.push(Buffer.from(data)),
    commitSize: (cols, rows) => commits.push(`${cols}x${rows}`),
  }
  const widerChunks: Buffer[] = []
  const widerEvents: string[] = []
  const widerViewer: Viewer = {
    send: (data) => { widerChunks.push(Buffer.from(data)); widerEvents.push(`frame:${data.length}`) },
    commitSize: (cols, rows) => widerEvents.push(`commit:${cols}x${rows}`),
  }
  try {
    attachViewer(SESSION, viewer)
    attachViewer(SESSION, widerViewer)
    await sleep(250)
    const hiddenClients = await clients()
    const hiddenWindow = (await tmux('display-message', '-p', '-t', SESSION, '#{window_width}x#{window_height}')).stdout.trim()
    if (hiddenClients.length) throw new Error(`hidden subscription created tmux clients (${hiddenClients.join(', ')})`)
    if (hiddenWindow !== '80x24') throw new Error(`hidden subscription changed geometry (${hiddenWindow})`)

    resizeBridge(SESSION, viewer, FIRST.cols, FIRST.rows)
    const firstClients = await waitFor(clients, (value) => value.length === 1, 'visible helper')
    await waitFor(async () => chunks.length, (value) => value > 0, 'first native frame')
    const firstRaw = firstClients[0]
    if (!firstRaw || firstRaw.includes('ignore-size') || !firstRaw.endsWith(`|${FIRST.cols}x${FIRST.rows}`)) {
      throw new Error(`visible helper did not own measured geometry (${firstClients.join(', ')})`)
    }
    const firstPid = firstRaw.split('|')[0]

    resizeBridge(SESSION, widerViewer, SECOND.cols, SECOND.rows)
    const sharedClients = await waitFor(clients, (value) => value.length === 1, 'shared visible helper')
    await waitFor(async () => widerChunks.length, (value) => value > 0, 'wider viewer shared-grid refresh')
    const sharedRaw = sharedClients[0]
    if (!sharedRaw?.endsWith(`|${FIRST.cols}x${FIRST.rows}`)) {
      throw new Error(`wider viewer enlarged the shared grid beyond its narrower peer (${sharedClients.join(', ')})`)
    }
    if (widerEvents[0] !== `commit:${FIRST.cols}x${FIRST.rows}` || !widerEvents[1]?.startsWith('frame:')) {
      throw new Error(`joining viewer did not receive shared grid commit immediately before refresh (${widerEvents.join(', ')})`)
    }

    hideViewer(SESSION, viewer)
    const expandedClients = await waitFor(
      clients,
      (value) => !!value[0]?.endsWith(`|${SECOND.cols}x${SECOND.rows}`),
      'remaining wider viewer expansion',
    )
    if (!expandedClients[0]?.startsWith(`${firstPid}|`)) {
      throw new Error('size arbitration replaced the helper instead of resizing it')
    }
    hideViewer(SESSION, widerViewer)
    await waitFor(clients, (value) => value.length === 0, 'helper release')
    chunks.length = 0

    resizeBridge(SESSION, viewer, SECOND.cols, SECOND.rows)
    const secondClients = await waitFor(clients, (value) => value.length === 1, 'helper reattach')
    await waitFor(async () => chunks.length, (value) => value > 0, 'reattached native frame')
    const secondRaw = secondClients[0]
    if (!secondRaw || secondRaw.startsWith(`${firstPid}|`) || !secondRaw.endsWith(`|${SECOND.cols}x${SECOND.rows}`)) {
      throw new Error(`visibility did not create a fresh measured helper (${secondClients.join(', ')})`)
    }

    console.log(`PASS: hidden sockets held 0 clients; joining viewer committed ${FIRST.cols}x${FIRST.rows} before refresh; shared helper expanded to ${SECOND.cols}x${SECOND.rows}, then reattached as ${secondRaw.split('|')[0]}`)
  } finally {
    detachViewer(SESSION, viewer)
    detachViewer(SESSION, widerViewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
