import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ForgeDriver } from './port.js'
import { githubDriver } from './drivers/github.js'
import { gitlabDriver } from './drivers/gitlab.js'

export const FORGE_DRIVERS: ForgeDriver[] = [githubDriver, gitlabDriver]
export const DEFAULT_FORGE_HOST = 'github'

export function forgeDriverFor(host: string): ForgeDriver | undefined {
  return FORGE_DRIVERS.find((d) => d.host === host)
}

export function forgeIssueStores(): { id: string; label: string; kind: 'forge' }[] {
  const driver = forgeDriverFor(resolveForgeHost())
  return driver ? [{ id: driver.host, label: driver.host, kind: 'forge' }] : []
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  return env
}

function gitOut(args: string[]): string | null {
  try {
    return execFileSync('git', args, { env: gitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch { return null }
}

function configuredHost(): string | null {
  const root = gitOut(['rev-parse', '--show-toplevel'])
  if (!root) return null
  for (const name of ['spexcode.local.json', 'spexcode.json']) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    let parsed: any
    try { parsed = JSON.parse(readFileSync(p, 'utf8')) }
    catch (e) { throw new Error(`${p} is not valid JSON: ${(e as Error).message}`) }
    const host = parsed?.forge?.host
    if (typeof host === 'string' && host.trim()) return host.trim()
  }
  return null
}

function remoteHostname(url: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try { return new URL(url).hostname || null } catch { return null }
  }
  const scp = /^(?:[^@\s/]+@)?([^:/\s]+):./.exec(url)
  return scp ? scp[1] : null
}

function hostFor(hostname: string): string {
  const h = hostname.toLowerCase()
  if (h.includes('github')) return 'github'
  if (h.includes('bitbucket')) return 'bitbucket'
  return 'gitlab'
}

let cached: { host: string; at: number } | null = null
const RESOLVE_TTL_MS = 30_000

export function resolveForgeHost(): string {
  const now = Date.now()
  if (cached && now - cached.at < RESOLVE_TTL_MS) return cached.host
  const url = gitOut(['remote', 'get-url', 'origin'])
  const hostname = url ? remoteHostname(url) : null
  const host = configuredHost() ?? (hostname ? hostFor(hostname) : DEFAULT_FORGE_HOST)
  cached = { host, at: now }
  return host
}
