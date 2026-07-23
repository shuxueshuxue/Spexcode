import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DispatchResult, HarnessDeliveryRecord } from './harness.js'

const pexec = promisify(execFile)

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// A headless turn owns the pane only while `opencode run` is alive. Returning to a shell keeps the tmux
// window as the session's durable home without adding a resident controller or an stdin bridge.
function turnHome(command: string): string {
  const script = [
    command,
    '__spex_rc=$?',
    '[ "$__spex_rc" -eq 0 ] || printf "[spex opencode-headless] turn exited rc=%s\\n" "$__spex_rc" >&2',
    'exec "${SHELL:-/bin/sh}"',
  ].join('\n')
  return `bash -lc ${shQuote(script)} spexcode-opencode-headless`
}

export function opencodeHeadlessLaunchCommand(opencodeCmd = 'opencode'): string {
  const script = [
    'if [ "${1:-}" = "--resume" ]; then',
    '  export SPEXCODE_OPENCODE_RESUME_ID="$2"',
    '  unset SPEXCODE_OPENCODE_CONTINUE',
    `  ${opencodeCmd} run --session "$2"`,
    'elif [ "${1:-}" = "--continue" ]; then',
    '  unset SPEXCODE_OPENCODE_RESUME_ID',
    '  export SPEXCODE_OPENCODE_CONTINUE=1',
    `  ${opencodeCmd} run --continue`,
    'elif [ -n "${1:-}" ]; then',
    '  unset SPEXCODE_OPENCODE_RESUME_ID SPEXCODE_OPENCODE_CONTINUE',
    `  ${opencodeCmd} run "$1"`,
    'else',
    `  ${opencodeCmd} run`,
    'fi',
  ].join('\n')
  return turnHome(script)
}

export function opencodeHeadlessWakeCommand(opencodeCmd: string, harnessSessionId: string | null | undefined, text: string): string {
  const resume = harnessSessionId
    ? `export SPEXCODE_OPENCODE_RESUME_ID=${shQuote(harnessSessionId)}; unset SPEXCODE_OPENCODE_CONTINUE; ${opencodeCmd} run --session ${shQuote(harnessSessionId)} ${shQuote(text)}`
    : `unset SPEXCODE_OPENCODE_RESUME_ID; export SPEXCODE_OPENCODE_CONTINUE=1; ${opencodeCmd} run --continue ${shQuote(text)}`
  return turnHome(resume)
}

export async function spawnOpenCodeHeadlessTurn(
  rec: HarnessDeliveryRecord,
  text: string,
  opencodeCmd: string,
  socketPath: string,
): Promise<DispatchResult> {
  if (!rec.worktreePath) return { ok: false, error: `opencode-headless session ${rec.session} has no worktree path - turn NOT started` }
  const tmuxSock = process.env.SPEXCODE_TMUX || 'spexcode'
  const args = [
    '-L', tmuxSock, 'respawn-pane', '-k', '-t', rec.session, '-c', rec.worktreePath,
    '-e', `SPEXCODE_SESSION_ID=${rec.session}`,
    '-e', 'CLAUDE_BG_BACKEND=daemon',
    '-e', `CLAUDE_BG_RENDEZVOUS_SOCK=${socketPath}`,
  ]
  for (const name of ['SPEXCODE_HOME', 'CODEX_HOME']) {
    const value = process.env[name]
    if (value) args.push('-e', `${name}=${value}`)
  }
  args.push(opencodeHeadlessWakeCommand(opencodeCmd, rec.harnessSessionId, text))
  try {
    await pexec('tmux', args, { timeout: 5_000 })
    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `opencode-headless could not start a turn for session ${rec.session}: ${detail}` }
  }
}
