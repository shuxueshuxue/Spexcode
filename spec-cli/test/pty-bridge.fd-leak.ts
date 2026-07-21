// Linux proof for helper-per-PTY isolation. The backend must own no master, each helper exactly its own, and
// no tmux client may inherit a sibling's master. Killing one helper must not wedge the shared tmux server;
// its one native client is restored without involving sibling sessions.
//
// Run: SPEXCODE_TMUX=fdleak-$$ npx tsx test/pty-bridge.fd-leak.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdirSync, readlinkSync, readFileSync } from 'node:fs'
import { attachViewer, detachViewer, resizeBridge, superviseBridges, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `fdleak-${process.pid}`
const SESSIONS = ['fd-a', 'fd-b', 'fd-c', 'fd-d']
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

function fds(pid: number): { fd: number; target: string; ttyIndex?: number }[] {
  return readdirSync(`/proc/${pid}/fd`).map((raw) => {
    const path = `/proc/${pid}/fd/${raw}`
    let target = '?', ttyIndex: number | undefined
    try {
      target = readlinkSync(path)
      const match = readFileSync(`/proc/${pid}/fdinfo/${raw}`, 'utf8').match(/^tty-index:\s*(\d+)$/m)
      if (match) ttyIndex = Number(match[1])
    } catch { /* raced away */ }
    return { fd: Number(raw), target, ttyIndex }
  })
}

function childPids(pid: number): number[] {
  const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim()
  return children ? children.split(/\s+/).map(Number) : []
}

function cmdline(pid: number): string {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8') } catch { return '' }
}

async function clientPids(): Promise<number[]> {
  const found = new Set<number>()
  for (const session of SESSIONS) {
    const { stdout } = await tmux('list-clients', '-t', session, '-F', '#{client_pid}')
    for (const line of stdout.split('\n')) {
      const pid = Number(line.trim())
      if (pid > 0) found.add(pid)
    }
  }
  return [...found]
}

async function waitForClientCount(count: number, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  for (;;) {
    if ((await clientPids()).length === count) return
    if (Date.now() > deadline) throw new Error(`client count did not reach ${count}`)
    await sleep(50)
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'linux') { console.log('SKIP: /proc fd measurement is Linux-only'); return }
  for (const session of SESSIONS) {
    await tmux('kill-session', '-t', session).catch(() => {})
    await tmux('new-session', '-d', '-s', session, '-x', '80', '-y', '24')
  }

  superviseBridges(250)
  const viewers: Viewer[] = []
  try {
    for (const session of SESSIONS) {
      const viewer: Viewer = { send: () => {} }
      viewers.push(viewer)
      attachViewer(session, viewer)
      resizeBridge(session, viewer, 80, 24)
    }
    await waitForClientCount(SESSIONS.length)

    const helpers = childPids(process.pid).filter((pid) => cmdline(pid).includes('pty-helper.mjs'))
    const clients = await clientPids()
    const backendMasters = fds(process.pid).filter((entry) => entry.target.includes('ptmx'))
    const helperMasters = helpers.map((pid) => ({ pid, masters: fds(pid).filter((entry) => entry.target.includes('ptmx')) }))
    const clientMasters = clients.map((pid) => ({ pid, masters: fds(pid).filter((entry) => entry.target.includes('ptmx')) }))
    const ttyIndexes = helperMasters.flatMap((entry) => entry.masters.map((master) => master.ttyIndex))

    console.log(`backend masters: ${backendMasters.length}`)
    console.log(`helpers: ${helperMasters.map((entry) => `${entry.pid}:${entry.masters.length}`).join(' ')}`)
    console.log(`tmux client masters: ${clientMasters.map((entry) => `${entry.pid}:${entry.masters.length}`).join(' ')}`)
    if (helpers.length !== SESSIONS.length) throw new Error(`expected ${SESSIONS.length} helpers, saw ${helpers.length}`)
    if (backendMasters.length !== 0) throw new Error('backend owns a PTY master')
    if (helperMasters.some((entry) => entry.masters.length !== 1)) throw new Error('a helper does not own exactly one master')
    if (ttyIndexes.some((index) => index === undefined) || new Set(ttyIndexes).size !== ttyIndexes.length) {
      throw new Error(`helpers do not own distinct PTYs (${ttyIndexes.join(',')})`)
    }
    if (clientMasters.some((entry) => entry.masters.length !== 0)) throw new Error('tmux client inherited a PTY master')

    process.kill(helpers[0], 'SIGKILL')
    await waitForClientCount(SESSIONS.length - 1)
    const probe = await tmux('display-message', '-p', '-t', SESSIONS[1], 'server-responsive')
    if (probe.stdout.trim() !== 'server-responsive') throw new Error('shared tmux server wedged after helper death')
    await waitForClientCount(SESSIONS.length, 8000)
    console.log('PASS: PTY masters are isolated; one helper death neither wedges siblings nor breaks restoration')
  } finally {
    for (const [index, session] of SESSIONS.entries()) detachViewer(session, viewers[index])
    await sleep(300)
    await tmux('kill-server').catch(() => {})
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
