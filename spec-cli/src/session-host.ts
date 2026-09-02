import { spawn, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { processStartToken, runtimeRoot, sessionArtifactPath, sessionStoreDir, type ProcessIdentity } from '@spexcode/spec-core'
import {
  TMUX_SOCK,
  TMUX_PROBE_TIMEOUT_MS,
  TARGET_PROBE_TIMEOUT_MS,
  TARGET_TMUX_CLOSE_SETTLE_MS,
  tmux,
  probeTimedOut,
} from './session-tmux.js'

export interface SessionHost {
  readonly kind: 'tmux-host' | 'process-host'
  readonly socket: string
  launch(id: string, command: string, cwdOrEnv: string | NodeJS.ProcessEnv, env?: NodeJS.ProcessEnv): Promise<void>
  alive(id: string, timeoutMs?: number): Promise<boolean>
  stop(id: string): Promise<void>
  witness(id: string): string | ProcessIdentity | null
  attach?(id: string): number
  sendKeys?(id: string, args: string[]): Promise<void>
  command(args: string[], timeoutMs?: number): Promise<string>
  isSharedProcess(command: string): boolean
}

export const tmuxHost: SessionHost = {
  kind: 'tmux-host',
  socket: TMUX_SOCK,
  async launch(id, command, cwdOrEnv) {
    const cwd = typeof cwdOrEnv === 'string' ? cwdOrEnv : process.cwd()
    await tmux(['new-session', '-d', '-s', id, '-x', '120', '-y', '32', '-c', cwd])
    await tmux(['send-keys', '-t', id, '-l', '--', command])
    await tmux(['send-keys', '-t', id, 'Enter'])
  },
  async alive(id, timeoutMs = TMUX_PROBE_TIMEOUT_MS) {
    await tmux(['has-session', '-t', id], timeoutMs)
    return true
  },
  async stop(id) {
    try { await tmux(['kill-session', '-t', id]) } catch { /* absent is handled by the caller's witness */ }
  },
  witness(id) { return id },
  attach(id) {
    return spawnSync('tmux', ['-u', '-L', TMUX_SOCK, 'attach-session', '-t', id], { stdio: 'inherit' }).status ?? 1
  },
  async sendKeys(id, args) {
    await tmux(['send-keys', '-t', id, ...args])
  },
  command(args, timeoutMs) { return tmux(args, timeoutMs) },
  isSharedProcess(command) { return command === 'tmux: server' },
}

const processIdentityPath = (id: string) => sessionArtifactPath(id, 'host.identity.json')
const readProcessIdentity = (id: string): ProcessIdentity | null => {
  try {
    const value = JSON.parse(readFileSync(processIdentityPath(id), 'utf8')) as Record<string, unknown>
    if (!Number.isSafeInteger(value.pid) || (value.pid as number) <= 0 || typeof value.startToken !== 'string' || !value.startToken) return null
    return { pid: value.pid as number, startToken: value.startToken }
  } catch { return null }
}
const readAgentIdentity = (id: string): ProcessIdentity | null => {
  try {
    const pid = Number(readFileSync(sessionArtifactPath(id, 'agent.pid'), 'utf8').trim())
    const startToken = processStartToken(pid)
    return Number.isSafeInteger(pid) && pid > 0 && startToken ? { pid, startToken } : null
  } catch { return null }
}
export function hostControlSocket(prefix: string, id: string): string {
  const suffix = Buffer.from(`${runtimeRoot()}\0${id}`).toString('hex').slice(0, 24)
  return process.platform === 'win32' ? `\\\\.\\pipe\\spexcode-${prefix}-${suffix}` : join(tmpdir(), `spexcode-${prefix}-${id}.sock`)
}

export const processHost: SessionHost = {
  kind: 'process-host',
  // process-host has no shared control endpoint; this field remains a stable diagnostic label for settings.
  socket: process.platform === 'win32' ? '\\\\.\\pipe\\spexcode-process-host' : 'process-host',
  async launch(id, command, cwdOrEnv, env) {
    const cwd = typeof cwdOrEnv === 'string' ? cwdOrEnv : process.cwd()
    const launchEnv = typeof cwdOrEnv === 'string' ? env : cwdOrEnv
    const dir = sessionStoreDir(id)
    mkdirSync(dir, { recursive: true })
    const stdout = openSync(join(dir, 'stdout.log'), 'a', 0o600)
    const stderr = openSync(join(dir, 'stderr.log'), 'a', 0o600)
    let child: ReturnType<typeof spawn>
    try {
      const options = { cwd, env: launchEnv ?? process.env, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr] as (string | number)[] }
      child = process.platform === 'win32'
        ? spawn(command, { ...options, shell: true } as any)
        : spawn('/bin/sh', ['-lc', `exec ${command}`], options as any)
    } finally {
      closeSync(stdout)
      closeSync(stderr)
    }
    child.once('error', () => {})
    if (!child.pid) throw new Error(`could not spawn detached process-host session ${id}`)
    const startToken = processStartToken(child.pid)
    if (!startToken) {
      try { child.kill('SIGTERM') } catch {}
      throw new Error(`could not identify detached process-host session ${id} PID ${child.pid}`)
    }
    // launch.sh registers the real leaf before exec. Prefer that identity so stop targets the agent itself;
    // direct host callers without the registration fall back to the detached child we spawned.
    let identity = { pid: child.pid, startToken }
    for (let attempt = 0; attempt < 10; attempt++) {
      const agent = readAgentIdentity(id)
      if (agent) { identity = agent; break }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    mkdirSync(dirname(processIdentityPath(id)), { recursive: true })
    writeFileSync(processIdentityPath(id), `${JSON.stringify(identity)}\n`, { mode: 0o600 })
    child.unref()
  },
  async alive(id) {
    const identity = readProcessIdentity(id)
    return !!identity && processStartToken(identity.pid) === identity.startToken
  },
  async stop(id) {
    const identity = readProcessIdentity(id)
    if (!identity || processStartToken(identity.pid) !== identity.startToken) return
    try { process.kill(identity.pid, 'SIGTERM') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  },
  witness(id) {
    return readProcessIdentity(id)
  },
  async command() { throw new Error('process-host has no tmux command surface') },
  isSharedProcess() { return false },
}

export function selectSessionHost(has = hasTmux()): SessionHost {
  if (has) return tmuxHost
  return processHost
}

export function hasTmux(): boolean {
  try { return spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0 } catch { return false }
}

// Runtime boot performs the loud capability check. Keeping the accessor transport-pure preserves the old
// lifecycle behavior in narrow teardown paths (a missing tmux binary is treated as an ordinary failed command,
// allowing ownership guards to report their precise refusal first).
let cachedHostPath: string | undefined
let cachedHost: SessionHost | undefined
// Host capability is stable for a backend lifetime. Cache the probe so lifecycle polling does not turn
// every snapshot into a synchronous `tmux -V` invocation (and so tmux-host traces retain phase-1 parity).
export function sessionHost(): SessionHost {
  const path = process.env.PATH || ''
  if (!cachedHost || cachedHostPath !== path) {
    cachedHostPath = path
    cachedHost = selectSessionHost()
  }
  return cachedHost
}
export { TMUX_SOCK, TMUX_PROBE_TIMEOUT_MS, TARGET_PROBE_TIMEOUT_MS, TARGET_TMUX_CLOSE_SETTLE_MS, probeTimedOut }
