import { realpathSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { mainRoot, type SpecLite } from '@spexcode/spec-core'
import { readHostRecord, type HostRecord } from './host-record.js'
import { resolveOpenTarget } from './open-target.js'
import type { Session } from './sessions.js'

type Spawn = (command: string, args: readonly string[], options: { detached: boolean; stdio: 'ignore' }) => ChildProcess

export type OpenDashboardOptions = {
  readRecord?: () => HostRecord | null
  fetch?: typeof globalThis.fetch
  root?: string
  specs?: Pick<SpecLite, 'id'>[]
  sessions?: Session[]
  cwd?: string
}

function sameRoot(left: string, right: unknown): boolean {
  if (typeof right !== 'string') return false
  try { return realpathSync(left) === realpathSync(right) } catch { return false }
}

export async function resolveOpenDashboardUrl(value: string, options: OpenDashboardOptions = {}): Promise<string> {
  const record = (options.readRecord ?? readHostRecord)()
  if (!record) throw new Error('no running host gateway; run `spex dashboard` first')

  const fetchFn = options.fetch ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1_500)
  let hostResponse: Response
  let catalogResponse: Response
  try {
    ;[hostResponse, catalogResponse] = await Promise.all([
      fetchFn(`${record.url}/host`, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal }),
      fetchFn(`${record.url}/projects`, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal }),
    ])
  } catch {
    throw new Error('the recorded host gateway is not reachable; run `spex dashboard` first')
  } finally {
    clearTimeout(timer)
  }
  if (!hostResponse.ok) throw new Error(`the host gateway record could not be validated (HTTP ${hostResponse.status})`)
  const facts = await hostResponse.json().catch(() => null) as { gateway?: { instanceId?: unknown } } | null
  if (facts?.gateway?.instanceId !== record.instanceId) throw new Error('the host gateway record does not match the running gateway')
  if (!catalogResponse.ok) throw new Error(`the host gateway catalog is unavailable (HTTP ${catalogResponse.status})`)
  const catalog = await catalogResponse.json().catch(() => null) as { projects?: unknown } | null
  if (!Array.isArray(catalog?.projects)) throw new Error('the host gateway catalog returned an unexpected answer')

  const root = realpathSync(options.root ?? mainRoot())
  const project = catalog.projects.find((entry: any) => sameRoot(root, entry?.root)) as { id?: unknown; projectId?: unknown } | undefined
  const projectId = project?.id ?? project?.projectId
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error(`the running host gateway does not know project ${root}; add it from the projects hub`)
  }
  const target = resolveOpenTarget(value, { root, specs: options.specs, sessions: options.sessions, cwd: options.cwd })
  return `${new URL(record.url).origin}/p/${encodeURIComponent(projectId)}/${target.hash}`
}

export function platformOpener(url: string, platform = process.platform): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

export async function invokePlatformOpener(url: string, platform = process.platform, spawnFn: Spawn = spawn): Promise<void> {
  const opener = platformOpener(url, platform)
  await new Promise<void>((resolve, reject) => {
    const child = spawnFn(opener.command, opener.args, { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}
