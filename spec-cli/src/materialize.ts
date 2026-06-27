import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { loadSystemConfig } from './specs.js'
import { compileManifest } from './hooks.js'

// @@@ materialize - the "pay-per-change" node step (≈0.85s) the cheap shell gate invokes ONLY when the
// .config content-hash moved. It renders the spec tree's surface nodes into the flat artifacts each
// consumer reads cheaply, so a USER-self-launched claude/codex (no SpexCode process in the launch) gets the
// whole system via harness-auto-discovered files: (1) the hook MANIFEST (our dispatcher reads it),
// (2) the CONTRACT as a managed <spexcode> block in AGENTS.md (Codex) + CLAUDE.md (Claude) — user content
// preserved, (3) the thin SHIMS .claude/settings.json + .codex/hooks.json (every event → dispatch.sh),
// (4) the Codex TRUST (deterministic trusted_hash) written additively to global ~/.codex/config.toml so the
// self-launch is zero-prompt. All writes are idempotent + scoped. The content-hash marker is stamped last.

const PKG = fileURLToPath(new URL('..', import.meta.url))                 // installed spec-cli root
const DISPATCH = join(PKG, 'hooks', 'dispatch.sh')
const SPEX = `${join(PKG, 'node_modules', '.bin', 'tsx')} ${join(PKG, 'src', 'cli.ts')}`
const RUNTIME = '.spexcode'                                              // gitignored per-project runtime dir

// Claude binds the full lifecycle; Codex lacks StopFailure/Notification (use notify) — only the shared events.
const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification']
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
// Codex trust keys + the hash use snake_case event labels (codex hook_event_key_label).
const SNAKE: Record<string, string> = {
  SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use', Stop: 'stop',
}

const START = '<!-- spexcode:start -->'
const END = '<!-- spexcode:end -->'

// @@@ managed block - idempotent replace of the content between markers; the user's own content is preserved.
export function writeManagedBlock(file: string, body: string): void {
  const block = `${START}\n${body}\n${END}`
  let cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const re = new RegExp(`${START}[\\s\\S]*?${END}`)
  if (re.test(cur)) cur = cur.replace(re, block)
  else cur = cur.trim() ? `${cur.replace(/\n*$/, '')}\n\n${block}\n` : `${block}\n`
  writeFileSync(file, cur)
}

// the shim for one harness: every event → `SPEX='…' bash <dispatch> <Event>` (SPEX inherited by cli-needing handlers).
function shim(events: string[]): { json: string; cmd: (e: string) => string } {
  const cmd = (e: string) => `SPEX='${SPEX}' bash ${DISPATCH} ${e}`
  const hooks: Record<string, unknown> = {}
  for (const e of events) hooks[e] = [{ hooks: [{ type: 'command', command: cmd(e) }] }]
  return { json: JSON.stringify({ hooks }, null, 2), cmd }
}

// @@@ codexHookHash - the trusted_hash codex computes (reverse-engineered from codex-rs:
// command_hook_hash + version_for_toml, verified against live samples): sha256 of the canonical (recursively
// key-sorted, compact) JSON of {event_name, hooks:[{type,command,timeout,async}]}; None fields omitted.
export function codexHookHash(snakeEvent: string, command: string, timeout = 600, asyncFlag = false): string {
  const canon = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : Array.isArray(v) ? v.map(canon) : v
  const obj = { event_name: snakeEvent, hooks: [{ type: 'command', command, timeout, async: asyncFlag }] }
  const serialized = JSON.stringify(canon(obj))
  return 'sha256:' + createHash('sha256').update(serialized).digest('hex')
}

// @@@ writeCodexTrust - additively stamp directory + per-hook trust into the user's GLOBAL ~/.codex/config.toml
// so a user-self-launched codex skips the trust prompts (per A: trust is global-only by codex's security
// design). Scoped to THIS project path; replaces our own prior block (between sentinels) idempotently; never
// touches the user's other config. CODEX_HOME respected for testability.
export function writeCodexTrust(proj: string, codexEvents: string[], cmdFor: (e: string) => string): void {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  const file = join(home, 'config.toml')
  const hooksJson = join(proj, '.codex', 'hooks.json')
  const lines = [`[projects."${proj}"]`, 'trust_level = "trusted"']
  for (const e of codexEvents) {
    const snake = SNAKE[e]
    lines.push(`[hooks.state."${hooksJson}:${snake}:0:0"]`, `trusted_hash = "${codexHookHash(snake, cmdFor(e))}"`)
  }
  const blk = `# spexcode:trust:${proj} (managed — do not edit)\n${lines.join('\n')}\n# spexcode:trust:end:${proj}`
  let cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const re = new RegExp(`# spexcode:trust:${proj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(managed[\\s\\S]*?# spexcode:trust:end:${proj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  if (re.test(cur)) cur = cur.replace(re, blk)
  else cur = cur.trim() ? `${cur.replace(/\n*$/, '')}\n\n${blk}\n` : `${blk}\n`
  if (!existsSync(home)) mkdirSync(home, { recursive: true })
  writeFileSync(file, cur)
}

// the deterministic content fingerprint of the config roots — MUST match the shell gate (dispatch.sh).
export function contentHash(proj: string): string {
  try {
    const out = execFileSync('bash', ['-c',
      `cd "${proj}" && find .spec/*/.config .spec/*/config \\( -name '*.md' -o -name '*.sh' \\) -type f -print0 2>/dev/null | sort -z | xargs -0 cat 2>/dev/null | sha256sum | cut -d' ' -f1`,
    ]).toString().trim()
    return out
  } catch { return '' }
}

// the whole pay-per-change render. proj defaults to cwd. Returns the new content-hash it stamped.
export function materialize(proj = process.cwd()): string {
  mkdirSync(join(proj, RUNTIME), { recursive: true })
  // (1) hook manifest (persistent — the dispatcher reads it; regenerated only here, on change).
  writeFileSync(join(proj, RUNTIME, 'hooks-manifest'), compileManifest())
  // (2) contract = the surface:system bodies, in name order, as a managed block in AGENTS.md + CLAUDE.md.
  const contract = loadSystemConfig().map((c) => c.body.trim()).filter(Boolean).join('\n\n')
  if (contract) { writeManagedBlock(join(proj, 'AGENTS.md'), contract); writeManagedBlock(join(proj, 'CLAUDE.md'), contract) }
  // (3) thin shims → dispatch.sh.
  const claude = shim(CLAUDE_EVENTS); mkdirSync(join(proj, '.claude'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'settings.json'), claude.json)
  const codex = shim(CODEX_EVENTS); mkdirSync(join(proj, '.codex'), { recursive: true })
  writeFileSync(join(proj, '.codex', 'hooks.json'), codex.json)
  // (4) Codex trust (global, scoped, additive) → zero-prompt self-launch.
  writeCodexTrust(proj, CODEX_EVENTS, codex.cmd)
  // (5) stamp the content-hash marker LAST (so a crash mid-render leaves it stale → re-renders next gate).
  const h = contentHash(proj)
  writeFileSync(join(proj, RUNTIME, 'content-hash'), h)
  return h
}
