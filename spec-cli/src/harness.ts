import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { claudeSlashCommands, codexSlashCommands, opencodeSlashCommands, piSlashCommands, type SlashCommand } from './slash-commands.js'
import { OPENCODE_EVENTS, opencodePluginSource } from './opencode.js'
import { piExtensionSource, writePiTrust, removePiTrust } from './pi-harness.js'
import { runtimeRoot, mainCheckout, readConfig, sessionStoreDir, sessionArtifactPath } from './layout.js'
import { git } from './git.js'
// type-only (erased at runtime, so no import cycle with sessions.ts): the headless capability object speaks
// in the session vocabulary — the full record (its declared status is headless liveness truth between turns)
// and the composed Liveness axis.
import type { SessRec, Liveness } from './sessions.js'

// @@@ harness-adapter - the ONE seam between SpexCode and the coding-agent harness (Claude Code, Codex, …).
// Every harness-specific fact lives behind THIS interface with one implementation per harness; product code
// (materialize, sessions, slash, the hook scripts) never branches on which harness it is — it resolves an
// adapter ONCE and calls it. The only `if (codex)` / `if (claude)` in the whole product is the detector that
// picks the adapter (here), plus its shell mirror in hooks/harness.sh (shell cannot import this module).
//
// DETECTION. There is no payload-sniffing: each adapter OWNS its shim, and the shim bakes the harness id as
// dispatch.sh's first argument (`bash <dispatch> <id> <Event>`). dispatch.sh exports SPEXCODE_HARNESS, so a
// hook subprocess learns its harness deterministically from the shim that wired it — never from guessing the
// payload shape. On the TS side the harness is derived from the selected launcher or ALL adapters at once
// (materialize writes every harness's artifacts).

export type HarnessId = 'claude' | 'codex' | 'opencode' | 'pi'
export type HarnessLivenessRecord = { session: string; harnessSessionId?: string | null }
// the per-pane runtime probe the caller snapshots ONCE for the whole session list and hands liveness():
// the pane's root pid (tmux `#{pane_pid}`), the hot-tier `pidAlive` verdict, and — ONLY on the legacy path —
// one whole-box pid→(ppid, comm) table (a single `ps` spawn).
//   `pidAlive` = the hot registry's verdict for THIS session's launch-registered `agent.pid`: true = the pid
//     answers kill-0 (alive), false = proven dead (ESRCH, permanently latched per pid-reuse guard), undefined =
//     NO agent.pid file (a pre-registration/old session). codex reads this as its liveness truth when present
//     and falls back to `procs` (the whole-box tree walk) only when it is undefined; claude ignores it (its
//     truth is the rendezvous socket).
//   `procs` is gathered (the single `ps` spawn) ONLY when a pid-less codex session still needs the legacy
//     tree-walk, so a box with no codex — or all pid-registered launches — never pays for it.
export type ProcTable = Map<number, { ppid: number; comm: string }>
export type PaneProbe = { panePid?: number; procs?: ProcTable; pidAlive?: boolean }

// @@@ HarnessHeadless - a harness's HEADLESS (one-shot turn) capability object, mirroring agentDir's
// "null = no such primitive" pattern. A session's `mode` is a PRODUCT dimension; the harness differences of
// running headless live ENTIRELY behind this object — product code routes per mode
// (`const ops = rec.mode === 'headless' && h.headless ? h.headless : h`), never per harness. All four
// harnesses carry a live capability: claude, pi, and opencode are ONE-SHOT-PROCESS-PER-TURN forms built by
// the shared oneShotHeadlessOps builder from per-harness DATA (each one's busy-process matcher, trust flag,
// and continue-this-conversation turn flag — see its @@@ block); codex carries its inline ops (the executor
// already lives in the shared app-server, so the pane never runs a second agent — see the codex adapter's
// headless block). `null` remains the contract for a future harness with no headless form — a headless
// create on one fails loud at the create path.
export interface HarnessHeadless {
  // whether this harness's headless form needs its OWN agent command (the launcher's `headlessCmd`).
  // claude/pi/opencode: true — the one-shot invocation (`… -p` / `pi -p` / `opencode run`) IS that command.
  // codex: false — the executor is the app-server, derived from the pinned interactive `cmd`
  // (version-parity invariant), so no second command exists and `headlessCmd` is ignored.
  readonly needsCmd: boolean
  // the pane-side launch script. The configured command is embedded WHOLE — zero parsing, zero rewriting
  // (the config author writes the full invocation; the system never edits its internals). Adapter-OWNED
  // flags (e.g. pi's `--approve` one-run trust) may be APPENDED after it, exactly as the interactive
  // launchCmd appends them — appending is not rewriting.
  launchCmd(id: string, runtimeDir: string | undefined, cmd: string | undefined): string
  // TURN-scoped liveness: online only while a turn is actually executing; between turns the record's
  // DECLARED lifecycle is the truth (the stop-gate guarantees a non-crash exit declares). Same optionality as
  // Harness.liveness so the two are callable through the harnessOps union with the caller's ONE snapshot.
  liveness(rec: SessRec, tmuxAlive: boolean, runtimeDir?: string, pane?: PaneProbe, socketLive?: boolean): Liveness
  // headless prompt delivery — the NEXT turn. A still-running turn refuses loud (never a silent queue).
  deliver(rec: SessRec, text: string): Promise<DispatchResult>
  // reopen semantics: a headless session's continuation is its next delivery, not a TUI re-attach.
  resumeArg(rec: SessRec): string
}

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
  // the headless capability object (see HarnessHeadless above), or null when this harness has no headless
  // form yet — a headless create on it fails loud at the create path.
  readonly headless: HarnessHeadless | null

  // --- launch / sessionId ---
  // the base agent command. Claude: `claude …`; Codex starts a project-scoped app-server and launches the
  // visible TUI with `--remote` pointed at it. `cmd` is the SESSION's persisted launcher command
  // ([[launcher-select]]) — the resolved `cmd` of the named launcher it was created under. A session always
  // carries one (pinned at creation), so resume keeps that exact command (and auth), never reverting to a
  // global default. Omitted is only for tests and old records before launch_cmd was pinned (→ the bare default).
  launchCmd(id: string, runtimeDir?: string, cmd?: string): string
  // the RESOLVED base launcher command alone — the wrapper/binary that carries the agent's config-dir env
  // (claude `CLAUDE_CONFIG_DIR`, codex `CODEX_HOME`), WITHOUT the per-launch script built around it. `cmd`,
  // when given (the named launcher's `cmd`), IS the answer; else the harness's bare built-in default — there is
  // no env/config-field resolution (claude/codex are ordinary named launchers). The launch owner PINS this on the record
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
  // the shim payload: `content` is whatever artifact THIS harness auto-discovers to wire every event to the
  // dispatcher (harness id baked in) — a settings/hooks JSON for claude/codex, a generated event-bus PLUGIN
  // for opencode, a generated TypeScript EXTENSION for pi — plus the per-event command string (shared with
  // the trust writer so they hash identically).
  shim(dispatch: string, spex: string): { content: string; cmd: (e: string) => string }
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
  // pane probe). codex: online iff the window is up AND the launch-registered `agent.pid` is alive
  // (`pane.pidAlive`, the hot-tier kill-0 verdict — zero ps scan); a pre-registration session with no agent.pid
  // (`pidAlive` undefined) falls back to the LEGACY whole-box tree walk — a codex-ish process (`codex` by any
  // name, or the `node` its CLI runs under) live in the pane pid's DESCENDANT tree, NOT the pane's foreground
  // command name (that is `bash`, the launch wrapper, even while the TUI renders — field-confirmed), and NOT the
  // SHARED per-project app-server socket (it stays bound after a failed `--remote resume` dropped the pane back
  // to the shell). A missing probe (tmux/ps couldn't report) is not-live. The 'starting' boot
  // grace lives in the caller (sessions.ts liveness), so a still-booting pane reads starting, not offline.
  liveness(rec: HarnessLivenessRecord, tmuxAlive: boolean, runtimeDir?: string, pane?: PaneProbe, socketLive?: boolean): 'online' | 'offline'
  // deliver a follow-up prompt to a LIVE session and report whether it landed. claude: through the rendezvous
  // control socket — an ATOMIC reply+repaint chunk whose `repaint-done` proves the reply was PARSED; a close
  // before it proves a concurrent connect kicked the chunk (the daemon is single-connection) → resend; a wall
  // expiry on a still-open connection is a busy-not-lost agent → optimistic ok (see replyViaSocket). codex:
  // JSON-RPC on the same app-server WebSocket the
  // visible TUI uses — it reads the thread live and either `turn/steer`s the message INTO an in-progress turn
  // (mid-turn, not queued for after the agent stops) or `turn/start`s a fresh turn when the thread is idle.
  // Returns ok=false with a reason that propagates to the API.
  deliver(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult>
  // the ONE pane state where this harness SWALLOWS a prompt that its delivery channel confirms (so no
  // socket-side check can see it): given the live pane text, return the loud human-readable refusal (naming
  // the recovery) or null when the pane can take a prompt. sendText captures the pane once and consults this
  // BEFORE delivering; absent on harnesses with no such state (codex delivery ignores the pane). claude: the
  // TUI's sessions panel ("← for agents") enqueues an injected reply to the panel context and never drains it
  // — verified live: parsed + enqueued, no dequeue, no turn, daemon silent.
  deliveryBlockedBy?(paneText: string): string | null
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
// the DAEMON-PARSE layer (the atomic reply+repaint chunk answered `repaint-done`, or the wall expired on a
// still-open connection — busy, not lost; see replyViaSocket); codex at the application layer (the app-server
// accepted `turn/steer`/`turn/start`). `error` carries a human-readable reason that propagates to the API route
// (non-2xx) and the CLI/dashboard. Defined here because it is the harness DELIVERY contract; sessions.ts
// re-exports it for its existing importers.
export type DispatchResult = { ok: boolean; error?: string }
export type HarnessDeliveryRecord = { session: string; worktreePath?: string; harnessSessionId?: string | null; runtimeDir?: string }
// the on-demand surface artifacts a materialize pass wrote, by node NAME — so clean() knows EXACTLY which
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
// connect() to the socket. The verdict is TRI-STATE, because only two probe results actually PROVE anything:
//   'live'  — the connect completed: a real claude is accepting.
//   'dead'  — ECONNREFUSED (a stale file nothing listens on) / ENOENT (no file): death PROVEN, instantly.
//   'unproven' — the probe itself failed to conclude: a TIMEOUT (under load the prober's event loop fires the
//     expired timer before the pending connect event — the thrashed-backend incident where every live worker
//     read offline in one board answer), or EAGAIN (the listen backlog is FULL, which proves a listener is
//     alive-but-busy, the opposite of dead). Collapsing these into 'dead' is how a load spike masqueraded as
//     a graveyard (issue #40); the caller must render unproven death as `unknown`, never `offline`.
// The common cases cost no waiting (connect/refuse/absent are instant); the short timeout only bounds the
// wedged/thrashed path. Never throws.
export type ListenerProbe = 'live' | 'dead' | 'unproven'
const PROVEN_DEAD = new Set(['ECONNREFUSED', 'ENOENT'])
export function rendezvousListening(id: string, timeoutMs = 800): Promise<ListenerProbe> {
  return new Promise((resolve) => {
    let settled = false
    let c: ReturnType<typeof createConnection> | undefined
    const done = (v: ListenerProbe) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { c?.destroy() } catch { /* */ }
      resolve(v)
    }
    const timer = setTimeout(() => done('unproven'), timeoutMs)
    try { c = createConnection({ path: rvSock(id) }) } catch { return done('unproven') }
    c.on('connect', () => done('live'))
    c.on('error', (e) => done(PROVEN_DEAD.has((e as NodeJS.ErrnoException).code ?? '') ? 'dead' : 'unproven'))
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

// the spex launcher (bin/spex.mjs), baked into the codex launch script (mirrors materialize.ts's SPEX) so
// the launch shell can call back into `spex codex-launch` to own the thread + fire the first turn before it
// exec's the visible TUI. The launcher, never a raw `tsx cli.ts` pair: it owns tsx resolution and the
// mid-merge guard (conflicted source → one line + exit 75, not a stacktrace).
const PKG = fileURLToPath(new URL('..', import.meta.url))
const SPEX = join(PKG, 'bin', 'spex.mjs')

// @@@ replyViaSocket - ATOMIC parse-confirmed delivery. The daemon is SINGLE-CONNECTION: a new connect
// `destroy()`s the previous socket, discarding any received-but-not-yet-parsed line with it — and our own
// `rendezvousListening` liveness probe IS such a connect, fired for every session on every board snapshot. So
// the previous optimistic write (return ok once the reply line flushed) LOST prompts whenever a probe landed in
// the write→parse window, a window that widens exactly when claude is busy mid-turn (field: dashboard messages
// recorded `sent` with no trace in the claude transcript; measured 2/10 lost under a 20ms probe hammer). The
// daemon parses a chunk's complete lines in ONE synchronous loop, so writing `{type:reply}` + `{type:repaint}`
// as ONE chunk makes the pair indivisible — a kick loses BOTH or NEITHER — and the outcome decidable from this
// connection alone:
//   `repaint-done` arrives  → the reply line before it was parsed (in-order barrier) → ok, CONFIRMED.
//   'close' before it       → the chunk was never parsed (kicked by a concurrent connect) → resolve kicked:true
//                             so deliverViaRendezvous RESENDS — a proven loss, so the retry cannot duplicate.
//   wall expires, conn open → a busy event loop is DELAYING, not losing (the 2500ms-wall lesson: ack absence is
//                             NOT non-delivery) → ok, OPTIMISTIC — never a false failure on a busy worker.
//   `reply-rejected`/`auth-rejected`/`shutting-down` → loud failure, not retried.
// Other daemon lines (heartbeat, state patches) are ignored. Never throws.
type ReplyOutcome = DispatchResult & { kicked?: boolean }
function replyViaSocket(sock: string, text: string, wallMs = 10_000): Promise<ReplyOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let c: ReturnType<typeof createConnection>
    const done = (r: ReplyOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(wall)
      try { c?.destroy() } catch { /* */ }
      resolve(r)
    }
    const wall = setTimeout(() => done({ ok: true }), wallMs)
    try {
      c = createConnection({ path: sock })
    } catch (e) {
      done({ ok: false, error: `rendezvous socket connect threw: ${String(e)}` })
      return
    }
    // ECONNRESET/EPIPE are the KICK surfacing as an error: the daemon destroy()s the previous connection the
    // moment a new one connects, and destroying a socket with OUR chunk still unread raises RST — whereas a
    // parsed chunk answers repaint-done (readable even after a later close) before any clean FIN. So both codes
    // PROVE the chunk was never parsed → retryable, same as the clean pre-parse close. ECONNREFUSED/ENOENT
    // (daemon gone) stay loud.
    c.on('error', (e: NodeJS.ErrnoException) => {
      const code = e?.code || String(e)
      const kicked = code === 'ECONNRESET' || code === 'EPIPE'
      done({ ok: false, ...(kicked ? { kicked } : {}), error: `rendezvous socket error: ${code} — prompt NOT delivered` })
    })
    c.on('close', () => done({ ok: false, kicked: true, error: 'rendezvous connection was closed before the daemon parsed the prompt (kicked by a concurrent connect)' }))
    c.on('connect', () => c.write(JSON.stringify({ type: 'reply', text }) + '\n' + JSON.stringify({ type: 'repaint' }) + '\n'))
    let buf = ''
    c.on('data', (d) => {
      buf += d.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let type = ''
        try { type = (JSON.parse(line) as { type?: string })?.type ?? '' } catch { continue }
        if (type === 'repaint-done') return done({ ok: true })
        if (type === 'reply-rejected' || type === 'auth-rejected') return done({ ok: false, error: `rendezvous daemon rejected the prompt (${type}) — prompt NOT delivered` })
        if (type === 'shutting-down') return done({ ok: false, error: 'agent is shutting down — prompt NOT delivered' })
      }
    })
  })
}
// claude's deliver: the pre-write LIVENESS gate — fail loud BEFORE attempting the socket if it isn't there (a
// clearer message than a raw connect error, and the delivery's confirmation layer: socket present = agent
// alive). Then the atomic parse-confirmed write; a KICKED outcome is a proven whole-chunk loss, so it resends
// (bounded attempts + jitter so re-collision with the probe cadence is unlikely); exhausted retries fail loud.
const DELIVER_ATTEMPTS = 3
export async function deliverViaRendezvous(id: string, text: string, wallMs?: number): Promise<DispatchResult> {
  const sock = rvSock(id)
  if (!existsSync(sock)) return { ok: false, error: `no rendezvous control socket for session ${id} (socketless/old session, or the agent is offline) — prompt NOT delivered` }
  let last: ReplyOutcome = { ok: false, error: 'not attempted' }
  for (let attempt = 1; attempt <= DELIVER_ATTEMPTS; attempt++) {
    last = await replyViaSocket(sock, text, wallMs)
    if (last.ok || !last.kicked) return { ok: last.ok, ...(last.error ? { error: last.error } : {}) }
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 140))
  }
  return { ok: false, error: `rendezvous delivery was kicked by concurrent connects ${DELIVER_ATTEMPTS}× — prompt NOT delivered, retry the send` }
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
// `headless` swaps ONLY the final pane line: instead of attaching the visible `--remote … resume` TUI, the
// pane holds a READ-ONLY placeholder (a banner + `tail -f` of the shared app-server log). Everything before it
// — app-server bootstrap, mkdir lock, codex-launch thread/start + first turn + rollout wait, the `--resume`
// marker branch — is byte-identical, because the task's execution body ALREADY lives in the app-server first
// turn on both paths. That is the structural no-double-run guarantee: headless has no second agent process to
// even start (the mbp wrapper incident ran the task prompt AND a pane "Continue…" turn concurrently for 34min;
// here the pane holds no agent at all). `headlessCmd` never participates — the app-server binary derivation
// stays on the pinned interactive `cmd`'s first token (the version-parity invariant above).
export function codexLaunchCommand(_id: string, codexCmd = 'codex --yolo', serverCmd?: string, dir = runtimeRoot(), headless = false): string {
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
    // interactive: attach the visible TUI to the thread. headless: NO agent in the pane — a banner naming the
    // thread, then a read-only tail of the app-server log keeps the pane (and the close/liveness window
    // semantics) alive without ever running a second executor.
    ...(headless
      ? [
          `printf '[spexcode] headless codex thread %s\\n[spexcode] the agent runs on the project app-server; this pane is a read-only log tail\\n' "$tid"`,
          `exec tail -f "$log"`,
        ]
      : [`exec ${codexCmd}${tuiBypass} --remote unix://"$sock" resume "$tid"`]),
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

// @@@ codexThreadsInProgress - the HEADLESS turn-scoped liveness probe ([[harness-adapter]] headless): one WS
// connection to the project app-server, one `thread/read{includeTurns}` per owned thread id, answering which
// threads have an in-progress turn RIGHT NOW. The caller (sessions.ts liveSnapshot) batches every windowed
// codex-headless session into a single call per snapshot — the headless analog of the rendezvous-listener
// sweep. Shape re-verified live on codex 0.144.3 (2026-07-17): turns[].status is "inProgress" while running,
// "completed" after — identical to the 0.142.x pin, so activeTurnIdFromThread decides each read. Outcomes are
// tri-state like rendezvousListening, because only two prove anything: `ok` (every read answered — a read that
// ERRORS, e.g. a thread "not materialized before its first user message", proves no turn is running on it, so
// it counts as idle, not as a probe failure); `dead` (connect refused/ENOENT — the app-server is down, and the
// app-server IS the headless executor, so its death is the sessions' death); `timeout` (the wall expired on a
// live connection — a busy server is not a dead one, so the caller renders unknown, never a false offline).
export function codexThreadsInProgress(sock: string, threadIds: string[], timeoutMs = 4000): Promise<
  { ok: true; inProgress: Set<string> } | { ok: false; dead?: boolean; timeout?: boolean; error: string }
> {
  return new Promise((resolve) => {
    if (!threadIds.length) return resolve({ ok: true, inProgress: new Set() })
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    const inProgress = new Set<string>()
    let answered = 0, upgraded = false, settled = false
    const BASE = 100   // request ids 100+i → threadIds[i]; keeps clear of the initialize handshake's id 1
    const done = (r: { ok: true; inProgress: Set<string> } | { ok: false; dead?: boolean; timeout?: boolean; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, timeout: true, error: `codex app-server did not answer ${threadIds.length} thread reads within ${timeoutMs}ms` }), timeoutMs)
    conn.on('error', (e) => done({ ok: false, dead: true, error: `codex app-server connection failed: ${rpcError(e)}` }))
    conn.on('close', () => done({ ok: false, dead: true, error: 'codex app-server closed before the thread reads were answered' }))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.id === 1 && m.result) {
        send({ method: 'initialized', params: {} })
        threadIds.forEach((tid, i) => send({ id: BASE + i, method: 'thread/read', params: { threadId: tid, includeTurns: true } }))
        return
      }
      if (typeof m.id !== 'number' || m.id < BASE || m.id >= BASE + threadIds.length) return
      if (!m.error && m.result && activeTurnIdFromThread(m.result)) inProgress.add(threadIds[m.id - BASE])
      if (++answered === threadIds.length) done({ ok: true, inProgress })
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, dead: true, error: `codex app-server refused the WebSocket upgrade: ${head.split('\r\n')[0]}` })
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, dead: true, error: 'codex app-server sent a WebSocket close before the thread reads were answered' })
    })
  })
}

// @@@ codex rollout on disk - the visible TUI resumes a thread via `codex --remote resume <tid>`, which reads
// the thread's ROLLOUT FILE (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<ts>-<tid>.jsonl`) — so a thread the
// TUI can render is exactly one whose rollout exists on disk. VERIFIED live (real codex 0.142.5): `thread/start`
// ALONE writes NO rollout — only the first fired turn materializes it; and a FRESHLY-spawned app-server accepts
// thread/start+turn but does NOT persist the rollout for its first ~2-4s (a warm-up window) — the SAME thread's
// rollout just lands a few seconds LATE (not lost). Handing the id to `resume` before then is the "no rollout
// found for thread id" failure, so codex-launch WAITS for the rollout to land before it trusts the id.
const codexSessionsDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
// does a rollout file for this thread id exist yet? Rollouts are grouped by date; walk day-dirs newest-first
// (lexical order = chronological on zero-padded YYYY/MM/DD) and return on first hit — the fresh rollout lives in
// the newest real dir, so the common case reads one dir. The walk is exhaustive, never capped at "the newest few
// dirs": future-dated junk under sessions/ (a test once planted 2099/12/* in the real CODEX_HOME) sorts above
// every real day-dir, and a cap let three such dirs mask ALL real rollouts — every codex launch then failed
// "persisted no rollout" with the rollout sitting on disk. A full walk is a readdir per day-dir — still cheap.
export function codexRolloutExists(threadId: string, root = codexSessionsDir()): boolean {
  const kids = (d: string) => { try { return readdirSync(d).sort().reverse() } catch { return [] as string[] } }
  for (const y of kids(root)) for (const m of kids(join(root, y))) for (const d of kids(join(root, y, m))) {
    if (kids(join(root, y, m, d)).some((f) => f.includes(threadId))) return true
  }
  return false
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
  // blank-line runs in the user's file, which broke the policy round-trip ([[residence]]): a mode flip
  // and back left a spurious one-line diff on a .gitignore that had internal blank lines. The leading-newline
  // strip is GUARDED the same way: it exists only for a block sitting at the TOP of the file (whose '\n'
  // replacement would otherwise become a leading blank) — a host file that BEGINS with its own blank lines
  // keeps them ([[content-filter]]'s invariant, same bug class as the shim's old unconditional strip).
  const atTop = (re.exec(cur)?.index ?? -1) === 0
  const replaced = cur.replace(re, '\n')
  const out = atTop ? replaced.replace(/^\n+/, '') : replaced
  if (deleteIfEmpty && !out.trim()) { rmSync(file, { force: true }); return }
  writeFileSync(file, out)
}

// the shim for one harness: every event → `SPEX='…' bash <dispatch> <harnessId> <Event>`. The harness id is
// baked in so dispatch.sh can export SPEXCODE_HARNESS (the detector for the shell side). SPEX is inherited by
// the cli-needing handlers.
function buildShim(id: HarnessId, events: readonly string[], dispatch: string, spex: string): { content: string; cmd: (e: string) => string } {
  const cmd = (e: string) => `SPEX='${spex}' bash ${dispatch} ${id} ${e}`
  const hooks: Record<string, unknown> = {}
  for (const e of events) hooks[e] = [{ hooks: [{ type: 'command', command: cmd(e) }] }]
  return { content: JSON.stringify({ hooks }, null, 2), cmd }
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

// is this file git-tracked in proj? (guards cleanHarness's deleteIfEmpty; env-stripped git, never throws)
function isTrackedFile(proj: string, f: string): boolean {
  try { git(['-C', proj, 'ls-files', '--error-unmatch', f]); return true } catch { return false }
}

// @@@ cleanHarness - the shared clean: the inverse of materialize's per-harness write, expressed PURELY
// through the adapter's own path methods so it can never drift from what write put there. Each step is
// surgical, gated on a SpexCode identity stamp: the contract files carry the managed-block sentinels; the shim
// is a generated file whose command line names our `dispatch.sh`; the trust is a sentinel-delimited config
// block; the skill/agent files sit at name-scoped paths reconstructed from `arts`. So it removes ONLY our own
// blocks and our own named products — never a user's CLAUDE.md/AGENTS.md prose, a hand-made settings.json, or
// a sibling skill/agent the user added, and NEVER any .spec data.
function cleanHarness(h: Harness, proj: string, arts: HarnessArtifacts): void {
  // deleteIfEmpty ONLY for an UNTRACKED contract file: a wholly-ours generated file goes; a HOST-TRACKED file
  // that carried nothing but our block (an empty committed CLAUDE.md we folded into) is stripped back to its
  // pristine emptiness but never deleted — deleting a tracked file would surface as a `D` in the host's status.
  for (const f of h.contractFiles(proj)) removeManagedBlock(f, ['<!-- ', ' -->'], !isTrackedFile(proj, f))
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
// claude's one-shot process tree: the CLI runs as `claude` or as its node runtime (a wrapper like reclaude is
// bash and execs down to it). Used by the HEADLESS claude liveness/busy probe only — interactive claude's
// truth stays the rendezvous socket.
const CLAUDEISH = /^(claude|node)/i
// pi's / opencode's one-shot process trees, same role for THEIR headless probes (interactive pi/opencode
// liveness stays the rendezvous socket): each CLI runs as its own binary or under its JS runtime — pi is an
// npm bin (node), opencode ships compiled bun binaries (`opencode`, `opencode-linux-x64`, …). `pi\b` so a
// tool subprocess named `ping`/`pip` under the pane never reads as the agent.
const PIISH = /^(pi\b|node|bun)/i
const OPENCODEISH = /^(opencode|node|bun)/i
// the shared descendant-tree walk: does a process matching `re` live BELOW the pane pid? (The pane pid itself
// is the shell, so descendants only.) Pure over the caller's one ps snapshot.
function paneTreeRuns(pane: PaneProbe | undefined, re: RegExp): boolean {
  if (!pane?.panePid || !pane.procs?.size) return false
  const kids = new Map<number, number[]>()
  for (const [pid, p] of pane.procs) {
    const arr = kids.get(p.ppid); if (arr) arr.push(pid); else kids.set(p.ppid, [pid])
  }
  const stack = [...(kids.get(pane.panePid) ?? [])]   // descendants only — the pane pid itself is the shell
  while (stack.length) {
    const pid = stack.pop()!
    const comm = pane.procs.get(pid)?.comm ?? ''
    if (re.test(comm.slice(comm.lastIndexOf('/') + 1))) return true   // basename — macOS ps comm is a full path
    const c = kids.get(pid); if (c) stack.push(...c)
  }
  return false
}
export function paneTreeRunsCodex(pane?: PaneProbe): boolean { return paneTreeRuns(pane, CODEXISH) }

// ONE whole-box pid→(ppid, comm) snapshot (a single `ps` spawn) — the table paneTreeRuns walks. Owned here
// (beside its consumers) and shared with sessions.ts's liveSnapshot, so the two probe layers can never parse
// ps differently. A failed/timed-out ps returns an empty table: the callers read that as not-provably-running.
export async function procSnapshot(timeoutMs = 4000): Promise<ProcTable> {
  const t: ProcTable = new Map()
  let out = ''
  try { ({ stdout: out } = await pexec('ps', ['-eo', 'pid=,ppid=,comm='], { timeout: timeoutMs, killSignal: 'SIGKILL' })) } catch { return t }
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) t.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3].trim() })
  }
  return t
}

// ---------------------------------------------------------------------------------------------------------
// @@@ one-shot headless ops - the SHARED headless capability builder ([[harness-adapter]] HarnessHeadless)
// for every harness whose headless form is a ONE-SHOT PROCESS PER TURN, not a resident TUI: claude (`… -p`),
// pi (`pi -p`), and opencode (`opencode run`). The machinery — launch embedding the pinned headlessCmd
// whole, turn-scoped liveness, next-turn delivery via an injected turn script, empty resumeArg — is written
// ONCE here; what differs per harness is pure DATA (a OneShotSpec), so adding a one-shot harness adds a
// spec object, never a code branch. Everything is TURN-scoped:
//
//   launch    — the pinned `headlessCmd` runs WHOLE in the pane (`<headlessCmd> [trust args] <tail>`, the
//               caller appends the tail exactly as interactive); no rendezvous env is injected (there is
//               no daemon to rendezvous with) and the launch template treats exit 0 as COMPLETION, never a
//               fast-fail to retry (sessions.ts launchScript, the mode branch).
//   liveness  — online only WHILE a turn executes. Primary signal: the launch/turn-registered `agent.pid`
//               hot-tier verdict (`pidAlive` — both the launch script and the injected turn script re-register
//               it, so every turn is covered); legacy fallback: an agent-ish process (the spec's matcher)
//               among the pane pid's descendants. Between turns the process is GONE and liveness honestly
//               reads offline — the record's DECLARED lifecycle is the between-turn truth (the stop-gate
//               guarantees a non-crash exit declares), so reconcile shows the declaration; a session still
//               `active` with no process is a genuine crash and reads offline. NO harness `if` anywhere:
//               product code reaches this only through the mode-routed ops object.
//   deliver   — the NEXT turn: when the pane is idle, inject `bash <turn.sh>` where turn.sh re-registers
//               agent.pid then execs the pinned headlessCmd with the spec's continue-this-conversation flag
//               (claude `--resume <record id>`; pi `--session <record id>` — the id we pinned at launch;
//               opencode `--session <captured harness id>`, falling to `--continue`, opencode's own
//               last-session-in-this-directory, which in a dedicated worktree is this worker's) — the SAME
//               script-file + born-registration shape as the launch, never a bare send-keys paste. A
//               still-running turn REFUSES loud (two concurrent one-shot turns on one conversation are
//               undefined behaviour); a missing window refuses loud naming `spex session resume` (which
//               recreates it). Delivery is confirmed when the turn PROCESS provably started (agent.pid
//               freshly re-registered) — the hooks then advance the record and the timeline exactly as at
//               launch.
//   resume    — a headless session's continuation IS its next delivery: resumeArg is empty and sessions.ts
//               never relaunches the one-shot command bare (it would fabricate no prompt — the system never
//               invents an instruction on the human's behalf).
type OneShotSpec = {
  id: HarnessId                            // names the harness in fail-loud messages
  agentish: RegExp                         // the turn-process matcher (deliver's busy gate + liveness fallback)
  launchArgs: string                       // adapter-owned flags appended after the pinned cmd on BOTH the
                                           // launch and every injected turn ('' for most; pi: '--approve',
                                           // its one-run project trust — same defence the interactive launch
                                           // carries, so a worktree outside the checkout still loads the shim)
  resumeTurnArg: (rec: SessRec) => string  // the "continue THIS conversation" flag for an injected turn
  // the SHELL form of the same flag, for the in-script undeclared-exit recovery below (the script must
  // compute it at RUN time — opencode's captured harness id may not exist when the script is baked): lines
  // that set `$_res`. claude/pi resume by the RECORD id, known at bake; opencode reads harness_session_id
  // out of session.json, falling to --continue.
  resumeTurnShell: (id: string, sessJsonQuoted: string) => string[]
}
export type { OneShotSpec }
// the per-harness DATA the builder consumes — exported as a registry so tests audit each harness's turn
// composition through the same objects the adapters are built from (one truth, no duplicate fixtures).
//   claude — the launch tail pinned `--session-id <record id>`, so a turn resumes it with `--resume`.
//   pi     — claude-shaped: the tail pinned `--session-id <record id>` too, and a turn resumes that exact id
//            with `--session` (which FAILS LOUD when the session file is gone, never silently minting an
//            empty one — same choice as the interactive resumeArg). `--approve` rides launch AND every turn:
//            each turn is a fresh pi process that must load the project extension (the hook shim) with zero
//            prompts.
//   opencode — it mints its own session id; the plugin (which opencode loads in `run` mode exactly as in the
//            TUI) captures it onto the record as harness_session_id, so a turn resumes the captured id — or
//            falls to `--continue` (opencode's own "last session in this directory", this worker's in a
//            dedicated worktree) for a session whose capture never landed, mirroring the interactive
//            resumeArg.
export const ONE_SHOT_HEADLESS: Record<'claude' | 'pi' | 'opencode', OneShotSpec> = {
  claude: {
    id: 'claude', agentish: CLAUDEISH, launchArgs: '',
    resumeTurnArg: (rec) => `--resume ${rec.session}`,
    resumeTurnShell: (id) => [`_res="--resume ${id}"`],
  },
  pi: {
    id: 'pi', agentish: PIISH, launchArgs: '--approve',
    resumeTurnArg: (rec) => `--session ${rec.session}`,
    resumeTurnShell: (id) => [`_res="--session ${id}"`],
  },
  opencode: {
    id: 'opencode', agentish: OPENCODEISH, launchArgs: '',
    resumeTurnArg: (rec) => (rec.harnessSessionId ? `--session ${rec.harnessSessionId}` : '--continue'),
    resumeTurnShell: (_id, sessJson) => [
      `_hsid=$(sed -n 's/.*"harness_session_id": "\\([^"]*\\)".*/\\1/p' ${sessJson} 2>/dev/null | head -1)`,
      `if [ -n "$_hsid" ]; then _res="--session $_hsid"; else _res="--continue"; fi`,
    ],
  },
}
const withLaunchArgs = (cmd: string, spec: OneShotSpec) => (spec.launchArgs ? `${cmd} ${spec.launchArgs}` : cmd)
const tmuxH = async (args: string[], timeoutMs = 4000): Promise<string> =>
  (await pexec('tmux', ['-L', TMUX_SOCK, ...args], { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' })).stdout
// one-session pane state for the deliver gate: no window / idle shell / an agent-ish turn still running.
// Deliberately the SAME descendant-tree probe the liveness fallback walks, so deliver and the board can never
// disagree about "busy".
async function headlessPaneState(id: string, agentish: RegExp): Promise<'no-window' | 'idle' | 'running'> {
  let out: string
  try { out = await tmuxH(['list-panes', '-t', id, '-F', '#{pane_pid}']) } catch { return 'no-window' }
  const panePid = Number(out.split('\n')[0]?.trim())
  if (!Number.isFinite(panePid) || panePid <= 0) return 'no-window'
  return paneTreeRuns({ panePid, procs: await procSnapshot() }, agentish) ? 'running' : 'idle'
}
// the injected turn script's content, pure and exported for tests: re-register agent.pid FIRST (its `$$`
// persists for the script's whole life — the born pattern; the agent runs as the script's child so the pid
// stays live across the recovery turns too), then run the WHOLE pinned one-shot command resuming this
// conversation, then the shared undeclared-exit recovery. The fresh registration is both the hot-tier
// liveness feed for this turn and the delivery confirmation in deliverOneShotTurn.
export function oneShotTurnScript(spec: OneShotSpec, rec: SessRec, cmd: string, pidPath: string, text: string): string {
  const agent = withLaunchArgs(cmd, spec)
  return [
    `printf %s "$$" > ${shQuote(pidPath)}`,
    ...headlessTurnExports(rec.session),
    `${agent} ${spec.resumeTurnArg(rec)} ${shQuote(text)}`,
    `_rc=$?`,
    `[ "$_rc" -ne 0 ] && exit "$_rc"`,
    ...oneShotRecoveryLines(spec, rec.session, agent),
    ``,
  ].join('\n')
}
// @@@ one-shot undeclared-exit recovery - the OUT-OF-PROCESS half of the stop-gate contract for one-shot
// harnesses. The gate's in-process continuation is best-effort on some harnesses: `opencode run` EXITS when
// its awaited turn completes WITHOUT awaiting the plugin's session.idle handler, so a blocked-stop
// continuation injected at exit is killed with the process and the record wedges `active` (REPRODUCED live,
// opencode 1.18.3: forbid-declare worker → gate rejected — teach sentinel planted — yet the process exited
// to the shell, record stuck active/offline). claude `-p` holds its Stop-block natively; pi re-injects via
// sendUserMessage at agent_settled. So every one-shot SCRIPT (launch and injected turn alike) closes the
// gap at the only layer that survives the process: after a CLEAN agent exit (rc=0 — a non-zero exit stays
// fail-loud, unrecovered), it reads the record's declared state and, while still UNDECLARED (active/queued),
// fires a bounded continuation turn on the SAME conversation carrying the gate's declare instruction — the
// gate's own contract restated, never a fabricated task (the mbp "Continue…" lesson bans inventing WORK, not
// the gate teaching declaration). Two tries then exit 97 loud. A declared/absent record exits 0 untouched,
// so harnesses whose in-process gate already held (claude, normally pi) never fire it.
const ONE_SHOT_GATE_CONTINUATION =
  '[SpexCode stop gate] Your previous stop was blocked: this session is still UNDECLARED. Declare your ' +
  'true state now by running exactly ONE command: `spex session done --propose merge|nothing|close`, or ' +
  '`spex session park --note "<what you await>"`, or `spex session ask --note "<your question>"`. Do nothing else.'
function oneShotRecoveryLines(spec: OneShotSpec, id: string, agent: string): string[] {
  const sessJson = shQuote(join(sessionStoreDir(id), 'session.json'))
  const readStatus = `_st=$(sed -n 's/.*"status": "\\([a-z]*\\)".*/\\1/p' ${sessJson} 2>/dev/null | head -1)`
  return [
    `for _i in 1 2; do`,
    `  ${readStatus}`,
    `  case "$_st" in active|queued) ;; *) exit 0 ;; esac`,   // declared (or record gone) — the ordinary end
    `  echo "[spex] one-shot agent exited undeclared - firing the stop-gate continuation turn ($_i/2)" >&2`,
    ...spec.resumeTurnShell(id, sessJson).map((l) => `  ${l}`),
    `  ${agent} $_res ${shQuote(ONE_SHOT_GATE_CONTINUATION)}`,
    `  _rc=$?`,
    `  [ "$_rc" -ne 0 ] && exit "$_rc"`,
    `done`,
    `${readStatus}`,
    `case "$_st" in active|queued) echo "[spex] one-shot agent still undeclared after 2 continuation turns - failing loud" >&2; exit 97 ;; esac`,
    `exit 0`,
  ]
}
// export lines for the injected turn's env — the launch env minus the rendezvous pair (mirrors sessions.ts
// rvEnv's headless bypass): the session id for hooks/CLI attribution, plus the store/config-home propagation
// so the turn's hook-state lands in the SAME store the backend reads.
const headlessTurnExports = (id: string): string[] => {
  const lines = [`export SPEXCODE_SESSION_ID=${id}`]
  for (const v of ['SPEXCODE_HOME', 'CODEX_HOME']) { const val = process.env[v]; if (val) lines.push(`export ${v}=${shQuote(val)}`) }
  return lines
}
const HEADLESS_TURN_START_TIMEOUT_MS = 10_000
async function deliverOneShotTurn(spec: OneShotSpec, rec: SessRec, text: string): Promise<DispatchResult> {
  const id = rec.session
  const state = await headlessPaneState(id, spec.agentish)
  if (state === 'no-window')
    return { ok: false, error: `headless session ${id} has no tmux window — run \`spex session resume ${id}\` to recreate it, then resend` }
  if (state === 'running')
    return { ok: false, error: `headless session ${id} is still executing its current turn — refusing to inject a second concurrent one-shot turn (undefined behaviour on one conversation); wait for the turn to finish, then resend` }
  const cmd = rec.launchCmd
  if (!cmd) return { ok: false, error: `headless session ${id} has no pinned launch command — cannot build the resume turn (re-create the session)` }
  const pidPath = sessionArtifactPath(id, 'agent.pid')
  const prevMtime = (() => { try { return statSync(pidPath).mtimeMs } catch { return 0 } })()
  const file = join(sessionStoreDir(id), 'turn.sh')
  writeFileSync(file, oneShotTurnScript(spec, rec, cmd, pidPath, text))
  try {
    await tmuxH(['send-keys', '-t', id, '-l', '--', `bash ${file}`])
    await tmuxH(['send-keys', '-t', id, 'Enter'])
  } catch (e) {
    return { ok: false, error: `could not type the turn into the session pane: ${e instanceof Error ? e.message : String(e)} — prompt NOT delivered` }
  }
  // delivered = the turn PROCESS provably started: the injected script's first act is the agent.pid
  // re-registration, so a fresh mtime is proof the injection ran (the hooks take the record from here).
  // Never seeing it means the pane swallowed the line (not at a shell prompt) — fail loud, never a false sent.
  const deadline = Date.now() + HEADLESS_TURN_START_TIMEOUT_MS
  for (;;) {
    try { if (statSync(pidPath).mtimeMs !== prevMtime) return { ok: true } } catch { /* not registered yet */ }
    if (Date.now() >= deadline)
      return { ok: false, error: `injected headless turn did not start within ${HEADLESS_TURN_START_TIMEOUT_MS / 1000}s (agent.pid was never re-registered) — the pane is likely not at a shell prompt; inspect it and resend` }
    await new Promise((r) => setTimeout(r, 200))
  }
}
function oneShotHeadlessOps(spec: OneShotSpec): HarnessHeadless {
  return {
    needsCmd: true,   // the one-shot invocation IS its own command — the launcher's headlessCmd, written whole
    launchCmd: (id, _rt, cmd) => {
      // the pinned headlessCmd, embedded WHOLE — zero parsing. mode+pin were born together, so a headless
      // record always carries one; its absence is corruption, not a case to paper over. The command runs
      // inside a small bootstrap script (the codex-launchCmd pattern: the caller's ordinary tail arrives as
      // "$@") so the undeclared-exit recovery above can run AFTER the agent process is gone.
      if (!cmd) throw new Error(`headless ${spec.id} launch has no pinned headlessCmd — the record carries no launch command (re-create the session)`)
      const agent = withLaunchArgs(cmd, spec)
      const script = [
        `${agent} "$@"`,
        `_rc=$?`,
        `[ "$_rc" -ne 0 ] && exit "$_rc"`,
        ...oneShotRecoveryLines(spec, id, agent),
      ].join('\n')
      return `bash -c ${shQuote(script)} spexcode-oneshot`
    },
    liveness: (_rec, tmuxAlive, _runtimeDir, pane) => {
      if (!tmuxAlive) return 'offline'
      if (pane?.pidAlive !== undefined) return pane.pidAlive ? 'online' : 'offline'
      return paneTreeRuns(pane, spec.agentish) ? 'online' : 'offline'
    },
    deliver: (rec, text) => deliverOneShotTurn(spec, rec, text),
    resumeArg: () => '',   // continuation is the next deliver — never a bare relaunch with a fabricated prompt
  }
}
export const claudeHeadlessOps: HarnessHeadless = oneShotHeadlessOps(ONE_SHOT_HEADLESS.claude)
export const piHeadlessOps: HarnessHeadless = oneShotHeadlessOps(ONE_SHOT_HEADLESS.pi)
export const opencodeHeadlessOps: HarnessHeadless = oneShotHeadlessOps(ONE_SHOT_HEADLESS.opencode)

// ---------------------------------------------------------------------------------------------------------
// the two implementations.

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification'] as const
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const
// the five claude-shaped events pi's generated extension SYNTHESIZES from its own lifecycle (session_start →
// SessionStart, input → UserPromptSubmit, tool_call → PreToolUse, tool_result → PostToolUse, agent_settled →
// Stop). pi has no idle/attention or failed-stop event → no Notification/StopFailure, same real gap as codex.
const PI_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

// the resolved base launcher command per harness (the wrapper that sets the config-dir env), shared by
// launchCmd and baseCmd so the two never diverge: the launcher's pinned `cmd` wins. The bare default is only
// the fallback for a truly-old record with NO pinned cmd and NO launcher name — there is no env/config-field
// resolution, because claude/codex are ordinary named launchers now ([[launcher-select]]), resolved by name.
const claudeBaseCmd = (cmd?: string) => cmd || 'claude --dangerously-skip-permissions'
const codexBaseCmd = (cmd?: string) => cmd || 'codex --yolo'
const piBaseCmd = (cmd?: string) => cmd || 'pi'   // pi runs tools without permission prompts — no yolo flag exists or is needed
const opencodeBaseCmd = (cmd?: string) => cmd || 'opencode --auto'   // --auto = zero-prompt permissions (opencode's trust mechanism — writeTrust is a no-op)

// @@@ opencodeLaunchCommand - the tail-branching launch script (the codex marker pattern, minus any server:
// opencode is a per-session process like claude). The caller-appended tail ("$@") is EITHER one single-quoted
// prompt arg (a NEW launch → `--prompt`), or a resume marker from opencodeHarness.resumeArg: `--resume <id>`
// re-attaches the owned opencode session (`--session <id>`, the SAME conversation), `--continue` re-attaches
// the worktree's last session when no id was ever captured (the plugin failed before its first event). A new
// launch's tail can never BE a literal marker (it's one quoted prompt), so the branch is unambiguous.
export function opencodeLaunchCommand(opencodeCmd = 'opencode --auto'): string {
  const script = [
    `if [ "\${1:-}" = "--resume" ]; then`,
    // the marker carries the owned session id — export it so the plugin can seed rootSession at load: a
    // resumed session re-fires NO bus event until poked, so without this the rendezvous daemon rejects
    // every delivery (resume-continuity A-side: continuity ✓, steerability ✗).
    `  export SPEXCODE_OPENCODE_RESUME_ID="$2"`,
    `  exec ${opencodeCmd} --session "$2"`,
    `elif [ "\${1:-}" = "--continue" ]; then`,
    // no owned id to seed — mark the continue-resume so the plugin knows to ask the SDK for the
    // reattached session (scoped to this marker so a FRESH launch can never adopt a stale session).
    `  export SPEXCODE_OPENCODE_CONTINUE=1`,
    `  exec ${opencodeCmd} --continue`,
    `elif [ -n "\${1:-}" ]; then`,
    `  exec ${opencodeCmd} --prompt "$1"`,
    `else`,
    `  exec ${opencodeCmd}`,
    `fi`,
  ].join('\n')
  return `bash -lc ${shQuote(script)} spexcode-opencode`
}

export const claudeHarness: Harness = {
  id: 'claude',
  events: CLAUDE_EVENTS,
  ownsRendezvous: true,                              // reclaude opens the rendezvous control socket (prompt delivery + liveness)
  paneTitleIsSelfSummary: true,                      // claude writes its live task summary into the OSC pane title → headline derives from it
  headless: claudeHeadlessOps,                       // the one-shot `-p` capability ([[harness-adapter]] claude headless ops above)
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
  // the TUI's sessions panel ("← for agents"): a reply injected here is parsed + enqueued to the PANEL context
  // and never drained (verified live: `queue-operation: enqueue` with no dequeue, no turn, daemon silent), so
  // the parse-confirmed delivery above would still report a false success into it. Matched on the panel's own
  // strings — the new-session composer placeholder, or its footer key hints together (either alone could drift
  // across claude versions; requiring the footer PAIR keeps a prose false-positive unlikely).
  deliveryBlockedBy: (paneText) =>
    paneText.includes('describe a task for a new session') || (paneText.includes('enter to return') && paneText.includes('space to reply'))
      ? 'the claude TUI is focused on its sessions panel ("← for agents"), which silently swallows injected prompts — press Enter in the session terminal to return to the composer, then resend'
      : null,
  resumeArg: (rec) => `--resume ${rec.session}`,
}

export const codexHarness: Harness = {
  id: 'codex',
  events: CODEX_EVENTS,
  ownsRendezvous: false,                             // no reclaude daemon — liveness + prompts through the project app-server socket
  paneTitleIsSelfSummary: false,                     // codex's pane title is a spinner + the cwd folder name, NOT a task summary → headline uses the prompt
  // @@@ codex headless - the app-server IS the executor on the interactive path already (the task runs as the
  // backend-owned thread's FIRST turn; the pane TUI only renders it), so codex's headless form is the
  // interactive launch minus the final attach: the pane holds a read-only placeholder, and a second agent
  // process is STRUCTURALLY impossible — nothing in the pane can start a turn (the mbp double-run fix).
  headless: {
    // the executor is the shared app-server, derived from the pinned interactive `cmd`'s first token (the
    // version-parity invariant) — there is no second command, `headlessCmd` is ignored.
    needsCmd: false,
    launchCmd: (id, runtimeDir, cmd) => codexLaunchCommand(id, codexBaseCmd(cmd), undefined, runtimeDir ?? runtimeRoot(), true),
    // TURN-scoped: online iff the window is up AND the caller's app-server sweep (codexThreadsInProgress, fed
    // through the snapshot's online-signal channel as `socketLive`) found an in-progress turn on the owned
    // thread. Between turns the caller's reconcile lets the DECLARED lifecycle rule (the stop-gate guarantees a
    // non-crash turn end declares); a still-`active` record with no running turn honestly reads offline. The
    // pane probe (`pidAlive` = the placeholder tail) is deliberately ignored — a live placeholder proves
    // nothing about the executor.
    liveness: (_rec, tmuxAlive, _runtimeDir, _pane, socketLive) => (tmuxAlive && !!socketLive ? 'online' : 'offline'),
    // delivery is the interactive channel verbatim — app-server JSON-RPC steer-vs-start on the owned thread
    // (it never depended on the pane). The record's runtime dir is the ambient project's, same as the
    // interactive call site passes.
    deliver: (rec, text) => deliverViaCodexAppServer({ session: rec.session, worktreePath: rec.worktreePath, harnessSessionId: rec.harnessSessionId, runtimeDir: runtimeRoot() }, text),
    // same marker as interactive: reopen re-runs the launch script, which resumes the OWNED thread directly
    // (tid=$2 — no codex-launch, no new thread, no re-fired prompt) and lands on the placeholder line — so a
    // headless reopen recreates the read-only pane and nothing else; the conversation continues via deliver.
    resumeArg: (rec) => (rec.harnessSessionId ? `--resume ${rec.harnessSessionId}` : ''),
  },
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
  // online iff the tmux window is up AND the agent is live. PRIMARY: the launch-registered `agent.pid` hot-tier
  // verdict (`pidAlive`) — a 100ms syscall (kill-0), no ps scan. LEGACY: a pre-registration session has no
  // agent.pid (`pidAlive` undefined) → fall back to the whole-box ps DESCENDANT-tree walk (paneTreeRunsCodex):
  // a codex-ish process live below the pane pid, NOT the pane's foreground command (that is `bash`, the launch
  // wrapper, even while the TUI renders — the field-confirmed false-OFFLINE) and NOT the app-server socket
  // (SHARED per-project, it survives a failed `--remote resume` — the earlier false-ONLINE). The legacy path
  // self-extinguishes as pre-registration sessions close.
  liveness: (_rec, tmuxAlive, _runtimeDir, pane) => {
    if (!tmuxAlive) return 'offline'
    if (pane?.pidAlive !== undefined) return pane.pidAlive ? 'online' : 'offline'
    return paneTreeRunsCodex(pane) ? 'online' : 'offline'
  },
  deliver: (rec, text) => deliverViaCodexAppServer(rec, text),
  // owned thread id → `--resume <id>` MARKER the codex launch script reads to resume that thread DIRECTLY (NOT
  // a tail handed to a bare `codex` — the script's final `codex … resume "$tid"` performs codex's own resume on
  // the owned id, the SAME conversation); none → empty tail → relaunch a FRESH thread on the same worktree/record.
  resumeArg: (rec) => (rec.harnessSessionId ? `--resume ${rec.harnessSessionId}` : ''),
}

// @@@ piHarness - the pi adapter (@earendil-works/pi-coding-agent). pi is the CLOSEST to claude of the four:
// the caller pins the session id at launch (`--session-id <id>`, creating the session if missing), the shim
// lives IN the worktree, and the rendezvous prompt/liveness channel is REUSED wholesale — pi has no external
// hook binding (its lifecycle surface is the in-process extension API), so the shim is a GENERATED TypeScript
// extension (.pi/extensions/spexcode.ts, run natively by pi) that forwards five claude-shaped events to
// dispatch.sh AND binds this session's rendezvous socket itself (sessions.ts already exports
// CLAUDE_BG_RENDEZVOUS_SOCK to every ownsRendezvous launch) speaking the reclaude line protocol — so
// deliverViaRendezvous and the socket-listener liveness work UNCHANGED. Trust: pi gates project-local
// extensions behind saved per-directory trust (~/.pi/agent/trust.json), so writeTrust stamps the main
// checkout there (the nearest-parent lookup covers nested worktrees) and the launch carries `--approve` as
// one-run defence. See pi-harness.ts for the extension source + trust mechanics.
export const piHarness: Harness = {
  id: 'pi',
  events: PI_EVENTS,
  ownsRendezvous: true,                              // the generated extension binds rvSock(id) and speaks the reclaude protocol
  paneTitleIsSelfSummary: false,                     // pi's pane title is not an agent-written task summary → headline uses the prompt preview
  // the one-shot `pi -p` capability, built from the shared builder's pi data (ONE_SHOT_HEADLESS.pi): launch
  // pins `--session-id <record id>` via the ordinary tail, a turn resumes it with `--session <record id>`,
  // and `--approve` rides every process so the extension (the hook shim) loads with zero prompts.
  headless: piHeadlessOps,
  launchCmd: (_id, _rt, cmd) => `${piBaseCmd(cmd)} --approve`,   // --approve = one-run project trust (belt to writeTrust's braces)
  baseCmd: piBaseCmd,
  sessionIdArg: (id) => `--session-id ${id}`,        // caller pins the exact session id, claude-style (created if missing)
  sessionEnvVar: 'PI_SESSION_ID',                    // exported by the generated extension at session_start; tool subprocesses inherit it
  shimFile: (proj) => join(proj, '.pi', 'extensions', 'spexcode.ts'),
  worktreeHookAnchor: () => null,                    // the extension lives in the worktree and self-anchors, like claude
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],   // pi auto-loads AGENTS.md context files (shared with codex — writeManagedBlock is idempotent)
  skillDir: (proj) => join(proj, '.pi', 'skills'),   // Agent Skills standard dirs, discovered after project trust
  agentDir: () => null,                              // pi has no file-discovered sub-agent primitive — materialize skips it
  shim: (dispatch, spex) => ({
    content: piExtensionSource(dispatch, spex),
    cmd: (e: string) => `SPEX='${spex}' bash ${dispatch} pi ${e}`,   // what the extension actually spawns, for parity with buildShim
  }),
  writeTrust: (proj) => writePiTrust(mainCheckout(proj)),   // trust keys on the MAIN checkout; nearest-parent lookup covers worktrees
  removeTrust: (proj) => removePiTrust(mainCheckout(proj)),
  clean(proj, arts) { cleanHarness(this, proj, arts) },
  slashCommands: piSlashCommands,
  // claude's exact liveness: the window is up AND a live LISTENER answers on the rendezvous socket — the
  // socket the generated extension binds. socketLive is already probed for every windowed session.
  liveness: (_rec, tmuxAlive, _runtimeDir, _pane, socketLive) => (tmuxAlive && !!socketLive ? 'online' : 'offline'),
  deliver: (rec, text) => deliverViaRendezvous(rec.session, text),
  // reopen the SAME conversation: `--session <id>` resumes the exact session we pinned at launch and FAILS
  // LOUD when its file is gone (unlike `--session-id`, which would silently mint a fresh empty session).
  resumeArg: (rec) => `--session ${rec.session}`,
}

export const opencodeHarness: Harness = {
  id: 'opencode',
  events: OPENCODE_EVENTS,
  // LITERALLY true: the generated plugin ([[opencode-harness]], opencode.ts) BINDS the per-session rendezvous
  // socket the launch env hands it and speaks the reply/repaint mini-protocol, so claude's deliver (atomic
  // parse-confirmed write) and socket-listener liveness are reused verbatim — no opencode transport code.
  ownsRendezvous: true,
  paneTitleIsSelfSummary: false,                     // opencode's TUI title is not the agent's live task self-summary → headline uses the prompt
  // the one-shot `opencode run` capability, built from the shared builder's opencode data
  // (ONE_SHOT_HEADLESS.opencode): opencode loads the project plugin in `run` mode exactly as in the TUI, so
  // the minted-id capture and every hook fire unchanged; a turn resumes `--session <captured id>`, falling
  // to `--continue` when no capture ever landed (mirroring the interactive resumeArg).
  headless: opencodeHeadlessOps,
  launchCmd: (_id, _rt, cmd) => opencodeLaunchCommand(opencodeBaseCmd(cmd)),   // the tail-branching script (prompt vs --resume/--continue marker)
  baseCmd: opencodeBaseCmd,
  sessionIdArg: () => '',                            // opencode mints its own session id; the plugin's first event reports it back (opencode-capture)
  // opencode exports NO per-session env var to its tool subprocesses (probed, 1.18.3). Identity flows through
  // the launch-injected SPEXCODE_SESSION_ID — honest here because each opencode TUI is a per-session process
  // (no codex-style shared-server contamination). This var is therefore never set; envSessionId's
  // SPEXCODE_SESSION_ID tier resolves the record.
  sessionEnvVar: 'OPENCODE_SESSION_ID',
  // the "shim" is a generated opencode PLUGIN in the worktree's own tree — opencode auto-loads project plugins
  // by walking the cwd, so like claude it self-anchors and needs no root-checkout rewrite or worktree anchor.
  shimFile: (proj) => join(proj, '.opencode', 'plugins', 'spexcode.ts'),
  worktreeHookAnchor: () => null,
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],   // opencode reads AGENTS.md natively (same file codex owns; the managed block is idempotent across writers)
  skillDir: (proj) => join(proj, '.opencode', 'skills'),
  agentDir: (proj) => join(proj, '.opencode', 'agents'),
  // content = the plugin source; cmd = the SAME per-event command the plugin bakes into dispatch calls, so
  // any consumer that hashes/inspects commands sees one truth (trust is a no-op here regardless).
  shim: (dispatch, spex) => ({ content: opencodePluginSource(dispatch, spex), cmd: (e) => `SPEX='${spex}' bash ${dispatch} opencode ${e}` }),
  writeTrust: () => { /* zero-prompt is the launcher's `--auto` flag — nothing to write */ },
  removeTrust: () => { /* nothing was written */ },
  clean(proj, arts) { cleanHarness(this, proj, arts) },
  slashCommands: opencodeSlashCommands,
  // online iff the window is up AND the agent answers on a channel: PREFER the rendezvous socket listener
  // (the plugin is alive), FALL BACK to the launch-registered agent.pid (kill-0) so a plugin that failed to
  // load still reads honestly from the process signal instead of a false offline.
  liveness: (_rec, tmuxAlive, _runtimeDir, pane, socketLive) =>
    (tmuxAlive && (!!socketLive || pane?.pidAlive === true) ? 'online' : 'offline'),
  deliver: (rec, text) => deliverViaRendezvous(rec.session, text),
  // owned opencode session id → `--resume <id>` marker (the launch script re-attaches `--session <id>`, the
  // SAME conversation); never captured → `--continue` marker (opencode's own "last session in this directory",
  // which in a dedicated worktree is this worker's). The discriminator is sound for the same reason codex's
  // is: a NEW launch's tail is always ONE single-quoted prompt arg, never a literal marker.
  resumeArg: (rec) => (rec.harnessSessionId ? `--resume ${rec.harnessSessionId}` : '--continue'),
}

// every adapter — materialize iterates this to write each harness's artifacts in one pass.
export const HARNESSES: readonly Harness[] = [claudeHarness, codexHarness, opencodeHarness, piHarness]

// the legacy/default adapter for old records and config defaults. New launches derive harness from a launcher.
export const defaultHarness: Harness = claudeHarness

// resolve an adapter by id (the detector). Throws on an unknown id — fail loud, never silently default.
export function harnessById(id: string): Harness {
  const h = HARNESSES.find((x) => x.id === id)
  if (!h) throw new Error(`unknown harness '${id}' (known: ${HARNESSES.map((x) => x.id).join(', ')})`)
  return h
}

// @@@ harnessOps - the ONE mode router product code branches on: a headless-mode record routes its runtime
// (launchCmd / liveness / deliver / resumeArg) through the harness's headless capability object; everything
// else — an interactive record, an old pre-mode record, or a harness with no headless form — stays on the
// interactive adapter. This is a PRODUCT-dimension branch (`mode`), never a harness branch, so it lives here
// once instead of an `if (headless)` per call site. A headless record on a null-capability harness cannot
// exist past create (the create path fails loud), so the fallthrough is old-record safety, not a feature.
export type HarnessOps = Harness | HarnessHeadless
export function harnessOps(h: Harness, mode?: SessionMode | null): HarnessOps {
  return mode === 'headless' && h.headless ? h.headless : h
}

// --- named launcher profiles ([[launcher-select]]) ----------------------------------------------------------
// a launcher = a `{ harness, cmd, headlessCmd? }` entry in spexcode.json's `sessions.launchers`, keyed by a
// human-chosen name. `claude` and `codex` are NOT special built-ins — `spex init` SEEDS them as ordinary named
// launchers (with the regular command path), so they are edited like any other. harness defaults to claude.
// resolveLauncher throws fail-loud on an unknown name (a session must never silently launch under the wrong
// auth) and validates the harness id. There is NO env-derived built-in fallback: the dropdown lists exactly
// the config's real launchers.
//
// A launcher may carry TWO complete commands, one per session MODE: `cmd` (the interactive TUI — the field's
// meaning is unchanged, existing configs need zero migration) and the optional `headlessCmd` (the one-shot
// headless invocation). Both are written WHOLE by the config author; the system never parses or rewrites
// their internals. An empty-string headlessCmd reads as absent; its absence is validated at USE time (a
// headless create on a needsCmd harness fails loud), never at list time.
export type SessionMode = 'interactive' | 'headless'
export const SESSION_MODES: readonly SessionMode[] = ['interactive', 'headless']
export type Launcher = { name: string; harness: string; cmd: string; headlessCmd: string | null }
export type LauncherDefault = { default: string | null; error: string | null }

// the modes a launcher can create sessions in — computed BACKEND-side from the adapter's headless capability
// object, so adapter knowledge never leaks to the frontend (which only consumes this list). interactive is
// always offered; headless requires the harness's `headless` capability AND, when that capability needs its
// own command (needsCmd), a configured headlessCmd. An unknown harness id contributes no headless here (the
// list stays renderable; resolveLauncher fails loud on it later).
export function launcherModes(harness: string, headlessCmd: string | null): SessionMode[] {
  const cap = HARNESSES.find((x) => x.id === harness)?.headless ?? null
  return cap && (!cap.needsCmd || !!headlessCmd) ? ['interactive', 'headless'] : ['interactive']
}

// the configured named launchers from spexcode.json, as a stable name-sorted list (for the dashboard dropdown +
// the CLI), each with its computed `modes`. Picking a launcher is the ONLY launch choice; the old separate
// harness pick is gone.
export function launcherList(root = mainCheckout()): (Launcher & { modes: SessionMode[] })[] {
  const m = readConfig(root).sessions?.launchers || {}
  return Object.keys(m)
    .map((name) => {
      const harness = m[name].harness || defaultHarness.id
      const headlessCmd = m[name].headlessCmd?.trim() || null   // empty string reads as absent
      return { name, harness, cmd: m[name].cmd, headlessCmd, modes: launcherModes(harness, headlessCmd) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const MISSING_DEFAULT_LAUNCHER_ERROR =
  'sessions.defaultLauncher is required for a launch without --launcher; set it in spexcode.json or spexcode.local.json (for example {"sessions":{"defaultLauncher":"claude"}})'

// the configured default launcher NAME ([[launcher-select]]) — the profile `spex session new`/a dropdown pick with no
// explicit choice resolves. Missing config is a fail-loud setup error, never an implicit fallthrough to a
// `claude` launcher (which `spex init` seeds by name, so a default can point at it explicitly).
export function defaultLauncher(root = mainCheckout()): string {
  const name = readConfig(root).sessions?.defaultLauncher?.trim()
  if (!name) throw new Error(MISSING_DEFAULT_LAUNCHER_ERROR)
  return name
}

export function launcherDefault(root = mainCheckout()): LauncherDefault {
  try {
    const name = defaultLauncher(root)
    resolveLauncher(name, root)
    return { default: name, error: null }
  } catch (e) {
    return { default: null, error: String((e as Error).message || e) }
  }
}

export function resolveLauncher(name: string, root = mainCheckout()): Launcher {
  const l = readConfig(root).sessions?.launchers?.[name]
  if (!l) throw new Error(`unknown launcher '${name}' (configured: ${launcherList(root).map((x) => x.name).join(', ') || 'none'})`)
  if (!l.cmd) throw new Error(`launcher '${name}' is missing cmd`)
  // no headless validation here — mode availability is decided at CREATE time (pinnedLaunchCmd), where the
  // requested mode is known; resolve stays the pure name→profile lookup.
  const resolved = { name, harness: l.harness || defaultHarness.id, cmd: l.cmd, headlessCmd: l.headlessCmd?.trim() || null }
  harnessById(resolved.harness)   // validate the harness id fail-loud
  return resolved
}

// the configured default session MODE ([[launcher-select]] headless): the mode a create with no explicit
// --mode/--headless choice uses. Absent → interactive (headless is opt-in, never a silent default flip); an
// unrecognized value is a config error reported loud with the repair, exactly like a malformed JSON file —
// never silently coerced.
export function defaultSessionMode(root = mainCheckout()): SessionMode {
  const raw = readConfig(root).sessions?.defaultMode?.trim()
  if (!raw) return 'interactive'
  if (!(SESSION_MODES as readonly string[]).includes(raw))
    throw new Error(`sessions.defaultMode '${raw}' is not a session mode (valid: ${SESSION_MODES.join(' | ')}) — fix it in spexcode.json or spexcode.local.json`)
  return raw as SessionMode
}

// the launch command a NEW session PINS on its record, per its mode ([[launcher-select]] resume-launcher-pin):
//   interactive                → the launcher's interactive `cmd` (unchanged behavior).
//   headless, needsCmd harness → the launcher's `headlessCmd` verbatim (the one-shot invocation IS that
//                                command); missing → fail loud naming the config repair, never a silent
//                                fall-through to the interactive cmd (which would boot a TUI nobody attends).
//   headless, !needsCmd        → still the interactive `cmd` — the server-side executor (codex app-server) is
//                                DERIVED from it (the version-parity invariant), so it is what must freeze.
// A harness with no headless capability rejects headless outright, naming what does support it. Pure and
// exported so the pin decision is unit-auditable without a git worktree.
export function pinnedLaunchCmd(h: Harness, launcher: Launcher, mode: SessionMode): string {
  if (mode !== 'headless') return h.baseCmd(launcher.cmd)
  if (!h.headless) {
    const capable = HARNESSES.filter((x) => x.headless).map((x) => x.id).join(', ')
    throw new Error(`launcher '${launcher.name}' runs harness '${h.id}', which has no headless capability (headless-capable: ${capable || 'none yet'}) — create the session without --headless`)
  }
  if (!h.headless.needsCmd) return h.baseCmd(launcher.cmd)
  if (!launcher.headlessCmd)
    throw new Error(`launcher '${launcher.name}' has no headlessCmd — headless mode on harness '${h.id}' needs one; add "headlessCmd" to sessions.launchers.${launcher.name} in spexcode.json or spexcode.local.json (spex guide settings → LAUNCHERS)`)
  return launcher.headlessCmd
}
