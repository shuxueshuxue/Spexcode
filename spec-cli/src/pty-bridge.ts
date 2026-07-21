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
  probe: ChildProcessWithoutNullStreams
  cols: number
  rows: number
  ptyPid?: number
  stderr: string
  refreshWhenReady: boolean
  clientTty?: string
  probeBuf: Buffer
  probeTail: Buffer
  syncCapable: boolean
  barrier: 'none' | 'attach' | 'app' | 'settle' | 'refresh'
  barrierSawLayout: boolean
  barrierSawBegin: boolean
  probeSawBegin: boolean
  batchFromAttach: boolean
  refreshBuf: Buffer
  refreshCommandDone: boolean
  attachTimer?: ReturnType<typeof setTimeout>
  refreshFinishTimer?: ReturnType<typeof setTimeout>
  barrierTimer?: ReturnType<typeof setTimeout>
  settleTimer?: ReturnType<typeof setTimeout>
}

const subscribers = new Map<string, Map<Viewer, Subscription>>()
const bridges = new Map<string, Bridge>()
const lastSize = new Map<string, { cols: number; rows: number }>()
const restoreTimers = new Map<string, ReturnType<typeof setTimeout>>()
const synchronizedSessions = new Set<string>()

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

const BSU = Buffer.from('\x1b[?2026h')
const ESU = Buffer.from('\x1b[?2026l')
const isOct = (value: number) => value >= 0x30 && value <= 0x37

function unescapeControlOutput(data: Buffer): Buffer {
  const output = Buffer.allocUnsafe(data.length)
  let written = 0
  for (let index = 0; index < data.length; index++) {
    if (data[index] === 0x5c && index + 3 < data.length && isOct(data[index + 1]) && isOct(data[index + 2]) && isOct(data[index + 3])) {
      output[written++] = ((data[index + 1] - 0x30) << 6) | ((data[index + 2] - 0x30) << 3) | (data[index + 3] - 0x30)
      index += 3
    } else {
      output[written++] = data[index]
    }
  }
  return output.subarray(0, written)
}

function scanSyncMarkers(bridge: Bridge, data: Buffer): void {
  const bytes = bridge.probeTail.length ? Buffer.concat([bridge.probeTail, data]) : data
  for (let index = 0; index < bytes.length; index++) {
    if (bytes.subarray(index, index + BSU.length).equals(BSU)) {
      bridge.probeSawBegin = true
      if ((bridge.barrier === 'app' || bridge.barrier === 'settle') && bridge.barrierSawLayout) bridge.barrierSawBegin = true
      index += BSU.length - 1
    } else if (bytes.subarray(index, index + ESU.length).equals(ESU)) {
      if (bridge.probeSawBegin) {
        bridge.probeSawBegin = false
        bridge.syncCapable = true
        synchronizedSessions.add(bridge.id)
      }
      if ((bridge.barrier === 'app' || bridge.barrier === 'settle') && bridge.barrierSawBegin) awaitAtomicRefresh(bridge)
      index += ESU.length - 1
    }
  }
  bridge.probeTail = bytes.subarray(Math.max(0, bytes.length - (BSU.length - 1)))
}

function feedProbe(bridge: Bridge, chunk: Buffer): void {
  bridge.probeBuf = bridge.probeBuf.length ? Buffer.concat([bridge.probeBuf, chunk]) : chunk
  let newline: number
  while ((newline = bridge.probeBuf.indexOf(0x0a)) >= 0) {
    let line = bridge.probeBuf.subarray(0, newline)
    bridge.probeBuf = bridge.probeBuf.subarray(newline + 1)
    if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1)
    const head = line.toString('latin1')
    if (head.startsWith('%layout-change ')) {
      if (bridge.barrier === 'attach') {
        bridge.barrierSawLayout = true
        bridge.barrier = bridge.syncCapable ? 'app' : 'settle'
        if (bridge.attachTimer) clearTimeout(bridge.attachTimer)
        bridge.attachTimer = undefined
        armBarrierTimeout(bridge, bridge.barrier === 'app' ? 1000 : 400)
      }
      if (bridge.barrier === 'app' || bridge.barrier === 'settle') bridge.barrierSawLayout = true
      continue
    }
    if (!head.startsWith('%output ')) continue
    const split = head.indexOf(' ', 8)
    if (split > 0) {
      scanSyncMarkers(bridge, unescapeControlOutput(line.subarray(split + 1)))
      if (bridge.barrier === 'settle' && bridge.barrierSawLayout) armSettleQuiet(bridge)
    }
  }
}

function onHelperOutput(bridge: Bridge, chunk: Buffer): void {
  if (bridges.get(bridge.id) !== bridge) return
  if (bridge.barrier === 'none') {
    broadcast(bridge.id, chunk)
    return
  }
  if (bridge.barrier === 'attach') {
    bridge.refreshBuf = bridge.refreshBuf.length ? Buffer.concat([bridge.refreshBuf, chunk]) : chunk
    scheduleAttachFinish(bridge)
    return
  }
  if (bridge.barrier === 'app' || bridge.barrier === 'settle') {
    if (bridge.batchFromAttach) {
      bridge.refreshBuf = bridge.refreshBuf.length ? Buffer.concat([bridge.refreshBuf, chunk]) : chunk
    }
    return
  }

  bridge.refreshBuf = bridge.refreshBuf.length ? Buffer.concat([bridge.refreshBuf, chunk]) : chunk
  scheduleAtomicRefreshFinish(bridge)
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
      if (bridge.barrier === 'attach' && !bridge.barrierTimer) armBarrierTimeout(bridge, 400)
      if (bridge.refreshWhenReady) {
        bridge.refreshWhenReady = false
        void refreshBridge(bridge)
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
  let probe: ChildProcessWithoutNullStreams | undefined
  try {
    probe = spawn('tmux', ['-u', '-C', '-L', TMUX_SOCK, 'attach-session', '-f', 'ignore-size', '-t', id], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' },
    })
    proc = spawn(process.execPath, [HELPER, id, String(cols), String(rows)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
  } catch {
    try { proc?.kill() } catch { /* spawn did not complete */ }
    try { probe?.kill() } catch { /* spawn did not complete */ }
    return { bridge: null, created: false }
  }
  const bridge: Bridge = {
    id, proc, probe, cols, rows, stderr: '', refreshWhenReady: false,
    probeBuf: Buffer.alloc(0), probeTail: Buffer.alloc(0), syncCapable: synchronizedSessions.has(id),
    barrier: 'attach', barrierSawLayout: false, barrierSawBegin: false, probeSawBegin: false,
    batchFromAttach: true, refreshBuf: Buffer.alloc(0), refreshCommandDone: false,
  }
  bridges.set(id, bridge)
  proc.stdout.on('data', (data: Buffer) => onHelperOutput(bridge, data))
  proc.stderr.on('data', (data: Buffer) => onHelperStderr(bridge, data))
  probe.stdout.on('data', (data: Buffer) => feedProbe(bridge, data))
  probe.stderr.resume()
  let reaped = false
  const gone = () => {
    if (reaped) return
    reaped = true
    if (bridges.get(id) !== bridge) return
    bridges.delete(id)
    clearBarrier(bridge)
    try { bridge.proc.kill() } catch { /* already gone */ }
    try { bridge.probe.kill() } catch { /* already gone */ }
    scheduleRestore(id)
  }
  proc.on('exit', gone)
  proc.on('error', gone)
  probe.on('exit', gone)
  probe.on('error', gone)
  return { bridge, created: true }
}

function killBridge(id: string): void {
  const bridge = bridges.get(id)
  if (!bridge) return
  bridges.delete(id)
  clearBarrier(bridge)
  try { bridge.proc.stdin.end() } catch { /* already gone */ }
  try { bridge.probe.stdin.end() } catch { /* already gone */ }
  const kill = setTimeout(() => { try { bridge.proc.kill() } catch { /* already gone */ } }, 250)
  kill.unref()
  const killProbe = setTimeout(() => { try { bridge.probe.kill() } catch { /* already gone */ } }, 250)
  killProbe.unref()
}

function beginBarrier(bridge: Bridge): void {
  if (bridge.barrier !== 'none') return
  bridge.barrier = bridge.syncCapable ? 'app' : 'settle'
  bridge.barrierSawLayout = false
  bridge.barrierSawBegin = false
  bridge.batchFromAttach = false
  if (bridge.barrier === 'app') armBarrierTimeout(bridge)
  else {
    bridge.barrierTimer = setTimeout(() => awaitAtomicRefresh(bridge), 400)
    bridge.barrierTimer.unref()
  }
}

function armSettleQuiet(bridge: Bridge): void {
  if (bridge.settleTimer) clearTimeout(bridge.settleTimer)
  bridge.settleTimer = setTimeout(() => awaitAtomicRefresh(bridge), 160)
  bridge.settleTimer.unref()
}

function armBarrierTimeout(bridge: Bridge, timeoutMs = 1000): void {
  if (bridge.barrierTimer) clearTimeout(bridge.barrierTimer)
  bridge.barrierTimer = setTimeout(() => failOpenBarrier(bridge), timeoutMs)
  bridge.barrierTimer.unref()
}

function clearBarrier(bridge: Bridge): void {
  bridge.barrier = 'none'
  bridge.barrierSawLayout = false
  bridge.barrierSawBegin = false
  bridge.batchFromAttach = false
  if (bridge.barrierTimer) clearTimeout(bridge.barrierTimer)
  if (bridge.settleTimer) clearTimeout(bridge.settleTimer)
  bridge.barrierTimer = undefined
  bridge.settleTimer = undefined
  bridge.refreshBuf = Buffer.alloc(0)
  bridge.refreshCommandDone = false
  if (bridge.attachTimer) clearTimeout(bridge.attachTimer)
  bridge.attachTimer = undefined
  if (bridge.refreshFinishTimer) clearTimeout(bridge.refreshFinishTimer)
  bridge.refreshFinishTimer = undefined
}

function firstCompleteTransactionStart(bridge: Bridge): number | undefined {
  const begin = bridge.refreshBuf.indexOf(BSU)
  const end = begin >= 0 ? bridge.refreshBuf.indexOf(ESU, begin + BSU.length) : -1
  return begin >= 0 && end >= begin ? begin : undefined
}

function releaseNativeBatch(bridge: Bridge, begin: number): void {
  // A native client repaint is cumulative. A busy pane can append small complete diffs and the beginning of
  // another transaction while the barrier drains; selecting one BSU/ESU pair would either discard the full
  // repaint or tear off that trailing update. Resume the raw stream from the path's sound boundary without
  // dropping another byte.
  const batch = bridge.refreshBuf.subarray(begin)
  commitSize(bridge)
  clearBarrier(bridge)
  broadcast(bridge.id, batch)
}

function scheduleAttachFinish(bridge: Bridge): void {
  if (bridge.barrier !== 'attach' || bridge.attachTimer) return
  if (firstCompleteTransactionStart(bridge) === undefined) return
  bridge.attachTimer = setTimeout(() => {
    bridge.attachTimer = undefined
    if (bridge.barrier !== 'attach' || bridge.barrierSawLayout) return
    if (firstCompleteTransactionStart(bridge) !== undefined) releaseNativeBatch(bridge, 0)
  }, 30)
  bridge.attachTimer.unref()
}

function awaitAtomicRefresh(bridge: Bridge): void {
  if (bridge.barrier !== 'app' && bridge.barrier !== 'settle') return
  if (bridge.settleTimer) clearTimeout(bridge.settleTimer)
  bridge.settleTimer = undefined
  bridge.barrier = 'refresh'
  if (!bridge.batchFromAttach) bridge.refreshBuf = Buffer.alloc(0)
  bridge.refreshCommandDone = false
  armBarrierTimeout(bridge)
  void refreshBridge(bridge).then(() => {
    if (bridge.barrier !== 'refresh') return
    bridge.refreshCommandDone = true
    scheduleAtomicRefreshFinish(bridge)
  })
}

function scheduleAtomicRefreshFinish(bridge: Bridge): void {
  if (bridge.barrier !== 'refresh' || !bridge.refreshCommandDone) return
  if (bridge.refreshFinishTimer) clearTimeout(bridge.refreshFinishTimer)
  bridge.refreshFinishTimer = setTimeout(() => {
    bridge.refreshFinishTimer = undefined
    finishAtomicRefresh(bridge)
  }, 15)
  bridge.refreshFinishTimer.unref()
}

function finishAtomicRefresh(bridge: Bridge): void {
  if (bridge.barrier !== 'refresh') return
  const transactionStart = firstCompleteTransactionStart(bridge)
  if (transactionStart !== undefined) releaseNativeBatch(bridge, bridge.batchFromAttach ? 0 : transactionStart)
}

function failOpenBarrier(bridge: Bridge): void {
  if (bridge.barrier === 'none') return
  commitSize(bridge)
  clearBarrier(bridge)
  void refreshBridge(bridge)
}

async function refreshBridge(bridge: Bridge): Promise<void> {
  if (bridges.get(bridge.id) !== bridge) return
  if (!bridge.ptyPid) { bridge.refreshWhenReady = true; return }
  const tty = await clientTty(bridge)
  if (tty) await tmux(['refresh-client', '-t', tty])
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
  beginBarrier(bridge)
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
    if (refreshSameSize) void refreshBridge(bridge)
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
