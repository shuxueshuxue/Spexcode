import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { claudeSlashCommands, codexSlashCommands, type SlashCommand } from './slash-commands.js'
import { runtimeRoot, mainCheckout, readConfig } from './layout.js'
import { tsxBin } from './tsx-bin.js'

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
export type HarnessLivenessRecord = { session: string; harnessSessionId?: string | null }
// the per-pane runtime probe the caller snapshots ONCE for the whole session list and hands liveness():
// the pane's root pid (tmux `#{pane_pid}`) plus one whole-box pid→(ppid, comm) table (a single `ps` spawn).
// The adapter that cares (codex) walks the pane pid's descendants in that table; claude ignores it.
export type ProcTable = Map<number, { ppid: number; comm: string }>
export type PaneProbe = { panePid?: number; procs?: ProcTable }

export interface Harness {
  readonly id: HarnessId
  // the lifecycle events this harness fires (drives the shim + the trust hashes). Claude binds the full set;
  // Codex's canonical hook event set (its `HookEventName` enum, codex 0.142.3) has no failed-stop and no
  // idle/attention event, so Codex has NO equivalent of StopFailure / Notification — a real harness difference,
  // not a TODO. It binds only the five it actually fires (see CODEX_EVENTS).
  readonly events: readonly string[]
  // whether the harness's agent opens a reclaude rendezvous control socket. Claude does; Codex has no such
  // daemon and uses its app-server JSON-RPC control plane instead.
  readonly ownsRendezvous: boolean
  // whether this harness's tmux pane_title is the agent's OWN live task self-summary (so the board headline
  // may derive from it — see [[session-activity]]). Claude continuously writes a one-line task summary into
  // its OSC title → true. Codex sets the pane title to a spinner glyph + the cwd basename (the worktree FOLDER
  // name), which is NOT a self-summary → false, so its headline falls through to the launch-prompt preview
  // instead of showing the folder name. This is the ONLY harness branch in the headline path: the capability
  // is data on the adapter, not an `if (codex)` in sessions.ts.
  readonly paneTitleIsSelfSummary: boolean

  // --- launch / sessionId ---
  // the base agent command. Claude: `claude …`; Codex starts a project-scoped app-server and launches the
  // visible TUI with `--remote` pointed at it. `cmd`, when given, is the SESSION's persisted launcher command
  // ([[launcher-select]]) and OVERRIDES the ambient env→config→default resolution — so a session created under a
  // named launcher keeps that exact command (and auth) on resume, never silently reverting to the global
  // default. Omitted → the unnamed default resolution (env-overridable, for tests + old records).
  launchCmd(id: string, runtimeDir?: string, cmd?: string): string
  // the RESOLVED base launcher command alone — the wrapper/binary that carries the agent's config-dir env
  // (claude `CLAUDE_CONFIG_DIR`, codex `CODEX_HOME`), WITHOUT the per-launch script built around it. `cmd`,
  // when given, wins; else the ambient env→config→default resolution. The launch owner PINS this on the record
  // at creation so a resume replays the EXACT launcher that created the conversation — never re-resolving
  // against a since-changed default, which would point `--resume` at the wrong config dir and lose the
  // transcript ([[launcher-select]], the resume-launcher-pin). launchCmd builds its invocation ON TOP of this.
  baseCmd(cmd?: string): string
  // the flag that pins the session id at launch. Claude lets the caller choose (`--session-id <id>`); Codex
  // assigns its own, so there is nothing to pass (the id is captured/resumed afterwards).
  sessionIdArg(id: string): string
  // the env var the agent's OWN process carries so its `spex …` calls know their session id.
  readonly sessionEnvVar: string

  // --- materialize: shim + contract + trust ([[harness-delivery]]) ---
  // the auto-discovered hook shim file for this harness (.claude/settings.json vs .codex/hooks.json).
  shimFile(proj: string): string
  // a LINKED WORKTREE's extra shim copy — the worktree-side `.codex` hook file that ANCHORS codex's project
  // config layer, or null when the harness needs none. codex-rs only builds a project config layer (and thus
  // only DISCOVERS a worktree thread's hooks) for a dir in [cwd..project_root] that contains a `.codex/`
  // directory; it then REWRITES that layer's hooks-config folder to the ROOT checkout (root_checkout_hooks_-
  // folder_for_dir), so the shim CONTENT is still read from `shimFile` at the main checkout. But with the codex
  // shim living ONLY at the main checkout, a linked worktree has NO `.codex/` at all → codex anchors no layer →
  // the rewritten root hooks are never visited → ZERO hooks fire (bypass_hook_trust can't help: it only rescues
  // an untrusted HANDLER inside an already-discovered layer, it never creates one). So codex ALSO writes its
  // shim into the worktree's own `.codex/hooks.json` purely to anchor the layer (the rewrite ignores its
  // content, reading the root's — and a codex that DIDN'T rewrite would read this identical shim, so it is
  // correct either way). Claude: null — its shim already lives IN the worktree (`.claude/settings.json`) and
  // self-anchors; it has no root-checkout rewrite. Non-worktree (proj == main checkout): null — `shimFile`
  // already wrote `.codex/hooks.json` there.
  worktreeHookAnchor(proj: string): string | null
  // the contract file(s) the `surface: system` block is folded into. Claude: ./CLAUDE.md; Codex: ONLY ./AGENTS.md.
  contractFiles(proj: string): string[]
  // the dir this harness auto-discovers skills from, or null if it has no skill primitive — the ONLY place skill-surface divergence lives.
  skillDir(proj: string): string | null
  // the dir this harness auto-discovers sub-agent definitions from, or null if it has no agent primitive — the
  // ONLY place agent-surface divergence lives (the skillDir analog). Claude reads .claude/agents/<name>.md;
  // Codex has no file-discovered agent-definition primitive, so it returns null and materialize skips it.
  agentDir(proj: string): string | null
  // the shim payload: the settings/hooks JSON binding every event → the dispatcher (harness id baked in), and
  // the per-event command string (shared with the trust writer so they hash identically).
  shim(dispatch: string, spex: string): { json: string; cmd: (e: string) => string }
  // make a dispatched/self-launched agent run the hooks with zero prompts. Codex writes PROJECT trust — and, on
  // a binary without `--dangerously-bypass-hook-trust`, per-hook trusted_hash blocks — into the GLOBAL
  // ~/.codex/config.toml (codex's security model: trust is global-only). PROJECT trust is UNCONDITIONAL: it
  // ENABLES the project config layer so codex discovers our hooks at all, a tier bypass_hook_trust does NOT
  // cover. Claude is a no-op (it relies on folder-trust). `cmdFor` MUST be the same per-event command the shim
  // emitted.
  writeTrust(proj: string, cmdFor: (e: string) => string): void

  // --- the `/` menu ---
  // the slash-command list, computed the way THIS harness computes its own `/` menu.
  slashCommands(): SlashCommand[]

  // --- runtime: liveness + prompt delivery ([[harness-delivery]]) ---
  // is this session's agent process up? The caller passes the runtime facts it already computed in ONE
  // snapshot (see sessions.ts liveSnapshot): the window's presence, a PaneProbe — the pane's root pid plus one
  // whole-box process table — AND `socketLive`, whether a CONNECT to this session's rendezvous socket found a
  // live listener (the caller probes all windowed sessions once per snapshot). The adapter adds only its own
  // channel check. claude: online iff the window is up AND its reclaude rendezvous socket has a live LISTENER
  // (`socketLive` — a connect that a live claude accepts and a stale socket FILE refuses; claude IGNORES the
  // pane probe). codex: online iff the window is up AND a codex-ish process (`codex` by any
  // name, or the `node` its CLI runs under) is live in the pane pid's DESCENDANT tree — NOT the pane's
  // foreground command name (that is `bash`, the launch wrapper, even while the TUI renders — field-confirmed),
  // and NOT the SHARED per-project app-server socket (it stays bound after a failed `--remote resume` dropped
  // the pane back to the shell). A missing probe (tmux/ps couldn't report) is not-live. The 'starting' boot
  // grace lives in the caller (sessions.ts liveness), so a still-booting pane reads starting, not offline.
  liveness(rec: HarnessLivenessRecord, tmuxAlive: boolean, runtimeDir?: string, pane?: PaneProbe, socketLive?: boolean): 'online' | 'offline'
  // deliver a follow-up prompt to a LIVE session and report whether it landed. claude: through the rendezvous
  // control socket — OPTIMISTIC-after-liveness (loud failure when the socket is missing/dead or the write can't
  // flush; once the reply line flushes to a live socket it returns ok, without waiting for an application ack —
  // see replyViaSocket). codex: JSON-RPC on the same app-server WebSocket the
  // visible TUI uses — it reads the thread live and either `turn/steer`s the message INTO an in-progress turn
  // (mid-turn, not queued for after the agent stops) or `turn/start`s a fresh turn when the thread is idle.
  // Returns ok=false with a reason that propagates to the API.
  deliver(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult>
  // --- materialize: clean (the inverse of write — [[harness-select]] prunes a deselected harness) ---
  // clean is the EXACT inverse of materialize's per-harness write: SURGICALLY remove ONLY SpexCode's own
  // artifacts — the managed contract block (sentinels), the generated shim file, the trust block, and the
  // skill/agent files named in `arts` — never the user's surrounding prose, their other settings, or any .spec
  // data. materialize calls it for every UNSELECTED harness, so dropping a harness from spexcode.json's
  // `harnesses` prunes that harness's products on the next re-materialize.
  clean(proj: string, arts: HarnessArtifacts): void
  // the inverse of writeTrust: strip THIS project's spexcode trust block from the harness's global config.
  // Codex removes its `~/.codex/config.toml` block; Claude is a no-op (it wrote none).
  removeTrust(proj: string): void

  // the relaunch tail reopen() hands launch() to bring the SAME work back up. claude resumes the same
  // conversation (`--resume <id>`, the id we pinned at launch). codex's own thread id is un-pinnable on the
  // launch flag, so the BACKEND owns it: it `thread/start`s the thread and stores the id at launch, so reopen
  // resumes the SAME conversation via codex's own `resume <thread-id>` subcommand (the stored harnessSessionId,
  // its rollout persisted on disk). Only a session whose thread id was never stored relaunches FRESH (empty
  // tail) in the same worktree/record — there is nothing to resume.
  resumeArg(rec: { session: string; harnessSessionId?: string | null }): string
}

// a prompt-dispatch outcome. ok=true means delivery is confirmed at the layer that harness proves it: claude at
// the TRANSPORT/liveness layer (the reply line flushed to a live rendezvous socket — see replyViaSocket for why
// it is OPTIMISTIC-after-liveness, not a round-trip ack); codex at the application layer (the app-server accepted
// `turn/steer`/`turn/start`). `error` carries a human-readable reason that propagates to the API route (non-2xx)
// and the CLI/dashboard. Defined here because it is the harness DELIVERY contract; sessions.ts re-exports it for
// its existing importers.
export type DispatchResult = { ok: boolean; error?: string }
export type HarnessDeliveryRecord = { session: string; worktreePath?: string; harnessSessionId?: string | null; runtimeDir?: string }
// the on-demand surface artifacts a materialize render wrote, by node NAME — so clean() knows EXACTLY which
// skill subdirs / agent files are SpexCode's to remove (name-scoped, never a blind wipe of a dir the user may
// also populate). materialize passes the live skill/agent node names; clean reconstructs the same paths.
export type HarnessArtifacts = { skills: readonly string[]; agents: readonly string[] }

// @@@ rendezvous control socket - claude's DETERMINISTIC, ONLY input path for PROMPTS to sessions WE launch.
// sessions.ts starts `claude` with CLAUDE_BG_BACKEND=daemon + CLAUDE_BG_RENDEZVOUS_SOCK=<this path> set ONLY on
// that one spawned command (env prefix, never global). claude opens a unix socket here; writing one line
// `{"type":"reply","text":"…"}\n` injects + submits the text as a prompt — no PTY typing, so multi-line input
// and Enters can't be corrupted the way `tmux send-keys` was. The path is uniquely derived from the session id,
// so we only ever address OUR OWN sockets (HARD ethics rule: never touch a session outside this product). It
// lives in tmpdir tied to the claude process, so no extra lifecycle. liveness CONNECTS to it (a live LISTENER,
// not merely the file — see rendezvousListening); deliver writes to it. Exported because sessions.ts builds the
// launch env var from it and best-effort sweeps it on close — but the liveness/delivery USE is the adapter's, below.
export const rvSock = (id: string) => join(tmpdir(), `spexcode-rv-${id}.sock`)

// @@@ rendezvousListening - the LISTENER check that IS claude's liveness truth ([[state]], [[harness-adapter]]).
// A crashed/killed claude can leave its rvSock FILE on disk (a unix-domain socket path is NOT auto-unlinked on
// an unclean exit), so the old `existsSync(rvSock)` read a DEAD pane as `online` for as long as the stale file
// lingered — the incident's "dead pane stuck `working` for 30+ min". The honest signal is a live LISTENER:
// connect() to the socket. A real claude is accepting → connects; a stale file → ECONNREFUSED (instant); an
// absent file → ENOENT (instant). So the common cases cost no waiting; the short timeout only bounds the
// pathological file-present-but-listener-wedged case (then treated as not-live). Never throws.
export function rendezvousListening(id: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let c: ReturnType<typeof createConnection> | undefined
    const done = (v: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { c?.destroy() } catch { /* */ }
      resolve(v)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    try { c = createConnection({ path: rvSock(id) }) } catch { return done(false) }
    c.on('connect', () => done(true))
    c.on('error', () => done(false))   // ECONNREFUSED (stale file) / ENOENT (gone) — both mean no live agent
  })
}
// The app-server Unix socket MUST live on a SHORT, sun_path-safe path — NOT nested under the project runtime
// dir. macOS caps `sun_path` at ~104 bytes, and `runtimeRoot()` flattens the ENTIRE project path into one
// dash-segment (`encodeProject`), so `<runtimeRoot>/codex-app-server.sock` blew past the cap on a deep macOS
// project (~111 chars) → `path must be shorter than SUN_LEN` + connect EINVAL, and the app-server never bound
// (Linux's 108 limit + shorter `/root` paths happened to fit; macOS did not). So the socket is
// `<socketBase>/spexcode-cx-<hash>.sock`, where `<hash>` is a short STABLE digest of the PROJECT identity — the
// `dir` (runtimeDir) the callers pass — so launch, liveness, and delivery all compute the IDENTICAL sock for a
// given project (the ONE-app-server-per-project invariant). This is UNCONDITIONAL on every platform (a short
// hashed path is strictly better everywhere — no darwin branch; platform differences stay at this path seam).
// `<socketBase>` = the `SPEXCODE_CODEX_SOCKET_DIR` override, else an OWNED per-uid subdir of the platform
// tmpdir (`spexcode-cx-<uid>`, created 0700) — NEVER bare tmpdir: codex (0.137+ field-confirmed) refuses to
// bind a unix socket directly in the shared sticky `/tmp` on a host with `fs.protected_regular=2` (EPERM), so
// the bare-tmpdir default failed every codex launch on a stock hardened Ubuntu out of the box (github#30),
// while the SAME codex binds fine in any owned subdirectory. Per-uid (not one shared `spexcode-cx`) so a
// second user on the box never lands in the first user's 0700 dir. The derivation GUARANTEES the dir exists
// (idempotent mkdir) so every consumer — launch bake, liveness connect, delivery, tests — shares one creation
// point. The `.pid`/`.log`/`.lock` files carry no sun_path limit and stay in `runtimeRoot`.
export const codexAppServerSock = (dir = runtimeRoot()) => {
  const base = process.env.SPEXCODE_CODEX_SOCKET_DIR || join(tmpdir(), `spexcode-cx-${process.getuid?.() ?? 0}`)
  mkdirSync(base, { recursive: true, mode: 0o700 })
  return join(base, `spexcode-cx-${createHash('sha1').update(dir).digest('hex').slice(0, 16)}.sock`)
}
export const codexAppServerPid = (dir = runtimeRoot()) => join(dir, 'codex-app-server.pid')

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// the tsx + cli.ts invocation, baked into the codex launch script (mirrors materialize.ts's SPEX) so the
// launch shell can call back into `spex codex-launch` to own the thread + fire the first turn before it
// exec's the visible TUI.
const PKG = fileURLToPath(new URL('..', import.meta.url))
const SPEX = `${tsxBin(PKG)} ${join(PKG, 'src', 'cli.ts')}`

// @@@ replyViaSocket - OPTIMISTIC-after-liveness delivery: connect to the LIVE rendezvous socket and WRITE the
// `{type:reply}\n` line; once that line FLUSHES to the socket with no immediate transport error, the reply is on
// the wire and claude submits it the moment it yields the event loop — so we return ok:true right there. We do
// NOT wait for an application-level acceptance ack. The old code wrote a `{type:repaint}` probe after the reply
// and waited up to 2500ms for a `{type:repaint-done}` to CONFIRM the reply was processed; the ordering barrier is
// sound one-way (repaint-done ⟹ delivered) but its ABSENCE is NOT proof of non-delivery — a mid-turn/BUSY claude
// can't answer the probe within the wall, so a message that actually landed reported a COMMON, misleading false
// failure. The delivery confirmation therefore lives at the TRANSPORT/liveness layer, not the application layer:
// deliverViaRendezvous already gates on the socket's existence (liveness), and here the FREE, INSTANT transport
// signals — a connect that throws, a socket 'error' (ECONNREFUSED / EPIPE), or a 'close' BEFORE the write flushes —
// are still reported as real failures (they cost no waiting). What we knowingly give up is detection of the narrow
// alive-but-wedged / reply-rejected / shutting-down cases: a rare silent drop, recoverable because the supervisor
// sees the worker never transition. That tradeoff is the deliberate contract now — see [[harness-adapter]].
// Never throws.
function replyViaSocket(sock: string, text: string): Promise<DispatchResult> {
  return new Promise((resolve) => {
    let settled = false
    let c: ReturnType<typeof createConnection>
    const done = (r: DispatchResult) => {
      if (settled) return
      settled = true
      try { c?.destroy() } catch { /* */ }
      resolve(r)
    }
    try {
      c = createConnection({ path: sock })
    } catch (e) {
      done({ ok: false, error: `rendezvous socket connect threw: ${String(e)}` })
      return
    }
    c.on('error', (e: NodeJS.ErrnoException) => done({ ok: false, error: `rendezvous socket connect failed: ${e?.code || String(e)}` }))
    c.on('close', () => done({ ok: false, error: 'rendezvous connection closed before the prompt was written' }))
    // write the reply line; the write callback fires once it flushes to the live socket → optimistic ok. An
    // immediate transport 'error'/'close' beats the callback and reports the real failure (done is idempotent).
    c.on('connect', () => c.write(JSON.stringify({ type: 'reply', text }) + '\n', () => done({ ok: true })))
  })
}
// claude's deliver: the pre-write LIVENESS gate — fail loud BEFORE attempting the socket if it isn't there (a
// clearer message than a raw connect error, and the delivery's confirmation layer: socket present = agent alive).
// Then inject the reply optimistically via replyViaSocket (no round-trip ack).
function deliverViaRendezvous(id: string, text: string): Promise<DispatchResult> {
  const sock = rvSock(id)
  if (!existsSync(sock)) return Promise.resolve({ ok: false, error: `no rendezvous control socket for session ${id} (socketless/old session, or the agent is offline) — prompt NOT delivered` })
  return replyViaSocket(sock, text)
}

type JsonRpc = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } }

// The JSON-RPC the delivery handshake speaks, in send order. Method names + param shapes are pinned to codex
// 0.142.3 (`codex app-server generate-ts` → ClientRequest.ts / v2/*Params.ts): the visible TUI is launched with
// `codex --remote unix://<sock>`, so its thread is ALREADY loaded in this server — we must NOT `thread/resume`
// it (that re-loads a thread the live TUI already owns). Instead `thread/loaded/list` PROVES the captured thread
// is the one the pane is showing, then `thread/read{includeTurns}` reveals whether a turn is in progress (and
// its id). The 4th, injecting message is CHOSEN from that read — see codexInjectMessage.
const codexTextInput = (text: string) => [{ type: 'text', text, text_elements: [] }]
export function codexHandshakeMessages(threadId: string): JsonRpc[] {
  return [
    {
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'spexcode', title: 'SpexCode', version: '0.0.0' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    },
    { method: 'initialized', params: {} },
    { id: 2, method: 'thread/loaded/list', params: {} },
    { id: 3, method: 'thread/read', params: { threadId, includeTurns: true } },
  ]
}

// the message that injects `text`. STEER (turn/steer) when an active turn id is known — codex processes it
// WITHOUT waiting for the current turn to end (the human's "工具调用完就插入": injected the moment the running
// tool call returns), so a busy agent reacts mid-turn instead of queuing the message for after it stops.
// `TurnSteerParams` REQUIRES the live turn id as `expectedTurnId` (the server rejects a stale one) — so this is
// only sent with a turnId read live from the thread, never from SpexCode's session status. When the thread is
// idle (no active turn id), START a fresh turn (turn/start). `id` is parameterized so a steer that loses the
// expectedTurnId race (turn ended in the read→steer window) can retry as a turn/start with id 5.
export function codexInjectMessage(threadId: string, text: string, cwd: string | undefined, activeTurnId: string | null, id = 4): JsonRpc {
  if (activeTurnId)
    return { id, method: 'turn/steer', params: { threadId, input: codexTextInput(text), expectedTurnId: activeTurnId } }
  return { id, method: 'turn/start', params: { threadId, input: codexTextInput(text), ...(cwd ? { cwd } : {}) } }
}

// the in-progress turn id from a `thread/read{includeTurns}` result, or null when the thread is idle. With
// includeTurns the Thread carries its turns, each with a TurnStatus ("completed"|"interrupted"|"failed"|
// "inProgress"); the live turn is the `inProgress` one and its id is exactly what turn/steer's precondition needs.
export function activeTurnIdFromThread(readResult: unknown): string | null {
  const thread = (readResult as { thread?: { turns?: Array<{ id?: string; status?: string }> } })?.thread
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  const active = turns.find((t) => t?.status === 'inProgress')
  return active?.id ?? null
}

// The app-server and the visible `--remote … resume` TUI share ONE socket, so they MUST be the SAME codex
// install — a version split across that socket breaks the thread/start→resume handoff (an app-server on one
// version creates a thread a differently-versioned resume can't find; an old-enough app-server can't serve
// `--remote unix://` at all). So `serverCmd` is DERIVED from the in-effect `codexCmd`'s binary (its first shell
// token, dropping args like `--yolo`) whenever it isn't explicitly forced: `<bin> app-server` then runs the
// SAME install as `<bin> --remote … resume`. Bare `codex` is NOT the default anymore — on a multi-install host
// (e.g. homebrew codex shadowing an nvm codex) a bare `codex` resolves via the login-shell PATH to a DIFFERENT
// binary than the launcher's, which is exactly the version-skew bug. `SPEXCODE_CODEX_SERVER_CMD` stays the
// explicit escape hatch (highest precedence). Caveat: if `codexCmd`'s first token is a WRAPPER script rather
// than codex itself, the derived `<wrapper> app-server` only works if the wrapper forwards to codex — the
// common direct-binary case (`codex …`, `/abs/codex --yolo`) is what this fixes.
export function codexBinary(codexCmd: string): string {
  return codexCmd.trim().split(/\s+/)[0] || 'codex'
}
// codex >=0.142 adds `--dangerously-bypass-hook-trust` — run our OWN (vetted) dispatch hooks without a persisted
// trusted_hash. We PREFER it over reverse-engineering codexHookHash: that hash is pinned to one codex version's
// format and silently breaks on a bump (codex then skips ALL our hooks -> no Stop gate, no mark-active, sessions
// die undeclared). The flag is version-robust. But an OLDER codex HARD-ERRORS on the unknown flag (the whole
// app-server fails to boot), so we CAPABILITY-PROBE the binary once (`--help` grep) and only pass it when
// present; otherwise the writeCodexTrust hash path still stands in. Memoized — a per-binary constant.
const bypassProbe = new Map<string, boolean>()
export function codexSupportsBypassHookTrust(binary: string): boolean {
  // explicit escape hatch (also what makes this deterministic in tests): force the capability on/off regardless
  // of the binary — e.g. if the `--help` probe is unreliable on a wrapper, or to pin behaviour.
  const env = process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST
  if (env !== undefined) return env === '1' || env === 'true'
  const hit = bypassProbe.get(binary)
  if (hit !== undefined) return hit
  let ok = false
  try { ok = execFileSync(binary, ['--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes('--dangerously-bypass-hook-trust') } catch { ok = false }
  bypassProbe.set(binary, ok)
  return ok
}
export function codexLaunchCommand(_id: string, codexCmd = process.env.SPEXCODE_CODEX_CMD || 'codex --yolo', serverCmd?: string, dir = runtimeRoot()): string {
  const server = process.env.SPEXCODE_CODEX_SERVER_CMD || serverCmd || codexBinary(codexCmd)
  // The bypass flag ONLY reaches a thread's hook trust as a per-request `config` override, NOT as a CLI flag on
  // the shared `app-server` process (the app-server never reads its own `--dangerously-bypass-hook-trust` for a
  // thread — it was INERT there, the bug). Two thread paths carry it: (1) the BACKEND-owned `thread/start` sends
  // `config.bypass_hook_trust` from codex-launch ([[harness-adapter]]); (2) the visible `--remote … resume` TUI,
  // where codex's OWN client forwards this flag into its thread/start+thread/resume config — so a reopen in a
  // fresh app-server (where codex-launch never runs) still trusts our hooks. Hence the flag lives on the resume
  // TUI, never on the app-server invocation. Guarded against a double-flag when an env override already carries it.
  const tuiBypass = !codexCmd.includes('--dangerously-bypass-hook-trust') && codexSupportsBypassHookTrust(codexBinary(codexCmd)) ? ' --dangerously-bypass-hook-trust' : ''
  const sock = codexAppServerSock(dir)         // short sun_path-safe path in the owned tmp subdir/override — NOT under "$dir"
  const pid = codexAppServerPid(dir)
  const log = join(dir, 'codex-app-server.log')
  const lock = join(dir, 'codex-app-server.lock')
  const script = [
    `dir=${shQuote(dir)}`,
    `sock=${shQuote(sock)}`,
    `pid=${shQuote(pid)}`,
    `log=${shQuote(log)}`,
    `lock=${shQuote(lock)}`,
    // codex-launch's bypass-trust gate (and writeTrust's) resolves the codex binary from SPEXCODE_CODEX_CMD;
    // WE already hold the launcher's real cmd here (it drives the app-server + resume TUI + tuiBypass above), so
    // pin it into the environment the codex-launch child inherits. Without this the child falls back to a bare
    // `codex`, which on a multi-install box (e.g. an old Homebrew codex on PATH beside the launcher's newer one)
    // probes the WRONG binary — deciding "no --dangerously-bypass-hook-trust support" and silently dropping the
    // thread/start bypass, so the worktree's hooks stay untrusted and NO lifecycle hooks fire.
    `export SPEXCODE_CODEX_CMD=${shQuote(codexCmd)}`,
    'mkdir -p "$dir"',
    'mkdir -p -m 700 "$(dirname "$sock")"',    // the socket base (owned tmp subdir or the SPEXCODE_CODEX_SOCKET_DIR override) — re-created here because a tmp cleaner may have wiped it since the bake; NEVER bare /tmp (codex EPERMs binding there on hardened hosts, github#30)
    // self-heal: the pre-fix flock design left an orphaned `codex-app-server.lock` FILE; the mkdir mutex now
    // uses `"$lock.d"`, so drop that dead residue on already-run deployments (harmless if absent).
    'rm -f "$lock"',
    // POSIX-portable mutex: mkdir is atomic on every POSIX fs, so it serializes the check-and-start with NO
    // dependency on util-linux `flock` (absent on macOS — where the old flock path failed the whole app-server
    // bootstrap, leaving the pane at the shell). Spin on `mkdir "$lock.d"` with a bounded wait; after ~10s
    // (200 * 0.05s, safely above the ~5s socket-wait a legit holder needs) treat the dir as orphaned by a dead
    // launcher and clear it, so a stale lock can never deadlock a launch. Held ONLY across the check-and-start,
    // released immediately after. Unlike flock (held until every fd on its open file description closes) a mkdir
    // lock has no inherited-fd hazard, so the long-lived daemon can't pin it — no fd-9 gymnastics needed.
    'lockd="$lock.d"',
    '_lk=0',
    'until mkdir "$lockd" 2>/dev/null; do',
    '  _lk=$((_lk+1)); [ "$_lk" -ge 200 ] && { rm -rf "$lockd" 2>/dev/null; _lk=0; }',
    '  sleep 0.05',
    'done',
    'if [ -S "$sock" ] && [ -s "$pid" ] && ! kill -0 "$(cat "$pid")" 2>/dev/null; then rm -f "$sock"; fi',
    'if [ ! -S "$sock" ]; then',
    // The app-server is a per-PROJECT daemon SHARED across every worktree's threads, so it must run in a STABLE
    // cwd — the runtime dir "$dir", NOT the launch.sh's transient worktree. A daemon started inside a worktree
    // keeps that worktree as its process cwd for its whole life; when the session closes and the worktree is
    // removed, the daemon's cwd becomes a DELETED dir, and codex then fails EVERY new thread's config load with
    // `failed to load configuration: No such file or directory` — bricking codex launch for the whole project
    // until the daemon is killed. Running it from "$dir" (which never gets deleted) makes it deletion-proof.
    // exec so $! is the daemon itself; </dev/null detaches its stdin from the pane so it can't fight the TUI.
    `  ( cd "$dir" && exec ${server} app-server --listen unix://"$sock" >"$log" 2>&1 </dev/null ) &`,
    '  echo $! > "$pid"',
    '  for i in $(seq 1 100); do [ -S "$sock" ] && break; sleep 0.05; done',
    'fi',
    'rmdir "$lockd" 2>/dev/null',
    // TWO launch modes, on ONE tail channel ("$@"). reopen() hands a `--resume <thread-id>` tail (see
    // codexHarness.resumeArg) to bring the SAME conversation back: resume that OWNED thread DIRECTLY — no new
    // thread, no first-turn prompt. ANY other tail is a NEW launch: BACKEND owns the thread — `codex-launch`
    // does thread/start { cwd = this worktree } on the shared per-project app-server, stores the new id on the
    // governed record (SPEXCODE_SESSION_ID), and fires the tail as the FIRST turn, materializing the rollout.
    // Either way it ends with a thread id, which the visible TUI then RESUMES (the rollout persists on disk),
    // rendering it natively. A new launch's tail is always ONE single-quoted prompt arg, so it can never be the
    // literal "--resume" marker — the discriminator is unambiguous. codex-launch only prints an id once its
    // rollout has landed (resume-ready), so a fail-loud (empty output / non-zero) must ABORT — never `resume ""`.
    `if [ "$1" = "--resume" ]; then`,
    `  tid=$2`,
    `else`,
    `  tid=$(${SPEX} internal codex-launch "$sock" "$PWD" "$@") || exit 1`,
    `fi`,
    `[ -n "$tid" ] || { echo "[spex] codex-launch produced no resumable thread" >&2; exit 1; }`,
    `exec ${codexCmd}${tuiBypass} --remote unix://"$sock" resume "$tid"`,
  ].join('\n')
  return `bash -lc ${shQuote(script)} spexcode-codex`
}

function rpcError(e: unknown): string {
  return String((e as Error)?.message || e)
}

// --- minimal RFC6455 client framing ------------------------------------------------------------------------
// The codex app-server `--listen unix://<sock>` transport is a WebSocket endpoint at path `/rpc` (the visible
// `codex --remote` TUI upgrades the very same way). So we speak WebSocket over the Unix socket — NOT a raw byte
// stream, and NOT `codex app-server proxy` (a dumb byte relay that performs no HTTP upgrade, so the server
// rejects its bytes as an invalid upgrade and closes — the old 502). One JSON-RPC message = one masked text
// frame; the server's frames come back unmasked. We only ever exchange small frames, so this is deliberately
// small: text + the control frames (ping→pong, close) we must honor, plus continuation reassembly for safety.
function encodeWsFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length
  const mask = randomBytes(4)
  let header: Buffer
  if (len < 126) header = Buffer.from([0x80 | opcode, 0x80 | len])
  else if (len < 65536) header = Buffer.from([0x80 | opcode, 0x80 | 126, (len >> 8) & 0xff, len & 0xff])
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2) }
  const masked = Buffer.alloc(len)
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4]
  return Buffer.concat([header, mask, masked])
}
const wsText = (s: string) => encodeWsFrame(0x1, Buffer.from(s, 'utf8'))

// Decode the unmasked server→client frames accumulated in `buf`, handing each complete text message to
// `onText`; honors ping→pong and a close. Shared by every app-server WS client here. Returns the (possibly
// shrunk) buffer + whether a close was seen, plus the running fragment state threaded back in on each call.
type FrameState = { buf: Buffer; fragOp: number; fragBuf: Buffer }
function drainWsFrames(s: FrameState, conn: Socket, onText: (json: string) => void): boolean {
  for (;;) {
    if (s.buf.length < 2) return false
    const b0 = s.buf[0], b1 = s.buf[1], op = b0 & 0x0f, fin = (b0 & 0x80) !== 0, masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f, off = 2
    if (len === 126) { if (s.buf.length < 4) return false; len = s.buf.readUInt16BE(2); off = 4 }
    else if (len === 127) { if (s.buf.length < 10) return false; len = Number(s.buf.readBigUInt64BE(2)); off = 10 }
    const dataStart = off + (masked ? 4 : 0)
    if (s.buf.length < dataStart + len) return false
    let payload = s.buf.slice(dataStart, dataStart + len)
    if (masked) { const mk = s.buf.slice(off, off + 4); const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mk[i % 4]; payload = u }
    s.buf = s.buf.slice(dataStart + len)
    if (op === 0x8) return true                                       // close
    if (op === 0x9) { conn.write(encodeWsFrame(0xa, payload)); continue }   // ping → pong
    if (op === 0xa) continue                                          // pong
    if (op === 0x0) s.fragBuf = Buffer.concat([s.fragBuf, payload])   // continuation
    else { s.fragOp = op; s.fragBuf = payload }
    if (fin) { if (s.fragOp === 0x1) onText(s.fragBuf.toString('utf8')); s.fragBuf = Buffer.alloc(0); s.fragOp = 0 }
  }
}
const WS_UPGRADE = (key: string) => `GET /rpc HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`
const wsInitialize: JsonRpc = { id: 1, method: 'initialize', params: { clientInfo: { name: 'spexcode', title: 'SpexCode', version: '0.0.0' }, capabilities: { experimentalApi: true, requestAttestation: false } } }

// Read a loaded thread id off the app-server via `thread/loaded/list`. With the backend now OWNING the thread
// id at launch (codexStartThread → stored on the record), this is only the DELIVERY FALLBACK for a pre-existing
// session whose id was never stored: it returns the first loaded thread. On a shared per-project server several
// threads may be loaded, so it is no longer the deterministic capture path — the stored id is. Never throws.
export function codexThreadId(sock: string): Promise<{ ok: true; threadId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false
    const done = (r: { ok: true; threadId: string } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'codex app-server did not list threads within 5000ms' }), 5000)
    conn.on('error', (e) => done({ ok: false, error: `codex app-server connection failed: ${rpcError(e)}` }))
    conn.on('close', () => done({ ok: false, error: 'codex app-server closed before thread/loaded/list was answered' }))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) return done({ ok: false, error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      if (m.id === 1 && m.result) { send({ method: 'initialized', params: {} }); return send({ id: 2, method: 'thread/loaded/list', params: {} }) }
      if (m.id === 2 && m.result) {
        const data = (m.result as { data?: unknown }).data
        const ids = Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : []
        return ids.length ? done({ ok: true, threadId: ids[0] }) : done({ ok: false, error: 'no loaded thread on the app-server socket yet (TUI still booting?)' })
      }
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `codex app-server refused the WebSocket upgrade: ${head.split('\r\n')[0]}` })
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: 'codex app-server sent a WebSocket close before thread/loaded/list was confirmed' })
    })
  })
}

// @@@ codexStartThread - the BACKEND owns the thread. On the shared PER-PROJECT app-server we `thread/start
// { cwd }` (codex resolves config/hooks/AGENTS.md from that worktree cwd — exactly as claude loads CLAUDE.md
// per-worktree — so one project-scoped server behaves analogously to a per-worktree launch), and the result
// carries the new thread id (`result.thread.id`). The launcher stores that id on the governed record and
// fires the first turn; there is no capture hook and no rollout/cwd scan. Same WS framing as codexThreadId.
// Never throws.
export function codexStartThread(sock: string, cwd?: string, bypassHookTrust = false): Promise<{ ok: true; threadId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false
    const done = (r: { ok: true; threadId: string } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'codex app-server did not start a thread within 15000ms' }), 15000)
    conn.on('error', (e) => done({ ok: false, error: `codex app-server connection failed: ${rpcError(e)}` }))
    conn.on('close', () => done({ ok: false, error: 'codex app-server closed before thread/start was answered' }))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) return done({ ok: false, error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      if (m.id === 1 && m.result) {
        send({ method: 'initialized', params: {} })
        // thread/start's `config` is the per-request override map the app-server reads (config_manager reads
        // `request_overrides["bypass_hook_trust"]`) — the ONLY channel that reaches the thread config; the
        // `--dangerously-bypass-hook-trust` flag on the `codex app-server` invocation is INERT (the app-server
        // never reads it for a thread), so a BACKEND-owned thread must carry the bypass here, exactly as codex's
        // own `--remote resume` TUI client injects it. Without it the worktree's UNtrusted `.codex` config layer
        // stays disabled → no local hooks discovered → no Stop gate. Only on the bypass path (older codex without
        // the flag uses writeCodexTrust's hash and never sees this key).
        const params = { ...(cwd ? { cwd } : {}), ...(bypassHookTrust ? { config: { bypass_hook_trust: true } } : {}) }
        return send({ id: 2, method: 'thread/start', params })
      }
      if (m.id === 2 && m.result) {
        const tid = (m.result as { thread?: { id?: string } })?.thread?.id
        return tid ? done({ ok: true, threadId: tid }) : done({ ok: false, error: 'codex thread/start returned no thread id' })
      }
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `codex app-server refused the WebSocket upgrade: ${head.split('\r\n')[0]}` })
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: 'codex app-server sent a WebSocket close before thread/start was confirmed' })
    })
  })
}

function sendCodexAppServerTurn(sock: string, threadId: string, text: string, cwd?: string): Promise<DispatchResult> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const hs = codexHandshakeMessages(threadId)   // [initialize(1), initialized, thread/loaded/list(2), thread/read(3)]
    let buf = Buffer.alloc(0), upgraded = false, settled = false
    let fragOp = 0, fragBuf = Buffer.alloc(0)
    let steering = false   // the id-4 message we sent was a steer → an expectedTurnId race may retry as start(5)
    const done = (r: DispatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'codex app-server did not confirm the turn within 5000ms' }), 5000)
    conn.on('error', (e) => done({ ok: false, error: `codex app-server connection failed: ${rpcError(e)}` }))
    conn.on('close', () => done({ ok: false, error: 'codex app-server closed the connection before the turn was confirmed' }))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => {
      const key = randomBytes(16).toString('base64')
      conn.write(`GET /rpc HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`)
    })
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) {
        if (m.id === 4 && steering)                                         // active turn ended in the read→steer window → just start a fresh turn
          return send(codexInjectMessage(threadId, text, cwd, null, 5))
        if (m.id === 3)                                                     // thread not readable yet (a freshly-started thread is "not materialized
          return send(codexInjectMessage(threadId, text, cwd, null, 5))     // before its first user message") → no in-progress turn possible, so just turn/start
        return done({ ok: false, error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      }
      if (m.id === 1 && m.result) return send(hs[2])                       // initialize ack → ask which threads are loaded
      if (m.id === 2 && m.result) {                                         // loaded-thread list → confirm OUR thread is live, then read it
        const loaded = (m.result as { data?: unknown })?.data
        if (Array.isArray(loaded) && !loaded.includes(threadId))
          return done({ ok: false, error: `Codex thread ${threadId} is not loaded in the app-server (loaded: ${loaded.join(', ') || 'none'}) — prompt NOT delivered` })
        return send(hs[3])                                                 // thread is live → read it to decide steer-vs-start
      }
      if (m.id === 3 && m.result) {                                        // thread read → in-progress turn? steer into it; else start a new one
        const turnId = activeTurnIdFromThread(m.result)
        steering = !!turnId
        return send(codexInjectMessage(threadId, text, cwd, turnId))      // id 4: turn/steer the live turn, or turn/start
      }
      if ((m.id === 4 || m.id === 5) && m.result) return done({ ok: true }) // steer/start accepted → the model has the message
    }
    const drainFrames = () => {
      for (;;) {
        if (buf.length < 2) return
        const b0 = buf[0], b1 = buf[1], op = b0 & 0x0f, fin = (b0 & 0x80) !== 0, masked = (b1 & 0x80) !== 0
        let len = b1 & 0x7f, off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        const dataStart = off + (masked ? 4 : 0)
        if (buf.length < dataStart + len) return
        let payload = buf.slice(dataStart, dataStart + len)
        if (masked) { const mk = buf.slice(off, off + 4); const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mk[i % 4]; payload = u }
        buf = buf.slice(dataStart + len)
        if (op === 0x8) return done({ ok: false, error: 'codex app-server sent a WebSocket close before turn/start was confirmed' })
        if (op === 0x9) { conn.write(encodeWsFrame(0xa, payload)); continue }   // ping → pong
        if (op === 0xa) continue                                                // pong
        if (op === 0x0) fragBuf = Buffer.concat([fragBuf, payload])             // continuation
        else { fragOp = op; fragBuf = payload }
        if (fin) { if (fragOp === 0x1) handle(fragBuf.toString('utf8')); fragBuf = Buffer.alloc(0); fragOp = 0 }
      }
    }
    conn.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (!upgraded) {
        const i = buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `codex app-server refused the WebSocket upgrade: ${head.split('\r\n')[0]}` })
        upgraded = true
        buf = buf.slice(i + 4)
        send(hs[0]); send(hs[1])   // initialize + the initialized notification; loaded/list → read → inject follow on the acks
      }
      drainFrames()
    })
  })
}

// fire a turn on an owned thread over the per-project socket — the same steer-vs-start delivery the live UI
// uses. The launcher calls this to materialize a freshly-started thread's rollout (the first turn = the launch
// prompt), and delivery reuses it for follow-ups. Exported so the CLI's `codex-launch` can fire the first turn.
export function codexTurn(sock: string, threadId: string, text: string, cwd?: string): Promise<DispatchResult> {
  return sendCodexAppServerTurn(sock, threadId, text, cwd)
}

// @@@ codex rollout on disk - the visible TUI resumes a thread via `codex --remote resume <tid>`, which reads
// the thread's ROLLOUT FILE (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<ts>-<tid>.jsonl`) — so a thread the
// TUI can render is exactly one whose rollout exists on disk. VERIFIED live (real codex 0.142.5): `thread/start`
// ALONE writes NO rollout — only the first fired turn materializes it; and a FRESHLY-spawned app-server accepts
// thread/start+turn but does NOT persist the rollout for its first ~2-4s (a warm-up window) — the SAME thread's
// rollout just lands a few seconds LATE (not lost). Handing the id to `resume` before then is the "no rollout
// found for thread id" failure, so codex-launch WAITS for the rollout to land before it trusts the id.
const codexSessionsDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
// does a rollout file for this thread id exist yet? Rollouts are grouped by date, so scan only the newest few
// day-dirs (lexical order = chronological on zero-padded YYYY/MM/DD) — clock-agnostic and cheap on a big history.
export function codexRolloutExists(threadId: string, root = codexSessionsDir()): boolean {
  const kids = (d: string) => { try { return readdirSync(d).sort().reverse() } catch { return [] as string[] } }
  const days: string[] = []
  for (const y of kids(root)) { for (const m of kids(join(root, y))) { for (const d of kids(join(root, y, m))) { days.push(join(root, y, m, d)); if (days.length >= 3) break } if (days.length >= 3) break } if (days.length >= 3) break }
  return days.some((d) => kids(d).some((f) => f.includes(threadId)))
}
// poll until the thread's rollout lands (resume-ready) or the budget runs out. Returns false on timeout so the
// caller can FAIL LOUD instead of handing `resume` / the stored record a non-resumable id. The budget must
// exceed launch.sh's fast-fail threshold so a genuine failure exits PAST it — the retry loop then treats it as a
// real end, not a daemon race, and never sprays fresh (duplicate-prompt) threads.
export async function waitForCodexRollout(threadId: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (codexRolloutExists(threadId)) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 250))
  }
}

// codex's deliver: use the Codex app-server JSON-RPC channel that also powers rich clients, never TUI typing.
// The visible TUI is launched against the same project app-server Unix socket, so this injects into the same
// thread the pane is showing — steering an in-progress turn or starting one if idle. A missing captured thread
// id or socket is a loud failure; there is no tmux send-keys fallback because that reports "typed", not "accepted".
const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
async function deliverViaCodexAppServer(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult> {
  // the socket is PER-PROJECT (the runtime root), shared by every worktree's thread; the owned thread id on
  // the record picks out THIS session's thread.
  const sock = codexAppServerSock(rec.runtimeDir)
  if (!existsSync(sock)) return { ok: false, error: `no Codex app-server socket for this project — prompt NOT delivered` }
  // use the backend-owned thread id stored at launch; fall back to reading the one loaded thread only if it's
  // empty (a pre-existing session from before the id was stored).
  let threadId = rec.harnessSessionId
  if (!threadId) {
    const r = await codexThreadId(sock)
    if (!r.ok) return { ok: false, error: `${r.error} — prompt NOT delivered` }
    threadId = r.threadId
  }
  return sendCodexAppServerTurn(sock, threadId, text, rec.worktreePath)
}

// idempotent replace of the content between sentinels; the user's own content above/below is preserved. The
// comment STYLE is a parameter so ONE primitive serves every managed file — HTML for the md contracts
// (CLAUDE.md/AGENTS.md), `#` for .gitignore — instead of a per-file-type writer. Default = HTML (the md case).
export function writeManagedBlock(file: string, body: string, comment: readonly [string, string] = ['<!-- ', ' -->']): void {
  const [open, close] = comment
  const START = `${open}spexcode:start${close}`
  const END = `${open}spexcode:end${close}`
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = `${START}\n${body}\n${END}`
  let cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const re = new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`)
  if (re.test(cur)) cur = cur.replace(re, block)
  else cur = cur.trim() ? `${cur.replace(/\n*$/, '')}\n\n${block}\n` : `${block}\n`
  writeFileSync(file, cur)
}

// the INVERSE of writeManagedBlock: strip the spexcode sentinel block (with the blank space around it),
// leaving every other byte of the user's file intact. When deleteIfEmpty and nothing but whitespace remains,
// remove the file — it was WHOLLY ours (e.g. a CLAUDE.md that carried only the generated contract block). Same
// comment-style parameter so ONE primitive un-writes every managed file. No-op when the file/block is absent.
export function removeManagedBlock(file: string, comment: readonly [string, string] = ['<!-- ', ' -->'], deleteIfEmpty = false): void {
  if (!existsSync(file)) return
  const [open, close] = comment
  const START = `${open}spexcode:start${close}`
  const END = `${open}spexcode:end${close}`
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\n*${esc(START)}[\\s\\S]*?${esc(END)}\\n*`)
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (!re.test(cur)) return
  // remove ONLY our block plus the blank lines writeManagedBlock inserted around it; do NOT normalize the
  // user's OWN whitespace elsewhere — this must leave every other byte intact so it is a faithful INVERSE of
  // writeManagedBlock's append. A global `\n{3,}→\n\n` collapse used to sit here and mutated pre-existing
  // blank-line runs in the user's file, which broke the private⇄default round-trip ([[private-overlay]]):
  // default→private→default left a spurious one-line diff on a .gitignore that had internal blank lines.
  const out = cur.replace(re, '\n').replace(/^\n+/, '')
  if (deleteIfEmpty && !out.trim()) { rmSync(file, { force: true }); return }
  writeFileSync(file, out)
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

// @@@ stripCodexTrustFor - remove EVERY prior definition of THIS project's codex trust from a config.toml body,
// in ANY form: our own sentinel block (whatever past format its comments used), a BARE `[projects."<proj>"]`
// table (codex AUTO-writes one the moment it trusts a folder interactively/`exec` — NOT sentinel-wrapped), and
// any `[hooks.state."<hooksJson>:…"]` tables. This is what makes the UNCONDITIONAL write duplicate-SAFE and
// SELF-HEALING: codex REFUSES to load a config.toml with a duplicate key ("duplicate key"), so a sentinel-only
// replace (the old behaviour) that missed a pre-existing bare/old block APPENDED a second `[projects."<proj>"]`
// and took codex fully OFFLINE (the real cause of the public-vps outage). It is TABLE-scoped and STRING-compared
// (no regex escaping of the path), so other projects' trust, the shared parent tables (`[projects]`,
// `[hooks.state]`), and every other config key are untouched; a skipped table's body ends at the next header,
// blank, or comment, so a user comment attached to a following table is preserved.
function stripCodexTrustFor(cur: string, proj: string, hooksJson: string): string {
  const projHeader = `[projects."${proj}"]`
  const hooksPrefix = `[hooks.state."${hooksJson}:`
  const out: string[] = []
  let skip = false
  for (const line of cur.split('\n')) {
    const t = line.trim()
    const isHeader = /^\[\[?/.test(t)                       // a TOML table / array-of-tables header
    if (skip) { if (t === '' || t.startsWith('#') || isHeader) skip = false; else continue }   // end THIS table's body
    if (isHeader && (t === projHeader || t.startsWith(hooksPrefix))) { skip = true; continue }
    if (t === `# spexcode:trust:${proj} (managed — do not edit)` || t === `# spexcode:trust:end:${proj}`) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n*$/, '')
}

// additively stamp PROJECT trust (`[projects."<proj>"] trust_level = "trusted"`) AND the per-hook
// `trusted_hash` blocks for each event into the user's GLOBAL ~/.codex/config.toml, so a dispatched or
// self-launched codex trusts THIS project's config layer (enabling hook discovery) AND treats each hook as
// already-reviewed (no "Hooks need review" prompt on a persistent resume — see writeTrust). ALL prior
// definitions of this project's trust (ours, bare, or old-format) are STRIPPED first, so the write can never
// leave a DUPLICATE key (which breaks codex config loading) and self-heals a config that already carried one.
// Scoped to THIS project path; never touches the user's other config. CODEX_HOME respected for testability.
// (`events` may be empty for a trust-only stamp in tests.)
export function writeCodexTrust(proj: string, events: readonly string[], cmdFor: (e: string) => string): void {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  const file = join(home, 'config.toml')
  const hooksJson = join(proj, '.codex', 'hooks.json')
  const lines = [`[projects."${proj}"]`, 'trust_level = "trusted"']
  for (const e of events) {
    const snake = SNAKE[e]
    lines.push(`[hooks.state."${hooksJson}:${snake}:0:0"]`, `trusted_hash = "${codexHookHash(snake, cmdFor(e))}"`)
  }
  const blk = `# spexcode:trust:${proj} (managed — do not edit)\n${lines.join('\n')}\n# spexcode:trust:end:${proj}`
  const cleaned = stripCodexTrustFor(existsSync(file) ? readFileSync(file, 'utf8') : '', proj, hooksJson)
  if (!existsSync(home)) mkdirSync(home, { recursive: true })
  writeFileSync(file, cleaned ? `${cleaned}\n\n${blk}\n` : `${blk}\n`)
}

// the inverse of writeCodexTrust: strip THIS project's codex trust from the GLOBAL config.toml — the SAME
// removal writeCodexTrust does before it writes, so uninstall fully clears our trust (sentinel, bare, and
// hooks.state) and can never leave a half-block. No-op when the file/nothing-of-ours is absent (so it never
// rewrites/normalizes a config that carries none of our trust). CODEX_HOME respected for testability.
function removeCodexTrust(proj: string): void {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  const file = join(home, 'config.toml')
  if (!existsSync(file)) return
  const hooksJson = join(proj, '.codex', 'hooks.json')
  const cur = readFileSync(file, 'utf8')
  if (!cur.includes(`[projects."${proj}"]`) && !cur.includes(`[hooks.state."${hooksJson}:`) &&
      !cur.includes(`# spexcode:trust:${proj} `) && !cur.includes(`# spexcode:trust:end:${proj}`)) return
  const cleaned = stripCodexTrustFor(cur, proj, hooksJson)
  writeFileSync(file, cleaned ? `${cleaned}\n` : '')
}

// @@@ cleanHarness - the shared clean: the inverse of materialize's per-harness write, expressed PURELY
// through the adapter's own path methods so it can never drift from what write put there. Each step is
// surgical, gated on a SpexCode identity stamp: the contract files carry the managed-block sentinels; the shim
// is a generated file whose command line names our `dispatch.sh`; the trust is a sentinel-delimited config
// block; the skill/agent files sit at name-scoped paths reconstructed from `arts`. So it removes ONLY our own
// blocks and our own named products — never a user's CLAUDE.md/AGENTS.md prose, a hand-made settings.json, or
// a sibling skill/agent the user added, and NEVER any .spec data.
function cleanHarness(h: Harness, proj: string, arts: HarnessArtifacts): void {
  for (const f of h.contractFiles(proj)) removeManagedBlock(f, ['<!-- ', ' -->'], true)
  const shim = h.shimFile(proj)
  if (existsSync(shim) && readFileSync(shim, 'utf8').includes('dispatch.sh')) rmSync(shim, { force: true })
  const anchor = h.worktreeHookAnchor(proj)   // the linked-worktree anchor copy, same identity gate as the shim
  if (anchor && existsSync(anchor) && readFileSync(anchor, 'utf8').includes('dispatch.sh')) rmSync(anchor, { force: true })
  h.removeTrust(proj)
  const sd = h.skillDir(proj)
  if (sd) for (const n of arts.skills) rmSync(join(sd, n), { recursive: true, force: true })
  const ad = h.agentDir(proj)
  if (ad) for (const n of arts.agents) rmSync(join(ad, `${n}.md`), { force: true })
}

// ---------------------------------------------------------------------------------------------------------
// codex per-session liveness signal — a codex process live in the pane's DESCENDANT tree, NOT the pane's
// foreground command name, and NOT the shared app-server socket.

// @@@ paneTreeRunsCodex - the codex TUI is alive iff a codex-ish process is live SOMEWHERE in the launch
// pane's descendant process tree. The pane's FOREGROUND name is NOT the signal: the pane runs
// `bash <launch.sh>` → `bash -lc <codex script>` → node (the codex CLI) → the vendored `codex` binary, and
// tmux's `pane_current_command` reports the OUTERMOST of those — `bash` — for the entire life of a healthy,
// rendering TUI (field-confirmed on macmini and Linux). So "foreground == codex" false-read every live codex
// as offline, and the earlier sock-presence check false-read a dead one as online (the SHARED per-project
// app-server socket survives a failed `--remote resume`). The honest shape test: HEALTHY = codex (by whatever
// name — `codex`, the vendored musl binary, or the `node` its CLI runs under) exists among the pane pid's
// descendants; FAILED = the launch script's bounded retries exhausted, everything under the pane exited, and
// the pane sits at the bare shell — no codex/node anywhere below it. The walk is over ONE whole-box
// pid→(ppid, comm) snapshot the caller took (a single `ps` for the whole session list); missing probe data
// (tmux/ps couldn't report) is not-live, and the caller's boot grace still shows a fresh launch — whose tree
// may not yet contain codex — as 'starting', not 'offline'.
const CODEXISH = /^(codex|node)/i   // the vendored binary ('codex', 'codex-x86_64…') or the CLI's node runtime
export function paneTreeRunsCodex(pane?: PaneProbe): boolean {
  if (!pane?.panePid || !pane.procs?.size) return false
  const kids = new Map<number, number[]>()
  for (const [pid, p] of pane.procs) {
    const arr = kids.get(p.ppid); if (arr) arr.push(pid); else kids.set(p.ppid, [pid])
  }
  const stack = [...(kids.get(pane.panePid) ?? [])]   // descendants only — the pane pid itself is the shell
  while (stack.length) {
    const pid = stack.pop()!
    const comm = pane.procs.get(pid)?.comm ?? ''
    if (CODEXISH.test(comm.slice(comm.lastIndexOf('/') + 1))) return true   // basename — macOS ps comm is a full path
    const c = kids.get(pid); if (c) stack.push(...c)
  }
  return false
}

// ---------------------------------------------------------------------------------------------------------
// the two implementations.

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification'] as const
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

// the resolved base launcher command per harness (the wrapper that sets the config-dir env), shared by
// launchCmd and baseCmd so the two never diverge: `cmd` override wins, else ambient env→config→default.
const claudeBaseCmd = (cmd?: string) => cmd || process.env.SPEXCODE_CLAUDE_CMD || readConfig(mainCheckout()).sessions?.claudeCmd || 'claude --dangerously-skip-permissions'
const codexBaseCmd = (cmd?: string) => cmd || process.env.SPEXCODE_CODEX_CMD || readConfig(mainCheckout()).sessions?.codexCmd || 'codex --yolo'

export const claudeHarness: Harness = {
  id: 'claude',
  events: CLAUDE_EVENTS,
  ownsRendezvous: true,                              // reclaude opens the rendezvous control socket (prompt delivery + liveness)
  paneTitleIsSelfSummary: true,                      // claude writes its live task summary into the OSC pane title → headline derives from it
  launchCmd: (_id, _rt, cmd) => claudeBaseCmd(cmd),  // claude's full invocation IS its base command (the tail is appended by the caller)
  baseCmd: claudeBaseCmd,
  sessionIdArg: (id) => `--session-id ${id}`,        // the caller chooses the id
  sessionEnvVar: 'CLAUDE_CODE_SESSION_ID',
  shimFile: (proj) => join(proj, '.claude', 'settings.json'),
  worktreeHookAnchor: () => null,                    // claude's shim already lives in the worktree (.claude/settings.json) — self-anchors, no root rewrite
  contractFiles: (proj) => [join(proj, 'CLAUDE.md')],
  skillDir: (proj) => join(proj, '.claude', 'skills'),
  agentDir: (proj) => join(proj, '.claude', 'agents'),
  shim: (dispatch, spex) => buildShim('claude', CLAUDE_EVENTS, dispatch, spex),
  writeTrust: () => { /* Claude relies on folder-trust — nothing to write */ },
  removeTrust: () => { /* Claude wrote no trust — nothing to strip */ },
  clean(proj, arts) { cleanHarness(this, proj, arts) },
  slashCommands: claudeSlashCommands,
  // online iff the window is up AND a LIVE LISTENER is on the rendezvous socket (`socketLive`, connect-probed by
  // the caller) — NOT the mere existence of a stale socket FILE a crashed claude leaves behind (the 30-min
  // dead-pane-reads-working bug). See rendezvousListening.
  liveness: (_rec, tmuxAlive, _runtimeDir, _pane, socketLive) => (tmuxAlive && !!socketLive ? 'online' : 'offline'),
  deliver: (rec, text) => deliverViaRendezvous(rec.session, text),
  resumeArg: (rec) => `--resume ${rec.session}`,
}

export const codexHarness: Harness = {
  id: 'codex',
  events: CODEX_EVENTS,
  ownsRendezvous: false,                             // no reclaude daemon — liveness + prompts through the project app-server socket
  paneTitleIsSelfSummary: false,                     // codex's pane title is a spinner + the cwd folder name, NOT a task summary → headline uses the prompt
  launchCmd: (id, runtimeDir, cmd) => codexLaunchCommand(id, codexBaseCmd(cmd), undefined, runtimeDir ?? runtimeRoot()),   // the full app-server+TUI script BUILT AROUND the resolved base command; ONE app-server per PROJECT
  baseCmd: codexBaseCmd,
  sessionIdArg: () => '',                            // codex assigns its own id (the backend owns it via thread/start)
  sessionEnvVar: 'CODEX_THREAD_ID',
  // Codex discovers a LINKED worktree's PROJECT hooks from the ROOT CHECKOUT's `.codex`, NOT the worktree's
  // (codex-rs `root_checkout_hooks_folder_for_dir` rewrites the hooks-config folder to <repo_root>/<rel>/.codex
  // for any linked worktree). Every worktree's thread (cwd = worktree root) therefore reads the SAME
  // <mainCheckout>/.codex/hooks.json — so the codex hooks shim + its trust materialize at the MAIN checkout
  // (one per project, mirroring the per-project runtime tier), while the AGENTS.md contract + skills stay
  // per-worktree (codex loads THOSE by walking the thread cwd). dispatch.sh resolves `proj` from the thread
  // cwd, so one shared shim serves every worktree.
  shimFile: (proj) => join(mainCheckout(proj), '.codex', 'hooks.json'),
  // a LINKED worktree also needs its OWN `.codex/hooks.json` so codex-rs anchors the project config layer for
  // the worktree cwd (without a `.codex/` under the worktree root, codex builds no layer, so the rewritten
  // root-checkout hooks are never discovered and NO hooks fire — bypass_hook_trust cannot rescue a layer that
  // was never built). Its content is ignored (the rewrite reads the root's shim above), so it is a pure anchor.
  // Only for a genuine worktree: on the main checkout, shimFile already wrote `.codex/hooks.json` there.
  worktreeHookAnchor: (proj) => (mainCheckout(proj) === proj ? null : join(proj, '.codex', 'hooks.json')),
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],
  skillDir: (proj) => join(proj, '.codex', 'skills'),
  agentDir: () => null,                              // codex has no file-discovered agent-definition primitive — materialize skips it
  shim: (dispatch, spex) => buildShim('codex', CODEX_EVENTS, dispatch, spex),
  // Write the FULL codex trust — BOTH tiers, UNCONDITIONALLY — because `bypass_hook_trust` covers neither on
  // the dispatched-worker path:
  //   (1) PROJECT trust (`[projects."<mainCheckout>"] trust_level = "trusted"`) ENABLES the project config
  //       layer — the precondition for codex to DISCOVER our hooks AT ALL. codex-rs `get_layers` drops a
  //       disabled (untrusted) project layer BEFORE hook discovery runs, and bypass_hook_trust is read only
  //       AFTER, per-handler — so it can NEVER enable a layer. A dispatched worker's app-server does NOT
  //       auto-trust the project (only the interactive TUI / `codex exec` approval flow does), so without this
  //       an untrusted worktree thread fires ZERO hooks ("Project-local config, hooks … are disabled until the
  //       project is trusted").
  //   (2) per-HOOK trust (the reverse-engineered `trusted_hash` blocks — codexHookHash) marks each hook Trusted
  //       so it is NOT "new or changed". This is REQUIRED even though the launch carries
  //       `--dangerously-bypass-hook-trust`: our visible TUI attaches to the backend-owned thread via `codex …
  //       resume <tid>`, and codex-rs FORCES the startup hook-review prompt on a PERSISTENT RESUME regardless of
  //       the flag (`bypass_hook_trust_for_startup_review = config.bypass_hook_trust && !is_persistent_resume`,
  //       tui/src/lib.rs) — an untrusted/modified hook (no matching hash) leaves the worker WEDGED at an
  //       interactive "Hooks need review" menu. Matching hashes make review_needed_count == 0, so codex skips
  //       the prompt and the worker runs unattended. bypass_hook_trust stays on `thread/start` + the resume flag
  //       as DEFENCE for the non-resume paths (and if a version bump makes a hash mismatch, the app-server
  //       thread still runs the hooks); it does not REPLACE the hashes here.
  writeTrust: (proj, cmdFor) => writeCodexTrust(mainCheckout(proj), CODEX_EVENTS, cmdFor),
  // trust is keyed by the MAIN checkout (where the codex shim materializes) — strip it at the same key.
  removeTrust: (proj) => removeCodexTrust(mainCheckout(proj)),
  clean(proj, arts) { cleanHarness(this, proj, arts) },
  slashCommands: codexSlashCommands,
  // online iff the tmux window is up AND a codex-ish process is live in the pane pid's DESCENDANT tree — see
  // paneTreeRunsCodex. NOT the pane's foreground command (that is `bash`, the launch wrapper, even while the
  // TUI renders — the field-confirmed false-OFFLINE) and NOT the app-server socket (SHARED per-project, it
  // survives a failed `--remote resume` — the earlier false-ONLINE).
  liveness: (_rec, tmuxAlive, _runtimeDir, pane) => (tmuxAlive && paneTreeRunsCodex(pane) ? 'online' : 'offline'),
  deliver: (rec, text) => deliverViaCodexAppServer(rec, text),
  // owned thread id → `--resume <id>` MARKER the codex launch script reads to resume that thread DIRECTLY (NOT
  // a tail handed to a bare `codex` — the script's final `codex … resume "$tid"` performs codex's own resume on
  // the owned id, the SAME conversation); none → empty tail → relaunch a FRESH thread on the same worktree/record.
  resumeArg: (rec) => (rec.harnessSessionId ? `--resume ${rec.harnessSessionId}` : ''),
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

// --- named launcher profiles ([[launcher-select]]) ----------------------------------------------------------
// a launcher = a `{ harness, cmd }` pair in spexcode.json's `sessions.launchers`, keyed by a human-chosen name.
// harness defaults to claude. resolveLauncher throws fail-loud on an unknown name (a session must never
// silently launch under the wrong auth) and validates the harness id.
export type Launcher = { name: string; harness: string; cmd: string }

// the configured launchers, as a stable name-sorted list (for the dashboard dropdown + the CLI). Empty when a
// project configured none — the caller then falls back to the unnamed harness pick.
export function launcherList(root = mainCheckout()): Launcher[] {
  const m = readConfig(root).sessions?.launchers || {}
  return Object.keys(m).sort().map((name) => ({ name, harness: m[name].harness || defaultHarness.id, cmd: m[name].cmd }))
}

// the configured default launcher NAME ([[launcher-select]]) — the profile `spex new`/a dropdown pick with no
// explicit choice resolves. '' when none configured. The dashboard reads this to PRE-SELECT its New-Session
// dropdown to match the CLI/config default, so the two surfaces agree on which launcher a bare create uses.
export function defaultLauncher(root = mainCheckout()): string {
  return readConfig(root).sessions?.defaultLauncher || ''
}

export function resolveLauncher(name: string, root = mainCheckout()): Launcher {
  const l = readConfig(root).sessions?.launchers?.[name]
  if (!l || !l.cmd) throw new Error(`unknown launcher '${name}' (configured: ${launcherList(root).map((x) => x.name).join(', ') || 'none'})`)
  harnessById(l.harness || defaultHarness.id)   // validate the harness id fail-loud
  return { name, harness: l.harness || defaultHarness.id, cmd: l.cmd }
}
