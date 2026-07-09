import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ForgeDriver } from './port.js'
import { githubDriver } from './drivers/github.js'

export const FORGE_DRIVERS: ForgeDriver[] = [githubDriver]
export const DEFAULT_FORGE_HOST = 'github'

export function forgeDriverFor(host: string): ForgeDriver | undefined {
  return FORGE_DRIVERS.find((d) => d.host === host)
}

// the issue stores a THIS repo's forge offers — scoped to the RESOLVED host, not every registered
// driver, so a gitlab repo never gets a 'github' store in its New-issue dropdown. A resolved host
// whose driver isn't registered yet contributes no store (the local store always remains).
export function forgeIssueStores(): { id: string; label: string; kind: 'forge' }[] {
  const driver = forgeDriverFor(resolveForgeHost())
  return driver ? [{ id: driver.host, label: driver.host, kind: 'forge' }] : []
}

// ── host resolution ([[forge-host]]) ─────────────────────────────────────────────────────────────
// WHICH forge a repo talks to is a repo fact, not a constant: derived from the origin remote, with an
// explicit `forge.host` in spexcode.json / spexcode.local.json winning over the derivation, and
// DEFAULT_FORGE_HOST only when nothing resolves (no repo, no origin). The resolved host may name a
// driver that isn't registered yet (e.g. 'gitlab' before its driver lands) — callers degrade to an
// empty forge slice via forgeDriverFor returning undefined, never to a wrong-host network call.

// strip git's hook-exported env so repo discovery works from the filesystem (mirrors spec-cli git.ts)
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

// the `forge.host` config override — local over committed, same layering readConfig applies. Read here
// (not via spec-cli) so the seam stays inside spec-forge; a malformed config file still fails LOUD,
// exactly like spec-cli's readJsonConfig, rather than silently reverting the override.
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

// hostname out of the two remote-URL shapes: a real scheme URL, or scp-like `git@host:owner/repo.git`
function remoteHostname(url: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try { return new URL(url).hostname || null } catch { return null }
  }
  const scp = /^(?:[^@\s/]+@)?([^:/\s]+):./.exec(url)
  return scp ? scp[1] : null
}

// hostname → host id. The SaaS vendors match by name; every OTHER resolvable remote is read as
// self-hosted GitLab (the common self-hosted forge shape, e.g. dev.aminer.cn) — a wrong guess costs
// only an empty slice (no driver ever runs against the wrong host) and `forge.host` corrects it.
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
