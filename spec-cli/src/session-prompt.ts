// @@@ the operand seam - the ONE path a human's words take to reach an agent: composed, made option-safe,
// quoted, and written into the launch script that hands them over. It is one file because the `-` guarantee
// ([[prompt-operand]]) is made once for every harness, and a seam split across two files is a seam with two
// answers. Launch CONFIG — which launcher, whether a launch can succeed at all — is a different question and
// deliberately stayed in the session core; nothing here reads a record to decide it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, loadSpecs, mainRoot, runtimeRoot, sessionStoreDir, type ConfigPreset, type SpecLite } from '@spexcode/spec-core'
import { defaultHarness, harnessById, sessionIdentityEnvVars, type Harness } from './harness.js'
import { LAUNCH_FAST_FAIL_S } from './session-liveness.js'
import { readRecord, type SessRec } from './session-record.js'
import { lastHumanSendVia } from './session-timeline.js'
import { shQuote } from './sh.js'

const HARNESS = defaultHarness
// the session's global store, created on demand — the launch artifacts (the script, agent.pid, the identity
// receipt) live here rather than in the worktree so they never pollute the spec/code work.
function storeDir(id: string): string { const d = sessionStoreDir(id); mkdirSync(d, { recursive: true }); return d }

const rvEnv = (id: string, harness = HARNESS, nativeStartToken?: string | null) => {
  // SPEXCODE_SESSION_ID is the governed record id, and it is the SESSION'S OWN — so the launch STRIPS every
  // session-identity variable it may have inherited (the pane inherits the tmux SERVER's env, which may carry
  // a foreign session's ids from whoever started it) before setting this one. Identity is established HERE,
  // once, at the boundary; nothing downstream re-verifies it, because after this a session-identity variable
  // exists in a process only if that process belongs to that session — either set right here, or stamped by
  // the harness itself for its own acting conversation ([[harness-adapter]]). The same strip runs on the one
  // other process we own that is NOT a session's own — codex's shared app-server, whose leaked inherited id
  // was github#76.
  const scrub = sessionIdentityEnvVars().map((v) => `-u ${v}`)
  const homeVars = ['SPEXCODE_HOME', 'CODEX_HOME'].flatMap((v) => {
    const value = process.env[v]
    return value ? [`${v}=${value}`] : []
  })
  return [...scrub,
    `SPEXCODE_SESSION_ID=${id}`,
    `SPEXCODE_SESSION_IDENTITY_VARS=${shQuote(sessionIdentityEnvVars().join(','))}`,
    `SPEXCODE_PROJECT_ROOT=${shQuote(mainRoot())}`,
    ...(nativeStartToken ? [`SPEXCODE_NATIVE_START_TOKEN=${shQuote(nativeStartToken)}`] : []),
    ...harness.launchEnv(id), ...homeVars].join(' ')
}
export type MsgSender = { id: string; label: string | null }
export function withSenderHint(text: string, sender: MsgSender | null): string {
  if (!sender) return text
  const who = sender.label && sender.label !== sender.id ? `session "${sender.label}" (${sender.id})` : `session ${sender.id}`
  return `${text}\n\n— from ${who}. To reply: spex session send ${sender.id} "<your reply>"`
}
export function withPeerSenderHint(text: string, sender: MsgSender | null, sshAddress: string, machineId: string): string {
  if (!sender) return text
  const who = sender.label && sender.label !== sender.id ? `session "${sender.label}" (${sender.id})` : `session ${sender.id}`
  return `${text}\n\n— from ${who} on machine ${machineId}. To reply: spex session send --ssh ${sshAddress} ${sender.id} "<your reply>"`
}
export const withNoteReplyHint = (text: string): string =>
  `${text}\n\n— REPLY TRANSPORT: This sender cannot read normal assistant output. Before ending this turn, make your FINAL tool call a Spex declaration carrying the COMPLETE reply in --note: use \`session ask\` when waiting for a human reply; use \`done\` or \`park\` when that is the truthful state. This rule applies even when asked to only print/reply or make no tool calls.\n\nFor multi-line replies, preserve real LF characters. \`functions.exec\` runs a shell command through bash, so never interpolate \`JSON.stringify(note)\` into it; use stdin, a heredoc, or base64, then pass \`--note \"$note\"\`. Never use \`String.raw\` or literal backslash+n. Do not call any tool after the declaration.`
export const withTerminalReplyHint = (text: string): string =>
  `${text}\n\n— sent from a terminal-attached client: the sender now reads your terminal output directly. Reply in your normal conversation output from here on — stop putting replies in declaration --notes (the earlier terminal-free notices no longer apply; a --note can go back to being a short status line).`
export const slugify = (s: string | null) =>
  (s || 'session').normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'session'

const MENTION = /\[\[(\.?[\p{L}\p{N}_-]+)\]\]/u
export const nodeFromPrompt = (prompt: string): string | null => prompt.match(MENTION)?.[1] ?? null

type CommandPreset = Pick<ConfigPreset, 'name' | 'body'>
type CommandSpec = Pick<SpecLite, 'id' | 'path'>

export function composeCommandPrompt(raw: string, presets: CommandPreset[], specs: CommandSpec[]): string {
  const match = raw.match(/^\/(\S+)\s*([\s\S]*)$/)
  if (!match) return raw
  const preset = presets.find((p) => p.name === match[1])
  if (!preset) return raw

  const ids: string[] = []
  const allMentions = new RegExp(MENTION.source, 'gu')
  const free = match[2].replace(allMentions, (_, id: string) => { ids.push(id); return '' }).trim()
  const targets = ids.length
    ? ids.map((id) => {
        const spec = specs.find((s) => s.id === id)
        const path = spec?.path.replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')
        return path ? `- [[${id}]] — ${path}` : `- [[${id}]]`
      }).join('\n')
    : '(No target was mentioned. If the prompt names the scope, use it; otherwise ask the human to define the scope before proceeding — unless this task needs no scope, in which case proceed.)'
  const body = preset.body.includes('{{targets}}')
    ? preset.body.replace('{{targets}}', targets)
    : ids.length ? `${preset.body}\n\n${targets}` : preset.body
  return free ? `${body}\n\n${free}` : body
}

// Load only the one live preset named by the raw invocation. Both session creation and sendText call this seam, so
// launch and an existing session's inbox resolve identical plugin data with identical target semantics.
export async function resolveCommandPrompt(raw: string, loadedSpecs?: CommandSpec[]): Promise<string> {
  const commandName = raw.match(/^\/(\S+)/)?.[1]
  const preset = commandName ? loadConfig().find((p) => p.name === commandName) : undefined
  if (!preset) return raw
  const specs = loadedSpecs ?? (nodeFromPrompt(raw) ? await loadSpecs() : [])
  return composeCommandPrompt(raw, [preset], specs)
}

type SessionPromptTarget = Pick<SessRec, 'session' | 'harness'>
type SessionPromptOptions = {
  from?: string
  replyVia?: 'note'
  loadedSpecs?: CommandSpec[]
  suffix?: string
}
export type ComposedSessionPrompt = { text: string; replyVia?: 'note' }

// @@@ composeSessionPrompt - the ONE prompt-delivery seam: raw caller text + target session become the
// exact text handed to an adapter. Launch, ordinary input, CLI send, issue dispatch, watch greetings, and
// merge all enter here (directly or through sendText). `replyVia` is target readability: an explicit note
// request wins; otherwise a headless adapter defaults to note. This function alone decides and appends the
// note/terminal inserts, so clients never own the policy or duplicate the phrase.
export async function composeSessionPrompt(raw: string, target: SessionPromptTarget, opts: SessionPromptOptions = {}): Promise<ComposedSessionPrompt> {
  const resolved = await resolveCommandPrompt(raw, opts.loadedSpecs)
  const prompt = opts.suffix ? `${resolved}${opts.suffix}` : resolved
  const h = harnessById(target.harness || defaultHarness.id)
  const replyVia = opts.replyVia ?? (h.headless ? 'note' : undefined)
  const text = replyVia === 'note' ? withNoteReplyHint(prompt)
    : !opts.from && lastHumanSendVia(target.session) === 'note' ? withTerminalReplyHint(prompt) : prompt
  return { text: optionSafe(text), ...(replyVia ? { replyVia } : {}) }
}
const optionSafe = (text: string) => text.startsWith('-') ? ` ${text}` : text
const UUID_TOKEN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g
const stripIdentityTokens = (s: string) => s.replace(/(^|\s)@[\p{L}\p{N}_-]+/gu, '$1').replace(UUID_TOKEN, ' ')
export function titleFromPrompt(prompt: string): string | null {
  const first = stripIdentityTokens(prompt || '').split('\n').map((l) => l.trim()).find(Boolean) || ''
  const words = first.split(/\s+/).filter(Boolean).slice(0, 7).join(' ')
  if (!words) return null
  return words.length > 50 ? words.slice(0, 49).trimEnd() + '…' : words
}

// @@@ launchScript - the WHOLE launch invocation (rendezvous env prefix + harness command + the human prompt)
// is written to an ephemeral `launch.sh` in the session's GLOBAL store and
// run via `bash <file>`, NOT typed inline. Inline send-keys TRUNCATES past ~2KB (the launch-prompt-limit trap),
// and a long human prompt + spec pointer can exceed it; a file has no length limit
// and the only thing send-keys types is the short `bash <file>` line. It's the SAME command the inline path
// ran (env prefix exports the rendezvous vars to the claude child), just relocated to a file. Liveness no
// longer cares what the pane's foreground command is: claude runs as a child of bash (and, via the
// `reclaude` wrapper, a grandchild), so the pane command is the wrapper/shell — reconcile reads claude's
// rendezvous socket instead (present while claude is alive, gone once it exits). The file lives OUTSIDE the
// worktree (in the store, keyed by session_id), so it never pollutes the spec/code work.
// @@@ launch quoting - single-quote a string for a POSIX shell, `'` → `'\''`. Used to nest the whole agent
// invocation inside the birth-registration `sh -c '…'` wrapper without any segment double-expanding.
// 后端把这条命令输入交互式 shell，脚本路径必须作为一个 shell 参数传递。
export function launchShellCommand(file: string): string {
  return `bash ${shQuote(file)}`
}
export function launchScript(id: string, tail: string, harness: Harness = HARNESS, cmd?: string): string {
  const file = join(storeDir(id), 'launch.sh')
  // NO --append-system-prompt / --settings: the contract + hooks are materialized into the worktree at
  // createSession ([[harness-delivery]]) and the agent auto-discovers them — the SAME path as a self-launched
  // agent. The launch line is just the rendezvous env + the harness command + the session-id/spec-pointer/prompt tail.
  // `cmd` is the session's persisted launcher command ([[launcher-select]]); when set it OVERRIDES the harness's
  // ambient default so resume reuses the same auth. Undefined is only for old records before launch_cmd existed.
  const invocation = `${rvEnv(id, harness, readRecord(id)?.runtimeStartToken)} ${harness.launchCmd(id, runtimeRoot(), cmd)} ${tail}`
  // @@@ birth registration - record the AGENT's real pid BEFORE exec, the anchor of the 100ms hot death tier
  // ([[state]]). Each attempt runs `sh -c '<pid-write>; exec env <invocation>'`: the sh writes its own `$$` to
  // agent.pid, then `exec env` REPLACES that sh in place — so the pid persists down the whole command chain
  // (claude: env→(reclaude→)claude; codex: env→bash -lc <script> whose last line is `exec codex … resume`), and
  // `$$` therefore IS the launched agent's pid. `env` carries the leading `VAR=val` assignments (an env prefix
  // can't lead an `exec`), and the whole payload is single-quoted for the outer shell (shQuote) so the
  // invocation's own single-quoted segments — the codex `$@`/`$tid` script, the prompt — reach sh verbatim,
  // parsed exactly ONCE, never double-expanded. Each retry attempt rewrites agent.pid with a fresh `$$`.
  const pidPath = join(storeDir(id), 'agent.pid')
  const receiptPath = join(storeDir(id), 'agent.identity.json')
  const born = `sh -c ${shQuote(`rm -f ${shQuote(receiptPath)}; printf %s "$$" > ${shQuote(pidPath)}; exec env ${invocation}`)}`
  // Bounded relaunch on a FAST exit: the agent launcher can exit within seconds before the rendezvous socket
  // ever appears. That is enough evidence to retry, but not enough evidence to name the cause. Once the agent
  // has run past LAUNCH_FAST_FAIL_S it has genuinely started; its eventual (much later) exit is a normal
  // session end and is NEVER retried — the loop exits. BOOT_GRACE_MS and SOCKET_READY_TIMEOUT_MS both span this
  // retry window, so liveness stays 'starting' and waitForReady keeps holding the slot across retries. This
  // only closes startup unready failures — it adds no fallback and never masks a genuinely dead agent (3
  // attempts, then give up).
  // A one-shot adapter (currently codex-headless) deliberately exits after its first turn while the shared
  // app-server stays alive. Retrying that successful fast exit would mint a duplicate thread/prompt, so the
  // retry loop is a runtime capability rather than a harness-id branch.
  // @@@ retry only what retrying can fix - a fast exit says the launcher stopped before readiness, which is
  // reason enough to try again but never a diagnosis. So after a fast exit the script reads what the harness
  // actually SAID and matches it against the ADAPTER's own settled-failure patterns ([[harness-adapter]]
  // fatalLaunchOutput). A match means this command cannot succeed however many times we run it: stop at one
  // attempt and let the harness's own line be the last thing on the pane, instead of spending a certain failure
  // three times and burying the reason. No match keeps the plain bounded retry.
  //
  // It reads the PANE, not the agent's streams. Capturing stderr through a pipe missed the answer entirely —
  // measured against real reclaude, "No conversation found with session ID" arrives on STDOUT, so a
  // stderr-only capture classified nothing and retried a certain failure three times (the unit test passed
  // only because its stub printed to the stream the implementation happened to watch). Redirecting stdout too
  // would be worse: a TUI that finds stdout is not a terminal stops being a TUI. The pane already holds both
  // streams exactly as the human sees them, and the script runs inside that pane — so it just asks tmux.
  const fatal = (harness.fatalLaunchOutput ?? []).join('|')
  const launchBody = harness.launchOneShot ? [born, ''] : [
    `for __spex_try in 1 2 3; do`,
    `  __spex_t0=$SECONDS`,
    // @@@ classify THIS attempt only - the pane is a scrollback, so it also holds every earlier attempt and
    // every earlier launch that ever ran in this window. Matching the whole capture would let a stale
    // settled-failure line from minutes ago condemn an unrelated fast exit and cut a launch that retrying
    // WOULD have recovered — the exact mirror of the miss this classifier exists to fix. So each attempt
    // stamps a line unique to (this run, this attempt) and the match starts after it. The run's pid is what
    // makes it unique across relaunches, which reuse the session id.
    `  __spex_mark="attempt $__spex_try start $$"`,
    `  printf '[spex launch] %s\\n' "$__spex_mark"`,
    `  ${born}`,
    `  __spex_rc=$?`,
    `  [ $(( SECONDS - __spex_t0 )) -ge ${LAUNCH_FAST_FAIL_S} ] && exit $__spex_rc`,
    ...(fatal ? [
      // -t "$TMUX_PANE" names THIS pane explicitly (tmux still resolves the server from $TMUX), so the capture
      // can never land on a neighbouring pane; run outside tmux the call fails, nothing matches, and the plain
      // bounded retry stands.
      `  if tmux capture-pane -p -S -400 -t "\${TMUX_PANE:-.}" 2>/dev/null | sed -n "/$__spex_mark/,\\$p" | grep -Eq ${shQuote(fatal)}; then`,
      `    printf '[spex launch] attempt %s exited in %ss (rc=%s) - the launcher reported a failure retrying cannot fix (see above); not retrying\\n' "$__spex_try" "$(( SECONDS - __spex_t0 ))" "$__spex_rc" >&2`,
      `    exit $__spex_rc`,
      `  fi`,
    ] : []),
    `  printf '[spex launch] attempt %s exited in %ss (rc=%s) - fast launcher exit before readiness; retrying\\n' "$__spex_try" "$(( SECONDS - __spex_t0 ))" "$__spex_rc" >&2`,
    `  sleep 2`,
    `done`,
    `exit $__spex_rc`,
    ``,
  ]
  writeFileSync(file, launchBody.join('\n'))
  return file
}
