import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'

export type ProcessIdentity = { pid: number; startToken: string }

export function parseProcStat(text: string): { ppid: number; ticks: number; startToken: string; rssPages: number } {
  const end = text.lastIndexOf(')')
  if (end < 0) throw new Error('malformed proc stat')
  const fields = text.slice(end + 2).trim().split(/\s+/)
  if (fields.length < 22) throw new Error('short proc stat')
  return {
    ppid: Number(fields[1]),
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
