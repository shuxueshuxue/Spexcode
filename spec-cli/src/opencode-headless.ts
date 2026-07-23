import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { DispatchResult, HarnessDeliveryRecord } from './harness.js'

const pexec = promisify(execFile)
const SPEX = join(fileURLToPath(new URL('..', import.meta.url)), 'bin', 'spex.mjs')
const WAKE_EARLY_EXIT_MS = 5_000
const OUTCOME_POLL_MS = 25

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const turnFailureShell = (swallow: boolean) =>
  `${shQuote(SPEX)} internal session-turn-fail "$SPEXCODE_SESSION_ID" ${shQuote('opencode-headless')} "$__spex_rc"${swallow ? ' || true' : ''}`

function accountLoginShell(): string {
  try { return userInfo().shell || '' } catch { return '' }
}

// A headless turn owns the pane only while `opencode run` is alive. Returning to a shell keeps the tmux
// window as the session's durable home without adding a resident controller or an stdin bridge.
function turnHome(command: string, outcomePath?: string): string {
  const outcomeSetup = outcomePath ? [
    `__spex_outcome_path=${shQuote(outcomePath)}`,
    `__spex_outcome_tmp=${shQuote(`${outcomePath}.tmp`)}`,
    '__spex_outcome() { printf \'%s\\n\' "$1" > "$__spex_outcome_tmp" && mv -f "$__spex_outcome_tmp" "$__spex_outcome_path"; }',
    '__spex_outcome "running:$$" || { printf "[spex opencode-headless] could not create turn outcome marker\\n" >&2; exit 125; }',
  ] : []
  const failure = outcomePath ? [
    '__spex_cas_rc=0',
    'if [ "$__spex_rc" -ne 0 ]; then',
    '  __spex_outcome "reporting:$$:$__spex_rc" || true',
    `  ${turnFailureShell(false)}`,
    '  __spex_cas_rc=$?',
    'fi',
    '__spex_outcome "exit:$__spex_rc:cas:$__spex_cas_rc" || printf "[spex opencode-headless] could not finalize turn outcome marker\\n" >&2',
  ] : [
    `if [ "$__spex_rc" -ne 0 ]; then ${turnFailureShell(true)}; fi`,
  ]
  const script = [
    ...outcomeSetup,
    command,
    '__spex_rc=$?',
    ...failure,
    '[ "$__spex_rc" -eq 0 ] || printf "[spex opencode-headless] turn exited rc=%s\\n" "$__spex_rc" >&2',
    'exec "${SHELL:-/bin/sh}"',
  ].join('\n')
  return `bash -lc ${shQuote(script)} spexcode-opencode-headless`
}

// Launcher profiles carry a base executable plus its configured flags (`opencode --auto`). OpenCode parses
// `run` as a subcommand, so it must sit between those two halves (`opencode run --auto`), not at the tail.
function runPrelude(opencodeCmd: string): string[] {
  const accountShell = accountLoginShell()
  return [
    '__spex_login_shell="${SHELL:-}"',
    `[ -n "$__spex_login_shell" ] || __spex_login_shell=${shQuote(accountShell)}`,
    `__spex_cmd=(${opencodeCmd})`,
    '__spex_env=()',
    'while [ "${#__spex_cmd[@]}" -gt 0 ] && [[ "${__spex_cmd[0]}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do',
    '  __spex_env+=("${__spex_cmd[0]}")',
    '  __spex_cmd=("${__spex_cmd[@]:1}")',
    'done',
    // Resolve OpenCode in the same login + interactive environment the user relies on. The launcher-leading
    // assignments are applied after shell startup, so its explicit per-session config still wins.
    '__spex_run() { [ -n "$__spex_login_shell" ] || { printf "[spex opencode-headless] no login shell could be resolved - turn NOT started\\n" >&2; return 126; }; "$__spex_login_shell" -ilc \'exec env "$@"\' spexcode-opencode-headless "${__spex_env[@]}" "${__spex_cmd[0]}" run "${__spex_cmd[@]:1}" "$@"; }',
  ]
}

export function opencodeHeadlessLaunchCommand(opencodeCmd = 'opencode'): string {
  const script = [
    ...runPrelude(opencodeCmd),
    'if [ "${1:-}" = "--resume" ]; then',
    '  export SPEXCODE_OPENCODE_RESUME_ID="$2"',
    '  unset SPEXCODE_OPENCODE_CONTINUE',
    '  __spex_run --session "$2"',
    'elif [ "${1:-}" = "--continue" ]; then',
    '  unset SPEXCODE_OPENCODE_RESUME_ID',
    '  export SPEXCODE_OPENCODE_CONTINUE=1',
    '  __spex_run --continue',
    'elif [ -n "${1:-}" ]; then',
    '  unset SPEXCODE_OPENCODE_RESUME_ID SPEXCODE_OPENCODE_CONTINUE',
    '  __spex_run "$1"',
    'else',
    '  __spex_run',
    'fi',
  ].join('\n')
  return turnHome(script)
}

export function opencodeHeadlessWakeCommand(
  opencodeCmd: string,
  harnessSessionId: string | null | undefined,
  text: string,
  outcomePath?: string,
): string {
  const resume = harnessSessionId ? [
    `export SPEXCODE_OPENCODE_RESUME_ID=${shQuote(harnessSessionId)}`,
    'unset SPEXCODE_OPENCODE_CONTINUE',
    `__spex_run --session ${shQuote(harnessSessionId)} ${shQuote(text)}`,
  ] : [
    'unset SPEXCODE_OPENCODE_RESUME_ID',
    'export SPEXCODE_OPENCODE_CONTINUE=1',
    `__spex_run --continue ${shQuote(text)}`,
  ]
  return turnHome([...runPrelude(opencodeCmd), ...resume].join('\n'), outcomePath)
}

type TurnOutcome =
  | { state: 'running'; pid: number }
  | { state: 'reporting'; pid: number; code: number }
  | { state: 'exit'; code: number; casCode: number }
  | { state: 'invalid' }

function readTurnOutcome(path: string): TurnOutcome | undefined {
  let value: string
  try { value = readFileSync(path, 'utf8').trim() } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let match = /^running:(\d+)$/.exec(value)
  if (match) return { state: 'running', pid: Number(match[1]) }
  match = /^reporting:(\d+):(-?\d+)$/.exec(value)
  if (match) return { state: 'reporting', pid: Number(match[1]), code: Number(match[2]) }
  match = /^exit:(-?\d+):cas:(\d+)$/.exec(value)
  if (match) return { state: 'exit', code: Number(match[1]), casCode: Number(match[2]) }
  return { state: 'invalid' }
}

function turnExited(rec: HarnessDeliveryRecord, outcome: Extract<TurnOutcome, { state: 'exit' }>): DispatchResult {
  if (outcome.code === 0) return { ok: true }
  const cas = outcome.casCode === 0 ? '' : `; error CAS reporter also exited with code ${outcome.casCode}`
  return {
    ok: false,
    error: `opencode-headless turn exited with code ${outcome.code} during startup for session ${rec.session}${cas} - prompt delivery FAILED`,
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function spawnOpenCodeHeadlessTurn(
  rec: HarnessDeliveryRecord,
  text: string,
  opencodeCmd: string,
  socketPath: string,
): Promise<DispatchResult> {
  if (!rec.worktreePath) return { ok: false, error: `opencode-headless session ${rec.session} has no worktree path - turn NOT started` }
  let outcomeDir: string
  try { outcomeDir = mkdtempSync(join(tmpdir(), 'spexcode-oh-turn-')) } catch (error) {
    return { ok: false, error: `opencode-headless could not prepare turn confirmation for session ${rec.session}: ${(error as Error).message}` }
  }
  const outcomePath = join(outcomeDir, 'exit-code')
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
  args.push(opencodeHeadlessWakeCommand(opencodeCmd, rec.harnessSessionId, text, outcomePath))
  try {
    await pexec('tmux', args, { timeout: 5_000 })
    const deadline = Date.now() + WAKE_EARLY_EXIT_MS
    for (;;) {
      const outcome = readTurnOutcome(outcomePath)
      if (outcome?.state === 'exit') return turnExited(rec, outcome)
      if (outcome?.state === 'invalid') {
        return { ok: false, error: `opencode-headless turn for session ${rec.session} wrote an invalid exit outcome - prompt delivery NOT confirmed` }
      }
      if (Date.now() >= deadline) break
      await sleep(Math.min(OUTCOME_POLL_MS, deadline - Date.now()))
    }

    const first = readTurnOutcome(outcomePath)
    if (first?.state === 'exit') return turnExited(rec, first)
    if (!first) return { ok: false, error: `opencode-headless turn for session ${rec.session} never confirmed startup - prompt delivery FAILED` }
    if (first.state === 'invalid') return { ok: false, error: `opencode-headless turn for session ${rec.session} wrote an invalid exit outcome - prompt delivery NOT confirmed` }
    if (first.state === 'reporting') {
      return { ok: false, error: `opencode-headless turn exited with code ${first.code} but its error CAS reporter did not finish for session ${rec.session} - prompt delivery FAILED` }
    }
    if (!pidAlive(first.pid)) {
      return { ok: false, error: `opencode-headless turn wrapper died before reporting an outcome for session ${rec.session} - prompt delivery FAILED` }
    }
    await sleep(OUTCOME_POLL_MS)
    const settled = readTurnOutcome(outcomePath)
    if (settled?.state === 'exit') return turnExited(rec, settled)
    if (settled?.state !== 'running' || settled.pid !== first.pid || !pidAlive(settled.pid)) {
      return { ok: false, error: `opencode-headless turn did not remain live through startup for session ${rec.session} - prompt delivery FAILED` }
    }
    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `opencode-headless could not start a turn for session ${rec.session}: ${detail}` }
  } finally {
    rmSync(outcomeDir, { recursive: true, force: true })
  }
}
