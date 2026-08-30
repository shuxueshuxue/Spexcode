import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pexec = promisify(execFile)
export const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'

// @@@ tmux probe timeout - under load (the incident: load ~30 + swap thrash) a bare `tmux list-sessions` can
// HANG, and with no bound the whole board assembly hung behind it — the dashboard froze / dropped rows, which
// the human read as "sessions disappeared". So the liveness/title probes pass a bounded timeout; on expiry
// execFile SIGKILLs the child and rejects with `killed:true`, which liveSnapshot tells apart from a clean
// "no server" exit (see probeTimedOut) so a timeout renders `unknown`, not a false `offline`.
export const TMUX_PROBE_TIMEOUT_MS = 4000

// A destructive close already names one target, so it can afford the longer bounded probe without making
// every dashboard refresh wait behind an overloaded tmux server.
export const TARGET_PROBE_TIMEOUT_MS = 15000
export const TARGET_TMUX_CLOSE_SETTLE_MS = 3000
export async function tmux(args: string[], timeoutMs?: number): Promise<string> {
  const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, ...args], { encoding: 'utf8', ...(timeoutMs ? { timeout: timeoutMs, killSignal: 'SIGKILL' as const } : {}) })
  return stdout
}
// a rejected pexec whose child we KILLED (timeout) vs one that exited cleanly non-zero (e.g. tmux "no server
// running" when there are genuinely no sessions). Only the former is a PROBE FAILURE (→ unknown); a clean
// non-zero exit is authoritative (→ everything offline). node sets `killed`/`signal` when it SIGKILLs on timeout.
export function probeTimedOut(e: unknown): boolean {
  const err = e as { killed?: boolean; signal?: string | null; code?: string }
  return err?.killed === true || err?.signal === 'SIGKILL' || err?.code === 'ETIMEDOUT'
}
