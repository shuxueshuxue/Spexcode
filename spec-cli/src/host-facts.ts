import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spexcodeHome, encodeProject, readConfig } from '@spexcode/spec-core'
import { readHostRecord, type HostRecord } from './host-record.js'
import { readEndpointRecord } from './endpoint-record.js'
import { sessionHost } from './session-host.js'

export type AgentFact = { installed: boolean; path: string | null; loggedIn: boolean; credential: string | null }
export type LauncherFact = { projectId: string; project: string; name: string; harness: string; cmd: string; resolves: boolean; binary: string | null }
export type HostFacts = {
  host: { kind: 'tmux-host' | 'process-host'; reason: string }
  runtime: { kind: 'native-linux' | 'darwin' | 'wsl2'; label: string; distro?: string }
  versions: { node: string; tmux: string | null; git: string | null }
  agents: Record<'claude' | 'codex' | 'opencode' | 'pi', AgentFact>
  launchers: LauncherFact[]
  memory: { kind: 'wslconfig' | 'cgroup' | 'unknown'; present: boolean; path: string | null; limitBytes: number | null }
  gateway?: HostRecord
}

export type WslDetectionInput = {
  platformName?: NodeJS.Platform
  procVersion?: string
  distroName?: string | null
}

export function isWsl(input: WslDetectionInput = {}): boolean {
  if ((input.platformName ?? platform()) !== 'linux') return false
  const distroName = input.distroName === undefined ? process.env.WSL_DISTRO_NAME : input.distroName
  let procVersion = input.procVersion
  if (procVersion === undefined) {
    try { procVersion = readFileSync('/proc/version', 'utf8') } catch { procVersion = '' }
  }
  return /microsoft|wsl/i.test(procVersion) || !!distroName
}

function commandPath(command: string): string | null {
  const token = command.trim().match(/^(?:'([^']+)'|"([^"]+)"|(\S+))/)?.slice(1).find(Boolean)
  if (!token) return null
  try {
    if (token.includes('/') || token.includes('\\')) return existsSync(resolve(token)) ? resolve(token) : null
    const tool = platform() === 'win32' ? 'where.exe' : 'which'
    return execFileSync(tool, [token], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0] || null
  } catch { return null }
}

function commandVersion(command: string, args: string[]): string | null {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null } catch { return null }
}

function credential(paths: readonly string[]): string | null {
  const found = paths.find((path) => existsSync(path))
  return found ?? null
}

function agentFacts(): HostFacts['agents'] {
  const home = homedir()
  const codexHome = process.env.CODEX_HOME || join(home, '.codex')
  const opencodeData = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'opencode') : join(home, '.local', 'share', 'opencode')
  const piHome = process.env.PI_HOME || join(home, '.pi', 'agent')
  const definitions = {
    claude: [join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), '.credentials.json')],
    codex: [join(codexHome, 'auth.json')],
    opencode: [join(opencodeData, 'auth.json'), join(home, '.opencode', 'auth.json')],
    pi: [join(piHome, 'auth.json'), join(home, '.pi', 'auth.json')],
  } as const
  return Object.fromEntries(Object.entries(definitions).map(([name, paths]) => {
    const at = commandPath(name)
    const auth = credential(paths)
    return [name, { installed: !!at, path: at, loggedIn: !!auth, credential: auth }]
  })) as HostFacts['agents']
}

function discoverRoots(): string[] {
  const roots = new Set<string>()
  const cwd = resolve(process.cwd())
  roots.add(cwd)
  const projects = join(spexcodeHome(), 'projects')
  try {
    for (const id of readdirSync(projects)) {
      const rec = readEndpointRecord(join(projects, id, 'backend.json'))
      if (rec) roots.add(rec.root)
    }
  } catch {}
  try {
    const catalog = JSON.parse(readFileSync(join(spexcodeHome(), 'projects.json'), 'utf8'))
    for (const item of catalog.projects ?? []) if (typeof item?.root === 'string') roots.add(item.root)
  } catch {}
  return [...roots]
}

function launcherFacts(roots: string[]): LauncherFact[] {
  const rows: LauncherFact[] = []
  for (const root of roots) {
    const merged = readConfig(root).sessions?.launchers ?? {}
    for (const [name, cfg] of Object.entries(merged as Record<string, any>)) {
      if (!cfg || typeof cfg.cmd !== 'string') continue
      if (sessionHost().kind === 'process-host' && !['claude-headless', 'codex-headless', 'opencode-headless', 'pi-headless'].includes(cfg.harness || 'claude')) continue
      const binary = commandPath(cfg.cmd)
      rows.push({ projectId: encodeProject(root), project: basename(root), name, harness: cfg.harness || 'claude', cmd: cfg.cmd, resolves: !!binary, binary })
    }
  }
  return rows.sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name))
}

function memoryFact(): HostFacts['memory'] {
  if (isWsl()) {
    const path = join(homedir(), '.wslconfig')
    let limitBytes: number | null = null
    try {
      const match = readFileSync(path, 'utf8').match(/^memory\s*=\s*([0-9]+)([KMG]B)?/im)
      if (match) limitBytes = Number(match[1]) * ({ KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 } as any)[match[2]?.toUpperCase() || 'MB']
    } catch {}
    return { kind: 'wslconfig', present: existsSync(path), path, limitBytes }
  }
  // THE CAP THAT BINDS is the tightest one on the chain from THIS PROCESS up to the cgroup root — not one at a
  // fixed path. cgroup v2's root has no `memory.max` at all, so reading fixed paths answered "no mechanism" on
  // every ordinary v2 host, including one whose slice is capped; the fleet's own hosts run every SpexCode process
  // inside `/system.slice/cron.service` and reported `unknown` from the root. A cap is a NUMBER OF BYTES: `max`
  // (v2) and the 2^63-ish sentinel (v1) are both "no cap", one of them wearing a number.
  const own = (() => {
    try { return readFileSync('/proc/self/cgroup', 'utf8').split('\n').find((line) => line.startsWith('0::'))?.slice(3).trim() || '' }
    catch { return '' }
  })()
  const segments = own.split('/').filter(Boolean)
  const candidates = [
    ...segments.map((_, i) => join('/sys/fs/cgroup', ...segments.slice(0, segments.length - i), 'memory.max')),
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',
  ]
  let path: string | null = null
  let limitBytes: number | null = null
  for (const candidate of candidates) {
    let raw: string
    try { raw = readFileSync(candidate, 'utf8').trim() } catch { continue }
    path ??= candidate                                  // a readable file proves the mechanism, capped or not
    const value = Number(raw)
    if (raw === 'max' || !Number.isSafeInteger(value) || value <= 0) continue
    if (limitBytes == null || value < limitBytes) { limitBytes = value; path = candidate }
  }
  if (!path) return { kind: 'unknown', present: false, path: null, limitBytes: null }
  return { kind: 'cgroup', present: true, path, limitBytes }
}

export function collectHostFacts(roots = discoverRoots()): HostFacts {
  const wsl = isWsl()
  const runtime = platform() === 'darwin'
    ? { kind: 'darwin' as const, label: 'darwin' }
    : wsl ? { kind: 'wsl2' as const, label: 'wsl2', distro: process.env.WSL_DISTRO_NAME || undefined }
      : { kind: 'native-linux' as const, label: 'native linux' }
  const record = readHostRecord()
  return {
    host: sessionHost().kind === 'tmux-host'
      ? { kind: 'tmux-host', reason: 'tmux is available on PATH' }
      : { kind: 'process-host', reason: 'tmux is absent from PATH; detached process hosting is active and only headless adapters are available' },
    runtime,
    versions: { node: process.version, tmux: commandVersion('tmux', ['-V']), git: commandVersion('git', ['--version']) },
    agents: agentFacts(),
    launchers: launcherFacts(roots),
    memory: memoryFact(),
    ...(record ? { gateway: record } : {}),
  }
}

// THE MEMORY FACT ANSWERS ONE QUESTION: does this host cap the memory the work runs inside, and at what size.
// Reporting the MECHANISM and its presence instead read as a broken dependency — a Mac has neither a cgroup file
// nor a `.wslconfig`, so the row said `unknown: missing` about a host that is simply uncapped. A host with no
// capping mechanism is not missing one; its envelope is the whole machine, which is the answer to give.
export function formatMemoryCap(memory: HostFacts['memory']): string {
  if (memory.kind === 'unknown') return 'no cap on this host'
  if (memory.limitBytes == null) return `${memory.kind}: no cap set`
  return `${memory.kind}: ${(memory.limitBytes / 1024 ** 3).toFixed(1)} GiB`
}

export function formatHostFacts(facts: HostFacts): string {
  const lines = [`Host facts`, `host: ${facts.host.kind} (${facts.host.reason})`, `runtime: ${facts.runtime.label}${facts.runtime.distro ? ` (${facts.runtime.distro})` : ''}`, `node: ${facts.versions.node}`, `tmux: ${facts.versions.tmux || 'missing'}`, `git: ${facts.versions.git || 'missing'}`]
  for (const [name, value] of Object.entries(facts.agents)) lines.push(`${name}: ${value.installed ? 'installed' : 'missing'}; ${value.loggedIn ? 'logged in' : 'not logged in'}`)
  lines.push(`memory cap: ${formatMemoryCap(facts.memory)}`)
  lines.push('launchers:')
  for (const launcher of facts.launchers) lines.push(`  ${launcher.project}/${launcher.name}: ${launcher.resolves ? `resolves (${launcher.binary})` : 'BROKEN'} — ${launcher.cmd}`)
  return lines.join('\n')
}
