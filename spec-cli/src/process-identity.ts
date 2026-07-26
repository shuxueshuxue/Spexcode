import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'

export type ProcessIdentity = { pid: number; startToken: string }
export type ProcessTopology = ProcessIdentity & { processGroupId: number; sessionId: number }

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

export function processTopology(pid: number, procRoot = '/proc'): ProcessTopology | null {
  if (platform() === 'linux' || procRoot !== '/proc') {
    try {
      const stat = parseProcStat(readFileSync(join(procRoot, String(pid), 'stat'), 'utf8'))
      return { pid, startToken: stat.startToken, processGroupId: stat.processGroupId, sessionId: stat.sessionId }
    } catch { return null }
  }
  try {
    const [processGroupId, sessionId] = execFileSync('ps', ['-o', 'pgid=', '-o', 'sess=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)
    const startToken = processStartToken(pid, procRoot)
    return startToken && Number.isFinite(processGroupId) && Number.isFinite(sessionId)
      ? { pid, startToken, processGroupId, sessionId }
      : null
  } catch { return null }
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
