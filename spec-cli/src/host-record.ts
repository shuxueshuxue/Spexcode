import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spexcodeHome } from '@spexcode/spec-core'

export type HostRecord = {
  version: 1
  url: string
  pid: number
  instanceId: string
  startedAt: string
}

export const hostRecordPath = (): string => join(spexcodeHome(), 'host.json')

export function publishHostRecord(record: HostRecord): void {
  const file = hostRecordPath()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.host.json.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n')
  renameSync(tmp, file)
}

export function newHostRecord(url: string, pid = process.pid): HostRecord {
  return { version: 1, url, pid, instanceId: randomUUID(), startedAt: new Date().toISOString() }
}

export function dropOwnHostRecord(instanceId: string): void {
  const file = hostRecordPath()
  try {
    if (JSON.parse(readFileSync(file, 'utf8'))?.instanceId === instanceId) rmSync(file)
  } catch { /* already gone, malformed, or owned by a newer dashboard */ }
}

export function readHostRecord(file = hostRecordPath()): HostRecord | null {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'))
    if (record?.version !== 1 || typeof record.url !== 'string' || typeof record.instanceId !== 'string' ||
      !Number.isInteger(record.pid) || record.pid <= 0 || typeof record.startedAt !== 'string') return null
    const url = new URL(record.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    try { process.kill(record.pid, 0) } catch { return null }
    return record as HostRecord
  } catch { return null }
}
