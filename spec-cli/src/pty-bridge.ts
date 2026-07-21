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

type Subscription = { visible: boolean; cols: number; rows: number }
type Bridge = {
  id: string
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
const bridges = new Map<string, Bridge>()
const lastSize = new Map<string, { cols: number; rows: number }>()
const restoreTimers = new Map<string, ReturnType<typeof setTimeout>>()
const BSU = Buffer.from('\x1b[?2026h')
const ESU = Buffer.from('\x1b[?2026l')
const GEOMETRY_STABILIZATION_MS = 400

function subscriptionMap(id: string): Map<Viewer, Subscription> {
  let map = subscribers.get(id)
  if (!map) subscribers.set(id, map = new Map())
  return map
}

function hasVisibleViewer(id: string): boolean {
  for (const subscription of subscribers.get(id)?.values() ?? []) {
    if (subscription.visible) return true
  }
  return false
}

function visibleSize(id: string): { cols: number; rows: number } | undefined {
  let cols = Infinity, rows = Infinity
  for (const subscription of subscribers.get(id)?.values() ?? []) {
    if (!subscription.visible || subscription.cols <= 0 || subscription.rows <= 0) continue
    cols = Math.min(cols, subscription.cols)
    rows = Math.min(rows, subscription.rows)
  }
  return Number.isFinite(cols) && Number.isFinite(rows) ? { cols, rows } : undefined
}

function broadcast(id: string, data: Buffer): void {
  for (const [viewer, subscription] of subscribers.get(id) ?? []) {
    if (!subscription.visible) continue
    try { viewer.send(data) } catch { /* socket close owns subscription removal */ }
  }
}

function commitSize(bridge: Bridge): void {
  for (const [viewer, subscription] of subscribers.get(bridge.id) ?? []) {
    if (!subscription.visible) continue
    try { viewer.commitSize?.(bridge.cols, bridge.rows) } catch { /* socket close owns subscription removal */ }
  }
}

async function tmux(args: string[]): Promise<string> {
  try {
    const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, ...args])
    return stdout.trim()
  } catch { return '' }
}

function onHelperOutput(bridge: Bridge, chunk: Buffer): void {
  if (bridges.get(bridge.id) !== bridge) return
  if (bridge.delivery === 'stream') {
    broadcast(bridge.id, chunk)
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
      console.error(`[terminal helper ${bridge.id}] ${line}`)
    }
  }
}

function ensureBridge(id: string, cols: number, rows: number): { bridge: Bridge | null; created: boolean } {
  const existing = bridges.get(id)
  if (existing) return { bridge: existing, created: false }
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
    id, proc, cols, rows, stderr: '', delivery: 'initial',
    refreshBuf: Buffer.alloc(0), refreshPending: false, refreshRunning: false,
  }
  bridges.set(id, bridge)
  proc.stdout.on('data', (data: Buffer) => onHelperOutput(bridge, data))
  proc.stderr.on('data', (data: Buffer) => onHelperStderr(bridge, data))
  let reaped = false
  const gone = () => {
    if (reaped) return
    reaped = true
    if (bridges.get(id) !== bridge) return
    bridges.delete(id)
    clearDelivery(bridge)
    try { bridge.proc.kill() } catch { /* already gone */ }
    scheduleRestore(id)
  }
  proc.on('exit', gone)
  proc.on('error', gone)
  return { bridge, created: true }
}

function killBridge(id: string): void {
  const bridge = bridges.get(id)
  if (!bridge) return
  bridges.delete(id)
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
  if (batch.length) broadcast(bridge.id, batch)
}

function finishDelivery(bridge: Bridge): void {
  if (bridge.delivery === 'stream') return
  const failOpen = bridge.delivery === 'initial'
  const batch = bridge.refreshBuf
  clearDelivery(bridge)
  if (!failOpen && !batch.length) return
  // A commit marks the following binary message as one browser render transaction even when the grid itself
  // is unchanged. Send an empty frame only on fail-open, so the browser never leaves that transaction armed.
  commitSize(bridge)
  broadcast(bridge.id, batch)
}

async function refreshBridge(bridge: Bridge): Promise<boolean> {
  if (bridges.get(bridge.id) !== bridge || !bridge.ptyPid) return false
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
    if (bridges.get(bridge.id) !== bridge || bridge.delivery !== 'initial') return
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
  subscriptionMap(id).set(viewer, { visible: false, cols: 0, rows: 0 })
}

function syncBridgeToViewers(id: string, refreshSameSize: boolean): void {
  const size = visibleSize(id)
  if (!size) { killBridge(id); return }
  lastSize.set(id, size)
  const { bridge, created } = ensureBridge(id, size.cols, size.rows)
  if (!bridge) return
  if (!created && bridge.cols === size.cols && bridge.rows === size.rows) {
    if (refreshSameSize) {
      beginDelivery(bridge)
      queueRefresh(bridge)
    }
  } else {
    resize(bridge, size.cols, size.rows)
  }
}

export function hideViewer(id: string, viewer: Viewer): void {
  const subscription = subscribers.get(id)?.get(viewer)
  if (!subscription) return
  subscription.visible = false
  syncBridgeToViewers(id, false)
}

export function detachViewer(id: string, viewer: Viewer): void {
  const subscriptions = subscribers.get(id)
  if (!subscriptions) return
  subscriptions.delete(viewer)
  if (subscriptions.size === 0) subscribers.delete(id)
  syncBridgeToViewers(id, false)
}

export function resizeBridge(id: string, viewer: Viewer, colsValue: number, rowsValue: number): void {
  const cols = Math.floor(colsValue), rows = Math.floor(rowsValue)
  if (!(cols > 0 && rows > 0)) return
  const subscription = subscribers.get(id)?.get(viewer)
  if (!subscription) return
  subscription.visible = true
  subscription.cols = cols
  subscription.rows = rows
  syncBridgeToViewers(id, true)
}

export function forwardWheel(id: string, up: boolean, col: number, row: number, ticks: number): void {
  const bridge = bridges.get(id)
  if (!bridge) return
  sendControl(bridge, { t: 'wheel', up, col, row, ticks })
}

async function restoreBridge(id: string): Promise<void> {
  restoreTimers.delete(id)
  if (bridges.has(id) || !hasVisibleViewer(id) || !(await alive(id))) return
  const size = lastSize.get(id)
  if (!size) return
  ensureBridge(id, size.cols, size.rows)
}

function scheduleRestore(id: string): void {
  if (!hasVisibleViewer(id) || restoreTimers.has(id)) return
  const timer = setTimeout(() => void restoreBridge(id), 750)
  timer.unref()
  restoreTimers.set(id, timer)
}

let supervising = false
export function superviseBridges(intervalMs = 4000): void {
  if (supervising) return
  supervising = true
  const tick = () => {
    for (const id of subscribers.keys()) {
      if (hasVisibleViewer(id) && !bridges.has(id)) scheduleRestore(id)
    }
    const timer = setTimeout(tick, intervalMs)
    timer.unref()
  }
  tick()
}
