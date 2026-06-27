import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { claudeSlashCommands, codexSlashCommands, type SlashCommand } from './slash-commands.js'

// @@@ harness-adapter - the ONE seam between SpexCode and the coding-agent harness (Claude Code, Codex, …).
// Every harness-specific fact lives behind THIS interface with one implementation per harness; product code
// (materialize, sessions, slash, the hook scripts) never branches on which harness it is — it resolves an
// adapter ONCE and calls it. The only `if (codex)` / `if (claude)` in the whole product is the detector that
// picks the adapter (here), plus its shell mirror in hooks/harness.sh (shell cannot import this module).
//
// DETECTION. There is no payload-sniffing: each adapter OWNS its shim, and the shim bakes the harness id as
// dispatch.sh's first argument (`bash <dispatch> <id> <Event>`). dispatch.sh exports SPEXCODE_HARNESS, so a
// hook subprocess learns its harness deterministically from the shim that wired it — never from guessing the
// payload shape. On the TS side the harness is the launcher's choice (the dashboard launches `defaultHarness`)
// or ALL adapters at once (materialize renders every harness's artifacts).

export type HarnessId = 'claude' | 'codex'

export interface Harness {
  readonly id: HarnessId
  // the lifecycle events this harness fires (drives the shim + the trust hashes). Claude binds the full set;
  // Codex lacks StopFailure + Notification, so it never sees those.
  readonly events: readonly string[]
  // whether the harness manages its own worktrees (Claude `--worktree`); if false SpexCode owns them (Codex).
  readonly ownsWorktrees: boolean

  // --- launch / sessionId ---
  // the base agent command (env-overridable for tests). Claude: `claude …`; Codex: `codex --yolo`.
  launchCmd(): string
  // the flag that pins the session id at launch. Claude lets the caller choose (`--session-id <id>`); Codex
  // assigns its own, so there is nothing to pass (the id is captured/resumed afterwards).
  sessionIdArg(id: string): string
  // the env var the agent's OWN process carries so its `spex …` calls know their session id.
  readonly sessionEnvVar: string

  // --- materialize: shim + contract + trust ([[harness-delivery]]) ---
  // the auto-discovered hook shim file for this harness (.claude/settings.json vs .codex/hooks.json).
  shimFile(proj: string): string
  // the contract file(s) the `surface: system` block is folded into. Claude: ./CLAUDE.md; Codex: ONLY ./AGENTS.md.
  contractFiles(proj: string): string[]
  // the shim payload: the settings/hooks JSON binding every event → the dispatcher (harness id baked in), and
  // the per-event command string (shared with the trust writer so they hash identically).
  shim(dispatch: string, spex: string): { json: string; cmd: (e: string) => string }
  // make a user-self-launched agent run the hooks with zero prompts. Codex writes a deterministic trusted_hash
  // into the GLOBAL ~/.codex/config.toml (codex's security model: trust is global-only); Claude is a no-op
  // (it relies on folder-trust). `cmdFor` MUST be the same per-event command the shim emitted.
  writeTrust(proj: string, cmdFor: (e: string) => string): void

  // --- the `/` menu ---
  // the slash-command list, computed the way THIS harness computes its own `/` menu.
  slashCommands(): SlashCommand[]
}

const START = '<!-- spexcode:start -->'
const END = '<!-- spexcode:end -->'

// idempotent replace of the content between markers; the user's own content is preserved. (Shared by both
// adapters' contract files; lives here since it is the contract-delivery mechanism, harness-agnostic.)
export function writeManagedBlock(file: string, body: string): void {
  const block = `${START}\n${body}\n${END}`
  let cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const re = new RegExp(`${START}[\\s\\S]*?${END}`)
  if (re.test(cur)) cur = cur.replace(re, block)
  else cur = cur.trim() ? `${cur.replace(/\n*$/, '')}\n\n${block}\n` : `${block}\n`
  writeFileSync(file, cur)
}

// the shim for one harness: every event → `SPEX='…' bash <dispatch> <harnessId> <Event>`. The harness id is
// baked in so dispatch.sh can export SPEXCODE_HARNESS (the detector for the shell side). SPEX is inherited by
// the cli-needing handlers + the gate's `spex materialize`.
function buildShim(id: HarnessId, events: readonly string[], dispatch: string, spex: string): { json: string; cmd: (e: string) => string } {
  const cmd = (e: string) => `SPEX='${spex}' bash ${dispatch} ${id} ${e}`
  const hooks: Record<string, unknown> = {}
  for (const e of events) hooks[e] = [{ hooks: [{ type: 'command', command: cmd(e) }] }]
  return { json: JSON.stringify({ hooks }, null, 2), cmd }
}

// ---------------------------------------------------------------------------------------------------------
// Codex trust — the codex-rs trusted_hash, reverse-engineered + pinned. Lives in the Codex adapter (it is a
// codex-only fact); Claude has no analog.

// Codex trust keys + the hash use snake_case event labels (codex hook_event_key_label).
const SNAKE: Record<string, string> = {
  SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use', Stop: 'stop',
}

// @@@ codexHookHash - the trusted_hash codex computes (from codex-rs: command_hook_hash + version_for_toml):
// sha256 of the canonical (recursively key-sorted, compact) JSON of {event_name, hooks:[{type,command,timeout,
// async}]}; None fields omitted. Verified against live codex 0.142.3 samples.
export function codexHookHash(snakeEvent: string, command: string, timeout = 600, asyncFlag = false): string {
  const canon = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : Array.isArray(v) ? v.map(canon) : v
  const obj = { event_name: snakeEvent, hooks: [{ type: 'command', command, timeout, async: asyncFlag }] }
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canon(obj))).digest('hex')
}

// additively stamp directory + per-hook trust into the user's GLOBAL ~/.codex/config.toml so a user-self-
// launched codex skips the trust prompts. Scoped to THIS project path; replaces our own prior block (between
// sentinels) idempotently; never touches the user's other config. CODEX_HOME respected for testability.
function writeCodexTrust(proj: string, events: readonly string[], cmdFor: (e: string) => string): void {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  const file = join(home, 'config.toml')
  const hooksJson = join(proj, '.codex', 'hooks.json')
  const lines = [`[projects."${proj}"]`, 'trust_level = "trusted"']
  for (const e of events) {
    const snake = SNAKE[e]
    lines.push(`[hooks.state."${hooksJson}:${snake}:0:0"]`, `trusted_hash = "${codexHookHash(snake, cmdFor(e))}"`)
  }
  const blk = `# spexcode:trust:${proj} (managed — do not edit)\n${lines.join('\n')}\n# spexcode:trust:end:${proj}`
  const esc = proj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const re = new RegExp(`# spexcode:trust:${esc} \\(managed[\\s\\S]*?# spexcode:trust:end:${esc}`)
  if (re.test(cur)) cur = cur.replace(re, blk)
  else cur = cur.trim() ? `${cur.replace(/\n*$/, '')}\n\n${blk}\n` : `${blk}\n`
  if (!existsSync(home)) mkdirSync(home, { recursive: true })
  writeFileSync(file, cur)
}

// ---------------------------------------------------------------------------------------------------------
// the two implementations.

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification'] as const
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

export const claudeHarness: Harness = {
  id: 'claude',
  events: CLAUDE_EVENTS,
  ownsWorktrees: true,                               // Claude has a native --worktree + WorktreeCreate/Remove hooks
  launchCmd: () => process.env.SPEXCODE_CLAUDE_CMD || 'claude --dangerously-skip-permissions',
  sessionIdArg: (id) => `--session-id ${id}`,        // the caller chooses the id
  sessionEnvVar: 'CLAUDE_CODE_SESSION_ID',
  shimFile: (proj) => join(proj, '.claude', 'settings.json'),
  contractFiles: (proj) => [join(proj, 'CLAUDE.md')],
  shim: (dispatch, spex) => buildShim('claude', CLAUDE_EVENTS, dispatch, spex),
  writeTrust: () => { /* Claude relies on folder-trust — nothing to write */ },
  slashCommands: claudeSlashCommands,
}

export const codexHarness: Harness = {
  id: 'codex',
  events: CODEX_EVENTS,
  ownsWorktrees: false,                              // Codex has no worktree primitive — SpexCode manages it
  launchCmd: () => process.env.SPEXCODE_CODEX_CMD || 'codex --yolo',
  sessionIdArg: () => '',                            // codex assigns its own id (resumed by a captured id)
  sessionEnvVar: 'CODEX_THREAD_ID',
  shimFile: (proj) => join(proj, '.codex', 'hooks.json'),
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],
  shim: (dispatch, spex) => buildShim('codex', CODEX_EVENTS, dispatch, spex),
  writeTrust: (proj, cmdFor) => writeCodexTrust(proj, CODEX_EVENTS, cmdFor),
  slashCommands: codexSlashCommands,
}

// every adapter — materialize iterates this to render each harness's artifacts in one pass.
export const HARNESSES: readonly Harness[] = [claudeHarness, codexHarness]

// the harness the dashboard/CLI launcher drives today (Claude). The single place a future codex launcher
// would flip; product code reads this rather than naming Claude.
export const defaultHarness: Harness = claudeHarness

// resolve an adapter by id (the detector). Throws on an unknown id — fail loud, never silently default.
export function harnessById(id: string): Harness {
  const h = HARNESSES.find((x) => x.id === id)
  if (!h) throw new Error(`unknown harness '${id}' (known: ${HARNESSES.map((x) => x.id).join(', ')})`)
  return h
}
