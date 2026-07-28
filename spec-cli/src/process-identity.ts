import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'
import { dirname, join } from 'node:path'

export type ProcessIdentity = { pid: number; startToken: string }

export type ProcessAdapter = Readonly<{
  platform: NodeJS.Platform
  startToken(pid: number): string | null
  processGroupId(pid: number): number | null
  linuxSessionId(pid: number): number | null
}>

export type VerifiedDetachedRuntime = Readonly<ProcessIdentity & {
  receiptVersion: 4
  processGroupId: number
  linuxSessionId?: number
}>

export type DetachedRuntimeVerification =
  | { ok: true; identity: VerifiedDetachedRuntime }
  | { ok: false; reason: string }

type DetachedLaunchReceiptV4 = {
  version: 4
  kind: 'spexcode-detached-runtime'
  pid: number
  startToken: string
  processGroupId: number
  linuxSessionId?: number
}

export function parseProcStat(text: string): { ppid: number; processGroupId: number; sessionId: number; ticks: number; startToken: string; rssPages: number } {
  const end = text.lastIndexOf(')')
  if (end < 0) throw new Error('malformed proc stat')
  const fields = text.slice(end + 2).trim().split(/\s+/)
  if (fields.length < 22) throw new Error('short proc stat')
  return {
    ppid: Number(fields[1]),
    processGroupId: Number(fields[2]),
    sessionId: Number(fields[3]),
    ticks: Number(fields[11]) + Number(fields[12]),
    startToken: fields[19],
    rssPages: Number(fields[21]),
  }
}

export function processStartToken(pid: number, procRoot = '/proc'): string | null {
  if (platform() === 'linux' || procRoot !== '/proc') {
    try { return parseProcStat(readFileSync(join(procRoot, String(pid), 'stat'), 'utf8')).startToken }
    catch { return null }
  }
  try {
    const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    return started || null
  } catch { return null }
}

const procField = (pid: number, field: 'processGroupId' | 'sessionId'): number | null => {
  try {
    const stat = parseProcStat(readFileSync(join('/proc', String(pid), 'stat'), 'utf8'))
    return stat[field]
  } catch { return null }
}

const psProcessGroupId = (pid: number): number | null => {
  try {
    const value = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
    return Number.isInteger(value) && value > 0 ? value : null
  } catch { return null }
}

export const hostProcessAdapter: ProcessAdapter = Object.freeze({
  platform: platform(),
  startToken: (pid) => processStartToken(pid),
  processGroupId: (pid) => platform() === 'linux' ? procField(pid, 'processGroupId') : psProcessGroupId(pid),
  linuxSessionId: (pid) => platform() === 'linux' ? procField(pid, 'sessionId') : null,
})

const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const parseDetachedLaunchReceipt = (text: string, hostPlatform: NodeJS.Platform): DetachedLaunchReceiptV4 | null => {
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const receipt = value as Record<string, unknown>
  const keys = ['kind', 'pid', 'processGroupId', 'startToken', 'version', ...(hostPlatform === 'linux' ? ['linuxSessionId'] : [])].sort()
  if (!exactKeys(receipt, keys) || receipt.version !== 4 || receipt.kind !== 'spexcode-detached-runtime' ||
    !Number.isInteger(receipt.pid) || Number(receipt.pid) <= 0 || typeof receipt.startToken !== 'string' || !receipt.startToken ||
    !Number.isInteger(receipt.processGroupId) || Number(receipt.processGroupId) <= 0 ||
    (hostPlatform === 'linux' && (!Number.isInteger(receipt.linuxSessionId) || Number(receipt.linuxSessionId) <= 0))) return null
  return receipt as DetachedLaunchReceiptV4
}

const observeDetachedRuntime = (pid: number, adapter: ProcessAdapter): DetachedRuntimeVerification => {
  if (adapter.platform === 'win32') return { ok: false, reason: 'detached runtime identity is unsupported on win32' }
  const startBefore = adapter.startToken(pid)
  if (!startBefore) return { ok: false, reason: `PID ${pid} has no readable process-start identity` }
  const processGroupId = adapter.processGroupId(pid)
  if (processGroupId !== pid) return { ok: false, reason: `PID ${pid} is not its own process-group leader (pgrp=${processGroupId ?? 'unknown'})` }
  let linuxSessionId: number | undefined
  if (adapter.platform === 'linux') {
    const sessionId = adapter.linuxSessionId(pid)
    if (sessionId !== pid) return { ok: false, reason: `Linux PID ${pid} is not its own session leader (session=${sessionId ?? 'unknown'})` }
    linuxSessionId = sessionId
  }
  const startAfter = adapter.startToken(pid)
  if (!startAfter || startAfter !== startBefore)
    return { ok: false, reason: `PID ${pid} process-start identity changed during detached-boundary verification` }
  return {
    ok: true,
    identity: Object.freeze({
      pid,
      startToken: startAfter,
      receiptVersion: 4,
      processGroupId,
      ...(linuxSessionId === undefined ? {} : { linuxSessionId }),
    }),
  }
}

export function verifyDetachedRuntime(pid: number, receiptFile: string, adapter: ProcessAdapter = hostProcessAdapter): DetachedRuntimeVerification {
  let text: string
  try { text = readFileSync(receiptFile, 'utf8') }
  catch { return { ok: false, reason: 'detached launch receipt is missing or unreadable' } }
  const receipt = parseDetachedLaunchReceipt(text, adapter.platform)
  if (!receipt) return { ok: false, reason: 'detached launch receipt has the wrong version or shape' }
  if (receipt.pid !== pid) return { ok: false, reason: `detached launch receipt names PID ${receipt.pid}, not ${pid}` }
  if (receipt.processGroupId !== pid)
    return { ok: false, reason: `detached launch receipt has wrong process group ${receipt.processGroupId} for PID ${pid}` }
  if (adapter.platform === 'linux' && receipt.linuxSessionId !== pid)
    return { ok: false, reason: `detached launch receipt has wrong Linux session ${receipt.linuxSessionId ?? 'missing'} for PID ${pid}` }
  const live = observeDetachedRuntime(pid, adapter)
  if (!live.ok) return live
  if (live.identity.startToken !== receipt.startToken)
    return { ok: false, reason: `PID ${pid} process-start identity does not match its detached launch receipt` }
  return live
}

export function writeDetachedRuntimeReceipt(pid: number, receiptFile: string, adapter: ProcessAdapter = hostProcessAdapter): VerifiedDetachedRuntime {
  const observed = observeDetachedRuntime(pid, adapter)
  if (!observed.ok) throw new Error(`cannot prove detached shared runtime: ${observed.reason}`)
  const receipt: DetachedLaunchReceiptV4 = {
    version: 4,
    kind: 'spexcode-detached-runtime',
    pid,
    startToken: observed.identity.startToken,
    processGroupId: observed.identity.processGroupId,
    ...(observed.identity.linuxSessionId === undefined ? {} : { linuxSessionId: observed.identity.linuxSessionId }),
  }
  mkdirSync(dirname(receiptFile), { recursive: true })
  const tmp = `${receiptFile}.${process.pid}.${randomUUID()}.tmp`
  let published = false
  try {
    writeFileSync(tmp, `${JSON.stringify(receipt)}\n`, { mode: 0o600 })
    renameSync(tmp, receiptFile)
    published = true
    const verified = verifyDetachedRuntime(pid, receiptFile, adapter)
    if (!verified.ok) throw new Error(`cannot verify detached shared runtime receipt: ${verified.reason}`)
    return verified.identity
  } catch (error) {
    rmSync(tmp, { force: true })
    if (published) rmSync(receiptFile, { force: true })
    throw error
  }
}

export const detachedRuntimeGenerationToken = (identity: VerifiedDetachedRuntime) =>
  `detached-v4|${identity.pid}|${identity.startToken}|${identity.processGroupId}|${identity.linuxSessionId ?? '-'}`
