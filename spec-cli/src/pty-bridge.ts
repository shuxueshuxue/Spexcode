import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { alive } from './sessions.js'

const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
const HELPER = fileURLToPath(new URL('./pty-helper.ts', import.meta.url))
const TSX_IMPORT = import.meta.resolve('tsx')
const DEFAULT_COLS = 120, DEFAULT_ROWS = 40

export type Viewer = { send: (data: Buffer) => void }

type Subscription = { visible: boolean }
type Bridge = {
  id: string
  proc: ChildProcessWithoutNullStreams
  probe: ChildProcessWithoutNullStreams
  cols: number
  rows: number
  ptyPid?: number
  stderr: string
  refreshWhenReady: boolean
  voting: boolean
  warmOwner: boolean
  clientTty?: string
  probeBuf: Buffer
  probeTail: Buffer
  syncCapable: boolean
  barrier: 'none' | 'app' | 'settle' | 'refresh'
  barrierSawLayout: boolean
  barrierSawBegin: boolean
  probeSawBegin: boolean
  refreshBuf: Buffer
  refreshCommandDone: boolean
  refreshFinishTimer?: ReturnType<typeof setTimeout>
  barrierTimer?: ReturnType<typeof setTimeout>
  settleTimer?: ReturnType<typeof setTimeout>
}

const subscribers = new Map<string, Map<Viewer, Subscription>>()
const bridges = new Map<string, Bridge>()
const lastSize = new Map<string, { cols: number; rows: number }>()
let lastSizeAny: { cols: number; rows: number } | undefined
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

function broadcast(id: string, data: Buffer): void {
  for (const viewer of subscribers.get(id)?.keys() ?? []) {
    try { viewer.send(data) } catch { /* socket close owns subscription removal */ }
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
      if (bridge.barrier === 'app' || bridge.barrier === 'settle') bridge.barrierSawLayout = true
      continue
    }
    if (!head.startsWith('%output ')) continue
    const split = head.indexOf(' ', 8)
    if (split > 0) scanSyncMarkers(bridge, unescapeControlOutput(line.subarray(split + 1)))
  }
}

function onHelperOutput(bridge: Bridge, chunk: Buffer): void {
  if (bridge.barrier === 'none') {
    broadcast(bridge.id, chunk)
    return
  }
  if (bridge.barrier === 'app') return
  if (bridge.barrier === 'settle') {
    armSettleQuiet(bridge)
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
    const ready = line.match(/^READY (\d+) (vote|owner|neutral)$/)
    if (ready) {
      bridge.ptyPid = Number(ready[1])
      bridge.warmOwner = ready[2] === 'owner'
      bridge.voting = ready[2] !== 'neutral'
      updateVote(bridge)
      if (bridge.refreshWhenReady) {
        bridge.refreshWhenReady = false
        void refreshBridge(bridge)
      }
    } else if (line) {
      console.error(`[terminal helper ${bridge.id}] ${line}`)
    }
  }
}

function ensureBridge(id: string, cols: number, rows: number, voting: boolean): { bridge: Bridge | null; created: boolean } {
  const existing = bridges.get(id)
  if (existing) return { bridge: existing, created: false }
  let proc: ChildProcessWithoutNullStreams | undefined
  let probe: ChildProcessWithoutNullStreams | undefined
  try {
    probe = spawn('tmux', ['-u', '-C', '-L', TMUX_SOCK, 'attach-session', '-f', 'ignore-size', '-t', id], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' },
    })
    proc = spawn(process.execPath, ['--import', TSX_IMPORT, HELPER, id, String(cols), String(rows), voting ? 'vote' : 'auto'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
  } catch {
    try { proc?.kill() } catch { /* spawn did not complete */ }
    try { probe?.kill() } catch { /* spawn did not complete */ }
    return { bridge: null, created: false }
  }
  const bridge: Bridge = {
    id, proc, probe, cols, rows, stderr: '', refreshWhenReady: false, voting, warmOwner: false,
    probeBuf: Buffer.alloc(0), probeTail: Buffer.alloc(0), syncCapable: synchronizedSessions.has(id),
    barrier: 'none', barrierSawLayout: false, barrierSawBegin: false, probeSawBegin: false,
    refreshBuf: Buffer.alloc(0), refreshCommandDone: false,
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

function armBarrierTimeout(bridge: Bridge): void {
  if (bridge.barrierTimer) clearTimeout(bridge.barrierTimer)
  bridge.barrierTimer = setTimeout(() => failOpenBarrier(bridge), 1000)
  bridge.barrierTimer.unref()
}

function clearBarrier(bridge: Bridge): void {
  bridge.barrier = 'none'
  bridge.barrierSawLayout = false
  bridge.barrierSawBegin = false
  if (bridge.barrierTimer) clearTimeout(bridge.barrierTimer)
  if (bridge.settleTimer) clearTimeout(bridge.settleTimer)
  bridge.barrierTimer = undefined
  bridge.settleTimer = undefined
  bridge.refreshBuf = Buffer.alloc(0)
  bridge.refreshCommandDone = false
  if (bridge.refreshFinishTimer) clearTimeout(bridge.refreshFinishTimer)
  bridge.refreshFinishTimer = undefined
}

function awaitAtomicRefresh(bridge: Bridge): void {
  if (bridge.barrier !== 'app' && bridge.barrier !== 'settle') return
  if (bridge.settleTimer) clearTimeout(bridge.settleTimer)
  bridge.settleTimer = undefined
  bridge.barrier = 'refresh'
  bridge.refreshBuf = Buffer.alloc(0)
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
  const end = bridge.refreshBuf.lastIndexOf(ESU)
  const begin = end >= 0 ? bridge.refreshBuf.lastIndexOf(BSU, end) : -1
  if (begin < 0 || end < begin) return
  const transaction = bridge.refreshBuf.subarray(begin, end + ESU.length)
  clearBarrier(bridge)
  broadcast(bridge.id, transaction)
}

function failOpenBarrier(bridge: Bridge): void {
  if (bridge.barrier === 'none') return
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

async function syncVote(bridge: Bridge): Promise<void> {
  const wanted = bridge.voting
  const tty = await clientTty(bridge)
  if (!tty || bridges.get(bridge.id) !== bridge || bridge.voting !== wanted) return
  // -S applies the client flag with a status-only refresh; tab activation must not resend the pane grid.
  await tmux(['refresh-client', '-S', '-t', tty, '-f', wanted ? '!ignore-size' : 'ignore-size'])
}

function setVote(bridge: Bridge, voting: boolean): void {
  if (bridge.voting === voting) return
  bridge.voting = voting
  void syncVote(bridge)
}

function updateVote(bridge: Bridge): void {
  setVote(bridge, hasVisibleViewer(bridge.id) || bridge.warmOwner)
}

function resize(bridge: Bridge, cols: number, rows: number): void {
  if (bridge.cols === cols && bridge.rows === rows) return
  beginBarrier(bridge)
  bridge.cols = cols
  bridge.rows = rows
  sendControl(bridge, { t: 'resize', cols, rows })
}

export function attachViewer(id: string, viewer: Viewer, initialSize?: { cols: number; rows: number }, initialVisible = !!initialSize): boolean {
  const subscriptions = subscriptionMap(id)
  subscriptions.set(viewer, { visible: initialVisible })
  const proposed = initialSize && { cols: Math.floor(initialSize.cols), rows: Math.floor(initialSize.rows) }
  const fitted = proposed && proposed.cols > 0 && proposed.rows > 0 ? proposed : undefined
  const size = fitted ?? lastSize.get(id) ?? lastSizeAny ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
  if (fitted) { lastSize.set(id, fitted); lastSizeAny = fitted }
  const { bridge, created } = ensureBridge(id, size.cols, size.rows, initialVisible)
  if (!bridge) { subscriptions.delete(viewer); return false }
  if (fitted) {
    if (initialVisible || !hasVisibleViewer(id)) resize(bridge, fitted.cols, fitted.rows)
    updateVote(bridge)
  }
  if (!created && fitted) void refreshBridge(bridge)
  return true
}

export function setViewerVisible(id: string, viewer: Viewer, visible: boolean): void {
  const subscription = subscribers.get(id)?.get(viewer)
  if (!subscription) return
  subscription.visible = visible
  const bridge = bridges.get(id)
  if (bridge) updateVote(bridge)
}

export function detachViewer(id: string, viewer: Viewer): void {
  const subscriptions = subscribers.get(id)
  if (!subscriptions) return
  subscriptions.delete(viewer)
  if (subscriptions.size === 0) {
    subscribers.delete(id)
    killBridge(id)
  } else {
    const bridge = bridges.get(id)
    if (bridge) updateVote(bridge)
  }
}

export function resizeBridge(id: string, viewer: Viewer, colsValue: number, rowsValue: number): void {
  const cols = Math.floor(colsValue), rows = Math.floor(rowsValue)
  if (!(cols > 0 && rows > 0)) return
  const subscription = subscribers.get(id)?.get(viewer)
  if (!subscription) return
  subscription.visible = true
  const size = { cols, rows }
  lastSize.set(id, size); lastSizeAny = size
  const { bridge } = ensureBridge(id, cols, rows, true)
  if (bridge) { updateVote(bridge); resize(bridge, cols, rows) }
}

export function forwardWheel(id: string, up: boolean, col: number, row: number, ticks: number): void {
  const bridge = bridges.get(id)
  if (!bridge) return
  sendControl(bridge, { t: 'wheel', up, col, row, ticks })
}

async function restoreBridge(id: string): Promise<void> {
  restoreTimers.delete(id)
  if (bridges.has(id) || !subscribers.has(id) || !(await alive(id))) return
  const size = lastSize.get(id) ?? lastSizeAny ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
  ensureBridge(id, size.cols, size.rows, hasVisibleViewer(id))
}

function scheduleRestore(id: string): void {
  if (!subscribers.has(id) || restoreTimers.has(id)) return
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
      if (!bridges.has(id)) scheduleRestore(id)
    }
    const timer = setTimeout(tick, intervalMs)
    timer.unref()
  }
  tick()
}
