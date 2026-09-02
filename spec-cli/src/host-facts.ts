import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spexcodeHome, encodeProject, readJsonConfig } from '@spexcode/spec-core'
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
    const portable = readJsonConfig(join(root, 'spexcode.json'))
    const local = readJsonConfig(join(root, 'spexcode.local.json'))
    const merged = { ...(portable.sessions?.launchers ?? {}), ...(local.sessions?.launchers ?? {}) }
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
  const isWsl = platform() === 'linux' && (() => { try { return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8')) || !!process.env.WSL_DISTRO_NAME } catch { return !!process.env.WSL_DISTRO_NAME } })()
  if (isWsl) {
    const path = join(homedir(), '.wslconfig')
    let limitBytes: number | null = null
    try {
      const match = readFileSync(path, 'utf8').match(/^memory\s*=\s*([0-9]+)([KMG]B)?/im)
      if (match) limitBytes = Number(match[1]) * ({ KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 } as any)[match[2]?.toUpperCase() || 'MB']
    } catch {}
    return { kind: 'wslconfig', present: existsSync(path), path, limitBytes }
  }
  for (const path of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const raw = readFileSync(path, 'utf8').trim()
      return { kind: 'cgroup', present: true, path, limitBytes: raw === 'max' ? null : Number(raw) || null }
    } catch {}
  }
  return { kind: 'unknown', present: false, path: null, limitBytes: null }
}

export function collectHostFacts(roots = discoverRoots()): HostFacts {
  const isWsl = platform() === 'linux' && (() => { try { return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8')) || !!process.env.WSL_DISTRO_NAME } catch { return !!process.env.WSL_DISTRO_NAME } })()
  const runtime = platform() === 'darwin'
    ? { kind: 'darwin' as const, label: 'darwin' }
    : isWsl ? { kind: 'wsl2' as const, label: 'wsl2', distro: process.env.WSL_DISTRO_NAME || undefined }
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

export function formatHostFacts(facts: HostFacts): string {
  const lines = [`Host facts`, `host: ${facts.host.kind} (${facts.host.reason})`, `runtime: ${facts.runtime.label}${facts.runtime.distro ? ` (${facts.runtime.distro})` : ''}`, `node: ${facts.versions.node}`, `tmux: ${facts.versions.tmux || 'missing'}`, `git: ${facts.versions.git || 'missing'}`]
  for (const [name, value] of Object.entries(facts.agents)) lines.push(`${name}: ${value.installed ? 'installed' : 'missing'}; ${value.loggedIn ? 'logged in' : 'not logged in'}`)
  lines.push(`memory: ${facts.memory.kind} ${facts.memory.present ? 'present' : 'missing'}${facts.memory.limitBytes ? ` (${facts.memory.limitBytes} bytes)` : ''}`)
  lines.push('launchers:')
  for (const launcher of facts.launchers) lines.push(`  ${launcher.project}/${launcher.name}: ${launcher.resolves ? `resolves (${launcher.binary})` : 'BROKEN'} — ${launcher.cmd}`)
  return lines.join('\n')
}
