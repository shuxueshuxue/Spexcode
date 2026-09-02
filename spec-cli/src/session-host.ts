import { spawnSync } from 'node:child_process'
import {
  TMUX_SOCK,
  TMUX_PROBE_TIMEOUT_MS,
  TARGET_PROBE_TIMEOUT_MS,
  TARGET_TMUX_CLOSE_SETTLE_MS,
  tmux,
  probeTimedOut,
} from './session-tmux.js'

export interface SessionHost {
  readonly kind: 'tmux-host'
  readonly socket: string
  launch(id: string, command: string, cwd: string): Promise<void>
  alive(id: string, timeoutMs?: number): Promise<boolean>
  stop(id: string): Promise<void>
  witness(id: string): string
  attach?(id: string): number
  sendKeys?(id: string, args: string[]): Promise<void>
  command(args: string[], timeoutMs?: number): Promise<string>
  isSharedProcess(command: string): boolean
}

export const tmuxHost: SessionHost = {
  kind: 'tmux-host',
  socket: TMUX_SOCK,
  async launch(id, command, cwd) {
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

export function selectSessionHost(has = hasTmux()): SessionHost {
  if (has) return tmuxHost
  throw new Error('spex: no supported session host is available (tmux is not on PATH)')
}

export function hasTmux(): boolean {
  try { return spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0 } catch { return false }
}

// Runtime boot performs the loud capability check. Keeping the accessor transport-pure preserves the old
// lifecycle behavior in narrow teardown paths (a missing tmux binary is treated as an ordinary failed command,
// allowing ownership guards to report their precise refusal first).
export function sessionHost(): SessionHost { return tmuxHost }
export { TMUX_SOCK, TMUX_PROBE_TIMEOUT_MS, TARGET_PROBE_TIMEOUT_MS, TARGET_TMUX_CLOSE_SETTLE_MS, probeTimedOut }
