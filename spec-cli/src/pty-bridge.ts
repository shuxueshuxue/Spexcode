import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { alive } from './sessions.js'

const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
const HELPER = fileURLToPath(new URL('./pty-helper.mjs', import.meta.url))

export type Viewer = {
  send: (data: Buffer) => void
  commitSize?: (cols: number, rows: number) => void
}

type Subscription = {
  visible: boolean
  lingering: boolean
  cols: number
  rows: number
  bridge?: Bridge
  lingerTimer?: ReturnType<typeof setTimeout>
  restoreTimer?: ReturnType<typeof setTimeout>
}

type Bridge = {
  id: string
  viewer: Viewer
  proc: ChildProcessWithoutNullStreams
  cols: number
  rows: number
  ptyPid?: number
  stderr: string
  clientTty?: string
  delivery: 'stream' | 'initial' | 'quarantine'
  refreshBuf: Buffer
  refreshPending: boolean
  refreshRunning: boolean
  refreshOffset?: number
  deliveryTimer?: ReturnType<typeof setTimeout>
}

const subscribers = new Map<string, Map<Viewer, Subscription>>()
const BSU = Buffer.from('\x1b[?2026h')
const ESU = Buffer.from('\x1b[?2026l')
const GEOMETRY_STABILIZATION_MS = 400
// A hidden but still-alive browser keeps its own client briefly so a quick return is continuous. A dead
// socket bypasses this window and detaches immediately.
const LINGER_MS = Number(process.env.SPEXCODE_TERM_LINGER_MS) > 0 ? Number(process.env.SPEXCODE_TERM_LINGER_MS) : 30_000

function subscriptionMap(id: string): Map<Viewer, Subscription> {
  let map = subscribers.get(id)
  if (!map) subscribers.set(id, map = new Map())
  return map
}

function currentSubscription(id: string, viewer: Viewer): Subscription | undefined {
  return subscribers.get(id)?.get(viewer)
}

function isCurrent(bridge: Bridge): boolean {
  return currentSubscription(bridge.id, bridge.viewer)?.bridge === bridge
}

function deliver(bridge: Bridge, data: Buffer): void {
  const subscription = currentSubscription(bridge.id, bridge.viewer)
  if (!subscription || (!subscription.visible && !subscription.lingering)) return
  try { bridge.viewer.send(data) } catch { /* socket close or heartbeat expiry owns removal */ }
}

function commitSize(bridge: Bridge): void {
  const subscription = currentSubscription(bridge.id, bridge.viewer)
  if (!subscription?.visible) return
  try { bridge.viewer.commitSize?.(bridge.cols, bridge.rows) } catch { /* socket close owns removal */ }
}

async function tmux(args: string[]): Promise<string> {
  try {
    const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, ...args])
    return stdout.trim()
  } catch { return '' }
}

function onHelperOutput(bridge: Bridge, chunk: Buffer): void {
  if (!isCurrent(bridge)) return
  if (bridge.delivery === 'stream') {
    deliver(bridge, chunk)
    return
  }
  bridge.refreshBuf = bridge.refreshBuf.length ? Buffer.concat([bridge.refreshBuf, chunk]) : chunk
  releaseInitialRefresh(bridge)
}

function sendControl(bridge: Bridge, message: object): void {
  try { bridge.proc.stdin.write(`${JSON.stringify(message)}\n`) } catch { /* exit recovery owns retry */ }
}

function onHelperStderr(bridge: Bridge, chunk: Buffer): void {
  bridge.stderr += chunk.toString('utf8')
  let newline: number
  while ((newline = bridge.stderr.indexOf('\n')) >= 0) {
    const line = bridge.stderr.slice(0, newline)
    bridge.stderr = bridge.stderr.slice(newline + 1)
    const ready = line.match(/^READY (\d+)$/)
    if (ready) {
      bridge.ptyPid = Number(ready[1])
      if (bridge.delivery === 'initial') {
        armDeliveryBoundary(bridge)
        queueRefresh(bridge)
      }
      continue
    }
    const resized = line.match(/^RESIZED (\d+) (\d+)$/)
    if (resized) {
      if (bridge.delivery === 'initial'
          && Number(resized[1]) === bridge.cols
          && Number(resized[2]) === bridge.rows) {
        queueRefresh(bridge)
      }
    } else if (line) {
      console.error(`[terminal helper ${bridge.id}/${bridge.ptyPid ?? 'starting'}] ${line}`)
    }
  }
}

function ensureBridge(id: string, viewer: Viewer, subscription: Subscription, cols: number, rows: number): { bridge: Bridge | null; created: boolean } {
  if (subscription.bridge) return { bridge: subscription.bridge, created: false }
  let proc: ChildProcessWithoutNullStreams | undefined
  try {
    proc = spawn(process.execPath, [HELPER, id, String(cols), String(rows)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
  } catch {
    try { proc?.kill() } catch { /* spawn did not complete */ }
    return { bridge: null, created: false }
  }
  const bridge: Bridge = {
    id, viewer, proc, cols, rows, stderr: '', delivery: 'initial',
    refreshBuf: Buffer.alloc(0), refreshPending: false, refreshRunning: false,
  }
  subscription.bridge = bridge
  proc.stdout.on('data', (data: Buffer) => onHelperOutput(bridge, data))
  proc.stderr.on('data', (data: Buffer) => onHelperStderr(bridge, data))
  let reaped = false
  const gone = () => {
    if (reaped) return
    reaped = true
    const current = currentSubscription(id, viewer)
    if (current?.bridge !== bridge) return
    current.bridge = undefined
    clearDelivery(bridge)
    try { bridge.proc.kill() } catch { /* already gone */ }
    scheduleRestore(id, viewer, current)
  }
  proc.on('exit', gone)
  proc.on('error', gone)
  return { bridge, created: true }
}

function cancelLinger(subscription: Subscription): void {
  if (subscription.lingerTimer) clearTimeout(subscription.lingerTimer)
  subscription.lingerTimer = undefined
  subscription.lingering = false
}

function cancelRestore(subscription: Subscription): void {
  if (subscription.restoreTimer) clearTimeout(subscription.restoreTimer)
  subscription.restoreTimer = undefined
}

function killBridge(subscription: Subscription): void {
  cancelLinger(subscription)
  cancelRestore(subscription)
  const bridge = subscription.bridge
  if (!bridge) return
  subscription.bridge = undefined
  clearDelivery(bridge)
  try { bridge.proc.stdin.end() } catch { /* already gone */ }
  const kill = setTimeout(() => { try { bridge.proc.kill() } catch { /* already gone */ } }, 250)
  kill.unref()
}

function beginDelivery(bridge: Bridge): void {
  if (bridge.delivery === 'stream') bridge.refreshBuf = Buffer.alloc(0)
  bridge.delivery = 'initial'
  bridge.refreshOffset = undefined
  armDeliveryBoundary(bridge)
}

function armDeliveryBoundary(bridge: Bridge): void {
  if (bridge.deliveryTimer) clearTimeout(bridge.deliveryTimer)
  bridge.deliveryTimer = setTimeout(() => finishDelivery(bridge), GEOMETRY_STABILIZATION_MS)
  bridge.deliveryTimer.unref()
}

function clearDelivery(bridge: Bridge): void {
  bridge.delivery = 'stream'
  if (bridge.deliveryTimer) clearTimeout(bridge.deliveryTimer)
  bridge.deliveryTimer = undefined
  bridge.refreshBuf = Buffer.alloc(0)
  bridge.refreshPending = false
  bridge.refreshOffset = undefined
}

function completeTransactionEnd(buffer: Buffer, offset: number): number | undefined {
  const begin = buffer.indexOf(BSU, offset)
  const end = begin >= 0 ? buffer.indexOf(ESU, begin + BSU.length) : -1
  return end >= 0 ? end + ESU.length : undefined
}

function releaseInitialRefresh(bridge: Bridge): void {
  if (bridge.delivery !== 'initial' || bridge.refreshOffset === undefined) return
  const end = completeTransactionEnd(bridge.refreshBuf, bridge.refreshOffset)
  if (end === undefined) return
  const batch = bridge.refreshBuf.subarray(0, end)
  bridge.refreshBuf = bridge.refreshBuf.subarray(end)
  bridge.delivery = 'quarantine'
  commitSize(bridge)
  if (batch.length) deliver(bridge, batch)
}

function finishDelivery(bridge: Bridge): void {
  if (bridge.delivery === 'stream' || !isCurrent(bridge)) return
  const failOpen = bridge.delivery === 'initial'
  const batch = bridge.refreshBuf
  clearDelivery(bridge)
  if (!failOpen && !batch.length) return
  // The control commit and following binary frame are one browser render transaction, including fail-open.
  commitSize(bridge)
  deliver(bridge, batch)
}

async function refreshBridge(bridge: Bridge): Promise<boolean> {
  if (!isCurrent(bridge) || !bridge.ptyPid) return false
  const tty = await clientTty(bridge)
  if (!tty) return false
  await tmux(['refresh-client', '-t', tty])
  return true
}

function queueRefresh(bridge: Bridge): void {
  if (bridge.delivery !== 'initial') return
  bridge.refreshPending = true
  if (bridge.refreshRunning) return
  bridge.refreshPending = false
  bridge.refreshRunning = true
  void refreshBridge(bridge).then((refreshed) => {
    bridge.refreshRunning = false
    if (!isCurrent(bridge) || bridge.delivery !== 'initial') return
    if (bridge.refreshPending) {
      queueRefresh(bridge)
      return
    }
    if (!refreshed) return
    bridge.refreshOffset = bridge.refreshBuf.length
    releaseInitialRefresh(bridge)
  })
}

async function clientTty(bridge: Bridge): Promise<string | undefined> {
  if (bridge.clientTty) return bridge.clientTty
  if (!bridge.ptyPid) return undefined
  const clients = await tmux(['list-clients', '-t', bridge.id, '-F', '#{client_pid} #{client_tty}'])
  for (const line of clients.split('\n')) {
    const space = line.indexOf(' ')
    if (space > 0 && Number(line.slice(0, space)) === bridge.ptyPid) {
      return (bridge.clientTty = line.slice(space + 1).trim())
    }
  }
  return undefined
}

function resize(bridge: Bridge, cols: number, rows: number): void {
  if (bridge.cols === cols && bridge.rows === rows) return
  beginDelivery(bridge)
  bridge.cols = cols
  bridge.rows = rows
  sendControl(bridge, { t: 'resize', cols, rows })
}

export function attachViewer(id: string, viewer: Viewer): void {
  const map = subscriptionMap(id)
  const previous = map.get(viewer)
  if (previous) killBridge(previous)
  map.set(viewer, { visible: false, lingering: false, cols: 0, rows: 0 })
}

export function hideViewer(id: string, viewer: Viewer): void {
  const subscription = currentSubscription(id, viewer)
  if (!subscription) return
  subscription.visible = false
  if (!subscription.bridge) return
  subscription.lingering = true
  if (subscription.lingerTimer) return
  subscription.lingerTimer = setTimeout(() => {
    subscription.lingerTimer = undefined
    if (!subscription.visible && currentSubscription(id, viewer) === subscription) killBridge(subscription)
  }, LINGER_MS)
  subscription.lingerTimer.unref()
}

export function detachViewer(id: string, viewer: Viewer): void {
  const map = subscribers.get(id)
  const subscription = map?.get(viewer)
  if (!map || !subscription) return
  // A closed/dead socket is not a hidden live tab: remove its native client now, never after linger.
  killBridge(subscription)
  map.delete(viewer)
  if (map.size === 0) subscribers.delete(id)
}

export function resizeBridge(id: string, viewer: Viewer, colsValue: number, rowsValue: number): void {
  const cols = Math.floor(colsValue), rows = Math.floor(rowsValue)
  if (!(cols > 0 && rows > 0)) return
  const subscription = currentSubscription(id, viewer)
  if (!subscription) return
  const seamless = subscription.lingering && !!subscription.bridge
    && subscription.bridge.cols === cols && subscription.bridge.rows === rows
  cancelLinger(subscription)
  subscription.visible = true
  subscription.cols = cols
  subscription.rows = rows
  const { bridge, created } = ensureBridge(id, viewer, subscription, cols, rows)
  if (!bridge || created || seamless) return
  if (bridge.cols === cols && bridge.rows === rows) {
    beginDelivery(bridge)
    queueRefresh(bridge)
  } else {
    resize(bridge, cols, rows)
  }
}

const MAX_INPUT_BYTES = 64 * 1024

export function forwardInput(id: string, viewer: Viewer, data: string): boolean {
  const subscription = currentSubscription(id, viewer)
  if (!subscription?.visible || !subscription.bridge || !data || Buffer.byteLength(data, 'utf8') > MAX_INPUT_BYTES) return false
  sendControl(subscription.bridge, { t: 'input', data })
  return true
}

async function restoreBridge(id: string, viewer: Viewer, subscription: Subscription): Promise<void> {
  subscription.restoreTimer = undefined
  if (currentSubscription(id, viewer) !== subscription || subscription.bridge || !subscription.visible || !(await alive(id))) return
  if (!(subscription.cols > 0 && subscription.rows > 0)) return
  ensureBridge(id, viewer, subscription, subscription.cols, subscription.rows)
}

function scheduleRestore(id: string, viewer: Viewer, subscription: Subscription): void {
  if (currentSubscription(id, viewer) !== subscription || !subscription.visible || subscription.bridge || subscription.restoreTimer) return
  subscription.restoreTimer = setTimeout(() => void restoreBridge(id, viewer, subscription), 750)
  subscription.restoreTimer.unref()
}

let supervising = false
export function superviseBridges(intervalMs = 4000): void {
  if (supervising) return
  supervising = true
  const tick = () => {
    for (const [id, viewers] of subscribers) {
      for (const [viewer, subscription] of viewers) scheduleRestore(id, viewer, subscription)
    }
    const timer = setTimeout(tick, intervalMs)
    timer.unref()
  }
  tick()
}
