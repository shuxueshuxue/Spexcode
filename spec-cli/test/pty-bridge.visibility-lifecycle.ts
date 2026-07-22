// Hidden sockets are the lightweight prewarm boundary: they keep their subscription but own no PTY, pixels,
// or tmux geometry. Visible viewers share the smallest grid that fits all of them; hiding the last arms one
// bounded linger — the helper survives the window streaming to the lingering subscription only, a return
// claim inside it at the unchanged grid resumes the same helper with no repaint, and a window with no
// visible claim releases the helper.
//
// Run: SPEXCODE_TMUX=visibility-<pid> npx tsx test/pty-bridge.visibility-lifecycle.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Viewer } from '../src/pty-bridge.js'

// The linger window must be short enough to observe release; set before the module reads it.
process.env.SPEXCODE_TERM_LINGER_MS ||= '700'
const LINGER = Number(process.env.SPEXCODE_TERM_LINGER_MS)
const { attachViewer, detachViewer, forwardInput, hideViewer, resizeBridge } = await import('../src/pty-bridge.js')

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

    if (forwardInput(SESSION, widerViewer, 'hidden-must-not-land')) {
      throw new Error('hidden viewer was allowed to inject terminal input')
    }
    if (!forwardInput(SESSION, viewer, 'printf native-input-789\r')) {
      throw new Error('visible viewer terminal input was refused')
    }
    await waitFor(pane, (value) => value.includes('native-input-789'), 'native viewer input')

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

    // Hiding the limiting viewer expands the shared grid. The grid change also drops the hidden viewer's
    // linger: its buffer is no longer the stream's shape, so it must fall back to an ordinary hidden cache.
    hideViewer(SESSION, viewer)
    if (forwardInput(SESSION, viewer, 'hidden-after-resize')) {
      throw new Error('hidden viewer injected after withdrawing visibility')
    }
    const expandedClients = await waitFor(
      clients,
      (value) => !!value[0]?.endsWith(`|${SECOND.cols}x${SECOND.rows}`),
      'remaining wider viewer expansion',
    )
    if (!expandedClients[0]?.startsWith(`${firstPid}|`)) {
      throw new Error('size arbitration replaced the helper instead of resizing it')
    }
    await sleep(500)   // let the expansion's delivery boundary close so the linger checks below see steady state

    // Hiding the LAST visible viewer lingers instead of releasing: same helper pid, still attached.
    hideViewer(SESSION, widerViewer)
    await sleep(Math.min(300, LINGER / 2))
    const lingerClients = await clients()
    if (lingerClients.length !== 1 || !lingerClients[0]?.startsWith(`${firstPid}|`)) {
      throw new Error(`last hide released the helper instead of lingering (${lingerClients.join(', ')})`)
    }

    // During the window the lingering subscription keeps consuming the stream; the grid-dropped hidden
    // viewer receives nothing.
    chunks.length = 0
    const widerBeforeOutput = widerChunks.length
    await tmux('send-keys', '-t', SESSION, 'printf linger-flow-123', 'Enter')
    await waitFor(async () => widerChunks.length, (value) => value > widerBeforeOutput, 'lingering subscription stream')
    if (chunks.length) throw new Error('grid-dropped hidden viewer received lingered output')

    // A return claim inside the window at the unchanged grid resumes the same helper with NO repaint:
    // no new resize-commit transaction, and the stream simply continues.
    const widerEventsBeforeReturn = widerEvents.filter((event) => event.startsWith('commit:')).length
    resizeBridge(SESSION, widerViewer, SECOND.cols, SECOND.rows)
    await sleep(600)
    const resumedClients = await clients()
    if (resumedClients.length !== 1 || !resumedClients[0]?.startsWith(`${firstPid}|`)) {
      throw new Error(`seamless return did not keep the lingering helper (${resumedClients.join(', ')})`)
    }
    const widerCommitsAfterReturn = widerEvents.filter((event) => event.startsWith('commit:')).length
    if (widerCommitsAfterReturn !== widerEventsBeforeReturn) {
      throw new Error('seamless return repainted: a resize-commit transaction replaced a current buffer')
    }
    const widerBeforeResume = widerChunks.length
    await tmux('send-keys', '-t', SESSION, 'printf resume-flow-456', 'Enter')
    await waitFor(async () => widerChunks.length, (value) => value > widerBeforeResume, 'resumed visible stream')

    // A window with no visible claim releases the helper — the linger is bounded, not immortal.
    hideViewer(SESSION, widerViewer)
    await waitFor(clients, (value) => value.length === 0, 'bounded linger release', LINGER + 4000)
    chunks.length = 0

    resizeBridge(SESSION, viewer, SECOND.cols, SECOND.rows)
    const secondClients = await waitFor(clients, (value) => value.length === 1, 'helper reattach')
    await waitFor(async () => chunks.length, (value) => value > 0, 'reattached native frame')
    const secondRaw = secondClients[0]
    if (!secondRaw || secondRaw.startsWith(`${firstPid}|`) || !secondRaw.endsWith(`|${SECOND.cols}x${SECOND.rows}`)) {
      throw new Error(`visibility did not create a fresh measured helper (${secondClients.join(', ')})`)
    }

    console.log(`PASS: hidden sockets held 0 clients and could not inject; visible xterm input reached the pane; joining viewer committed ${FIRST.cols}x${FIRST.rows} before refresh; shared helper expanded to ${SECOND.cols}x${SECOND.rows}; last hide lingered pid ${firstPid} (streaming to the lingering sub only), seamless return resumed it with no repaint, the ${LINGER}ms window released it, then reattached as ${secondRaw.split('|')[0]}`)
  } finally {
    detachViewer(SESSION, viewer)
    detachViewer(SESSION, widerViewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
