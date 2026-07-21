// Hidden sockets are the lightweight prewarm boundary: they keep their subscription but own no PTY, pixels,
// or tmux geometry. Visibility creates one native helper and hiding the last viewer releases it again.
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
  const viewer: Viewer = { send: (data) => chunks.push(Buffer.from(data)) }
  try {
    attachViewer(SESSION, viewer)
    await sleep(250)
    const hiddenClients = await clients()
    const hiddenWindow = (await tmux('display-message', '-p', '-t', SESSION, '#{window_width}x#{window_height}')).stdout.trim()
    if (hiddenClients.length) throw new Error(`hidden subscription created tmux clients (${hiddenClients.join(', ')})`)
    if (hiddenWindow !== '80x24') throw new Error(`hidden subscription changed geometry (${hiddenWindow})`)

    resizeBridge(SESSION, viewer, FIRST.cols, FIRST.rows)
    const firstClients = await waitFor(clients, (value) => value.length === 2 && value.some((line) => !line.includes('control-mode')), 'visible helper')
    await waitFor(async () => chunks.length, (value) => value > 0, 'first native frame')
    const firstRaw = firstClients.find((line) => !line.includes('control-mode'))
    if (!firstRaw || firstRaw.includes('ignore-size') || !firstRaw.endsWith(`|${FIRST.cols}x${FIRST.rows}`)) {
      throw new Error(`visible helper did not own measured geometry (${firstClients.join(', ')})`)
    }
    const firstPid = firstRaw.split('|')[0]

    hideViewer(SESSION, viewer)
    await waitFor(clients, (value) => value.length === 0, 'helper release')
    chunks.length = 0

    resizeBridge(SESSION, viewer, SECOND.cols, SECOND.rows)
    const secondClients = await waitFor(clients, (value) => value.length === 2 && value.some((line) => !line.includes('control-mode')), 'helper reattach')
    await waitFor(async () => chunks.length, (value) => value > 0, 'reattached native frame')
    const secondRaw = secondClients.find((line) => !line.includes('control-mode'))
    if (!secondRaw || secondRaw.startsWith(`${firstPid}|`) || !secondRaw.endsWith(`|${SECOND.cols}x${SECOND.rows}`)) {
      throw new Error(`visibility did not create a fresh measured helper (${secondClients.join(', ')})`)
    }

    console.log(`PASS: hidden socket held 0 clients at ${hiddenWindow}; visible helper ${firstPid} was released and reattached as ${secondRaw.split('|')[0]}`)
  } finally {
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
