import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { claudeSlashCommands, codexSlashCommands, opencodeSlashCommands, piSlashCommands, type SlashCommand } from './slash-commands.js'
import { OPENCODE_EVENTS, opencodePluginSource } from './opencode.js'
import { piExtensionSource, writePiTrust, removePiTrust } from './pi-harness.js'
import { claudeHeadlessLaunchCommand, claudeHeadlessSock, deliverViaClaudeHeadless, interruptClaudeHeadless } from './claude-headless.js'
import { codexHeadlessLaunchCommand } from './codex-headless.js'
import { opencodeHeadlessLaunchCommand, spawnOpenCodeHeadlessTurn } from './opencode-headless.js'
import { piHeadlessLaunchCommand, piHeadlessSock, deliverViaPiHeadless } from './pi-headless.js'
import { runtimeRoot, mainCheckout, readConfig, sessionArtifactPath } from './layout.js'
import { git } from './git.js'
import { shQuote } from './sh.js'
import { detachedRuntimeGenerationToken, migrateLegacyDetachedRuntimeReceipt, processStartToken, verifyDetachedRuntime, type VerifiedDetachedRuntime } from './process-identity.js'
import { codexGenerationEndpoints, codexGenerationSocketPath, currentCodexGeneration, legacyCodexGenerationEndpoint, readCodexGenerationLedger, resolveCodexGenerationForSession, type CodexGenerationEndpoint } from './codex-runtime-generations.js'

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

export type HarnessId = 'claude' | 'codex' | 'opencode' | 'pi' | 'claude-headless' | 'codex-headless' | 'opencode-headless' | 'pi-headless'
export type HarnessLivenessRecord = { session: string; harnessSessionId?: string | null; stopped?: boolean; archived?: boolean }
export type HarnessLaunchReadyRecord = HarnessLivenessRecord & { governed?: boolean; runtimeDir: string }
export type HarnessLaunchReadinessFence = {
  readonly proof: Readonly<Record<string, unknown>>
  validate(current: () => HarnessLaunchReadyRecord | null): Promise<boolean>
}
export type TurnFailure = { message: string; completedAt: number | null }
export type FailureSubscription = { close(): void; readonly closed: Promise<string | null> }
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
export type SharedRuntimeDescriptor = {
  key: string
  label: string
  pidFile: string
  receiptFile: string
  // When a resident adapter has several immutable generations, this resolves the one exact descriptor a
  // governed target owns. Product code consumes the selection without learning adapter-specific identities.
  targetDescriptorKey?: (rec: HarnessLivenessRecord & { harnessSessionId?: string | null }) => string | null
  // Lightweight project-wide resident census used by read projections. It must return exact loaded IDs without
  // per-thread reads; the full probe remains the resource/lifecycle surface that also reads turn state.
  residency?: () => Promise<{ healthy: boolean; referenceIds: string[]; error?: string; rootAbsent?: boolean }>
  // Lifecycle mutation guard is deliberately narrower than the full resource projection: census every loaded
  // ID, but read only the exact governed target when it is loaded, plus both target descendant collections.
  mutationGuard?: (targetReferenceId: string, opts?: { coldReceipt?: unknown }) => Promise<SharedRuntimeMutationGuard>
  probe(): Promise<SharedRuntimeProbe>
}
export type SharedRuntimeMutationGuard = {
  healthy: boolean
  referenceIds: string[]
  targetTurnPresence: 'none' | 'idle' | 'active' | 'unknown'
  descendantIds: string[]
  coldTeardownAuthorized?: boolean
  error?: string
}
export type SharedRuntimeProbe = {
  healthy: boolean
  references: Array<{
    referenceId: string
    turnPresence: 'idle' | 'active' | 'unknown'
    turnId?: string
  }>
  error?: string
}

export type HarnessColdPreflight =
  | { ok: true; alreadyCold?: boolean; receipt?: unknown }
  | { ok: false; reason: string }

// The corrupt-record quarantine path has no typed session record to pass into cold storage. The adapter therefore
// owns this separate proof: it can archive one exact native orphan, return only public audit facts, and retain an
// in-memory compensation closure for the caller's atomic record move. Product code never sees a native receipt.
export type HarnessOrphanThreadQuarantine =
  | { ok: true; audit: { adapter: string; threadId: string; action: 'archived' | 'already-unloaded' }; compensate(): Promise<{ ok: true } | { ok: false; reason: string }> }
  | { ok: false; reason: string }

export type AdapterLoadedReferenceState = {
  healthy: boolean
  loaded: boolean
  error?: string
}

// One project-wide resident-reference census for read projections. A shared app-server descriptor is probed
// once per call, then its result is joined to every record that names that adapter/thread. Product readers must
// not turn this into one RPC per row: a loaded thread can be externally reloaded after its cold proof was filed.
export async function adapterLoadedReferenceState(
  records: readonly (HarnessLivenessRecord & { harness?: string })[],
  runtimeDir = runtimeRoot(),
): Promise<Map<string, AdapterLoadedReferenceState>> {
  const descriptors = new Map<string, SharedRuntimeDescriptor>()
  const recordKeys = new Map<string, string[]>()
  for (const rec of records) {
    if (!rec.harnessSessionId) continue
    const harness = harnessById(rec.harness || defaultHarness.id)
    const exactKey = harness.targetDescriptorKey?.(rec) ?? null
    const keys = (harness.sharedRuntimes?.(runtimeDir) ?? []).filter((descriptor) => !exactKey || descriptor.key === exactKey).map((descriptor) => {
      descriptors.set(descriptor.key, descriptor)
      return descriptor.key
    })
    recordKeys.set(`${rec.harness || defaultHarness.id}:${rec.harnessSessionId}`, keys)
  }
  const probes = await Promise.all([...descriptors.entries()].map(async ([key, descriptor]) => {
    try {
      const result = descriptor.residency
        ? await descriptor.residency()
        : await descriptor.probe().then((probe) => ({ healthy: probe.healthy, referenceIds: probe.references.map((reference) => reference.referenceId), error: probe.error }))
      return [key, result] as const
    }
    catch (error) { return [key, { healthy: false, referenceIds: [] as string[], error: (error as Error).message }] as const }
  }))
  const byKey = new Map(probes)
  const result = new Map<string, AdapterLoadedReferenceState>()
  for (const [recordKey, keys] of recordKeys) {
    const refs = keys.map((key) => byKey.get(key)!).filter(Boolean)
    if (!refs.length) continue
    const unhealthy = refs.find((probe) => !probe.healthy)
    const threadId = recordKey.slice(recordKey.indexOf(':') + 1)
    result.set(recordKey, unhealthy
      ? { healthy: false, loaded: false, error: unhealthy.error || 'adapter resident-reference census is unhealthy' }
      : { healthy: true, loaded: refs.some((probe) => probe.referenceIds.includes(threadId)) })
  }
  return result
}

export interface Harness {
  readonly id: HarnessId
  // the id baked into the materialized shim. Headless variants reuse their native family's shim.
  readonly dispatchId: 'claude' | 'codex' | 'opencode' | 'pi'
  // whether this harness runs without an interactive TUI. The dashboard launcher picker hides headless
  // adapters by default ([[launcher-visibility]]); CLI launcher resolution never consumes that policy.
  readonly headless: boolean
  // whether the launch command intentionally exits after its first turn instead of owning a resident process.
  // One-shot adapters must not be mistaken for a failed fast boot and retried with a duplicate prompt.
  readonly launchOneShot?: boolean
  // Adapter-owned runtime shape: headless controllers/shared threads have no interactive TUI leaf to signal.
  readonly runtimeOwnership?: 'leaf' | 'adapter'
  // This launch command may create its project-shared control plane through internal shared-runtime-spawn.
  readonly sharedRuntimeSpawn?: boolean
  // @@@ fatalLaunchOutput - extended regexes matching THIS harness's own report of a launch failure that
  // RUNNING IT AGAIN CANNOT FIX: a conversation that does not exist, a rejected credential, a broken config.
  // A launcher that exits within the boot window tells us only that it exited fast, which is why the transport
  // retries — but when the harness itself named a settled cause, retrying spends a certain failure two more
  // times and buries the one line that explains it. So the transport asks the ADAPTER, and the adapter is the
  // only place a harness's wording is ever matched: product code consumes the verdict (retry / fatal), never
  // the text. A harness that declares none keeps the plain bounded retry.
  readonly fatalLaunchOutput?: readonly string[]
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
  // transport bootstrap variables scoped to this launch. Rendezvous adapters own their daemon mode + socket;
  // product launch code only composes these with generic session/home env.
  launchEnv(id: string): string[]

  // --- materialize: shim + contract + trust ([[harness-delivery]]) ---
  // the auto-discovered hook shim file for this harness (.claude/settings.json vs .codex/hooks.json).
  shimFile(proj: string): string
  // whether that shim belongs to one checkout or the whole project. This is adapter placement data: Codex
  // reads one root-checkout hook file for every linked tree; the other harnesses discover their tree-local file.
  shimScope: 'tree' | 'project'
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
  writeTrust(proj: string, cmdFor: (e: string) => string): readonly string[]

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
  // A completed launch command is only transport acceptance. An adapter with stronger runtime ownership may
  // keep the caller waiting until the launched conversation is genuinely addressable. The lazy record source
  // lets a one-shot launch publish its native id while readiness is pending. The returned adapter-owned fence
  // names the facts that established readiness and revalidates those SAME facts across the caller's record
  // commit. Null at the deadline is a launch failure; adapters without this seam retain the generic bounded
  // liveness fence.
  launchReady?(current: () => HarnessLaunchReadyRecord | null, deadline: number): Promise<HarnessLaunchReadinessFence | null>
  // Exact leaf ownership evidence consumed by lifecycle teardown. The adapter returns the one argv identity
  // token it registered for this record (session id, harness thread/generation, or null when unprovable);
  // product lifecycle code never branches on harness names to invent this identity.
  leafOwnerNeedle?(rec: HarnessLivenessRecord & { harnessSessionId?: string | null }): string | null
  // deliver a follow-up prompt to a LIVE session and report whether it landed. claude: through the rendezvous
  // control socket — an ATOMIC reply+repaint chunk whose `repaint-done` proves the reply was PARSED; a close
  // before it proves a concurrent connect kicked the chunk (the daemon is single-connection) → resend; a wall
  // expiry on a still-open connection is a busy-not-lost agent → optimistic ok (see replyViaSocket). codex:
  // JSON-RPC on the same app-server WebSocket the
  // visible TUI uses — it reads the thread live and either `turn/steer`s the message INTO an in-progress turn
  // (mid-turn, not queued for after the agent stops) or `turn/start`s a fresh turn when the thread is idle.
  // Returns ok=false with a reason that propagates to the API.
  deliver(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult>
  // Observe native turn failures that this harness does not expose as a lifecycle hook. The adapter owns the
  // transport subscription; sessions owns observer reconciliation and the active-only lifecycle CAS.
  observeTurnFailures?(rec: HarnessDeliveryRecord, onFailure: (failure: TurnFailure) => void): FailureSubscription
  // Hard-interrupt the current turn through the harness's native control plane. Optional because a harness
  // without a confirmed native interrupt must refuse rather than emulate one with a signal or PTY key.
  interrupt?(rec: HarnessDeliveryRecord): Promise<DispatchResult>
  // Remove this harness's ephemeral runtime transport after stop/close. This is the runtime inverse of
  // launch: rendezvous owners unlink rvSock, claude-headless unlinks its control socket, Codex owns no
  // per-session socket. Product teardown calls only this adapter method.
  // Async because removal is CONDITIONAL on proof: a transport is only ours to remove once its listener is
  // proven dead (see unlinkSocks), and that proof is a connect probe.
  cleanupRuntime(rec: HarnessLivenessRecord): Promise<void>
  // Archive preflight runs BEFORE any leaf signal. It may inspect shared references to refuse an active or
  // unknown target turn, but it must not mutate the shared runtime; coldRuntime is the sole commit primitive.
  // Its optional receipt is opaque adapter authority: product code may only pass the same object back to the
  // stop guard and coldRuntime, never inspect it or synthesize a recursive/archive mode.
  coldPreflight?(rec: HarnessLivenessRecord & { harnessSessionId?: string | null }): Promise<HarnessColdPreflight>
  // A record that is already archived needs a target-only continuing-cold proof. Unlike mutation preflight,
  // this must not thread/read unrelated loaded siblings merely to retire a target whose runtime is absent.
  coldRetirementPreflight?(rec: HarnessLivenessRecord & { harnessSessionId?: string | null }): Promise<{ ok: true; alreadyCold: true } | { ok: false; reason: string }>
  // Optional cold-storage proof/cleanup. A harness with a per-session loaded reference must remove exactly that
  // reference or return a loud reason; adapters without such a resident reference return {ok:true}.
  coldRuntime?(rec: HarnessLivenessRecord & { harnessSessionId?: string | null }, receipt?: unknown): Promise<{ ok: true } | { ok: false; reason: string }>
  restoreRuntime?(rec: HarnessLivenessRecord & { harnessSessionId?: string | null }, receipt?: unknown): Promise<{ ok: true } | { ok: false; reason: string }>
  // Recovery for an unreadable governed record. This accepts no record-shaped ownership claim: the adapter must
  // prove the native target has zero other governed owners, is idle and descendant-free, then archive only it.
  quarantineOrphanThread?(threadId: string, opts: { excludingSessionId: string }): Promise<HarnessOrphanThreadQuarantine>
  // Project-scoped runtimes are adapter facts. Resource governance consumes these descriptors to report
  // references and protect a sibling-owned control plane without learning harness command names.
  sharedRuntimes?(runtimeDir: string): readonly SharedRuntimeDescriptor[]
  // Select the exact shared descriptor a record owns when an adapter has more than one resident generation.
  // Null is an unproven binding and must fail closed before lifecycle mutation.
  targetDescriptorKey?(rec: HarnessLivenessRecord & { harnessSessionId?: string | null }): string | null
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
  clean(proj: string, arts: HarnessArtifacts, preserveProject?: boolean): void
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

// A prompt-dispatch outcome. `accepted` means the native control plane acknowledged the turn; `rejected` means
// it definitely did not; `commit-unknown` means the request crossed a transport boundary but its native result
// was lost, so replaying it could duplicate a turn. The latter is deliberately distinct from a normal rejection.
export type DispatchOutcome = 'accepted' | 'rejected' | 'commit-unknown'
// ok=true means delivery is confirmed at the layer that harness proves it: claude at
// the DAEMON-PARSE layer (the atomic reply+repaint chunk answered `repaint-done`, or the wall expired on a
// still-open connection — busy, not lost; see replyViaSocket); codex at the application layer (the app-server
// accepted `turn/steer`/`turn/start`). `error` carries a human-readable reason that propagates to the API route
// (non-2xx) and the CLI/dashboard. Defined here because it is the harness DELIVERY contract; sessions.ts
// re-exports it for its existing importers.
export type DispatchResult = { ok: boolean; outcome?: DispatchOutcome; error?: string }
export type HarnessDeliveryRecord = {
  session: string
  worktreePath?: string
  harnessSessionId?: string | null
  runtimeDir?: string
  launchCmd?: string | null
  // Opaque caller-owned marker. Codex maps it to its native `clientUserMessageId`, while other adapters may
  // ignore it; product routing never needs to know which harness recognizes the marker.
  deliveryId?: string
}
// the on-demand surface artifacts a materialize pass wrote, by node NAME — so clean() knows EXACTLY which
// skill subdirs / agent files are SpexCode's to remove (name-scoped, never a blind wipe of a dir the user may
// also populate). materialize passes the live skill/agent node names; clean reconstructs the same paths.
export type HarnessArtifacts = { skills: readonly string[]; agents: readonly string[] }

// @@@ rendezvous control socket - claude's DETERMINISTIC, ONLY input path for PROMPTS to sessions WE launch.
// sessions.ts starts `claude` with CLAUDE_BG_BACKEND=daemon + CLAUDE_BG_RENDEZVOUS_SOCK=<this path> set ONLY on
// that one spawned command (env prefix, never global). claude opens a unix socket here; writing one line
// `{"type":"reply","text":"…"}\n` injects + submits the text as a prompt — no PTY typing, so multi-line input
// and Enters can't be corrupted the way `tmux send-keys` was. It lives in tmpdir tied to the claude process, so
// no extra lifecycle. liveness CONNECTS to it (a live LISTENER, not merely the file — see rendezvousListening);
// deliver writes to it.
//
// The path is a LAUNCH-TIME FACT, recorded — not a formula every consumer re-derives. The id alone was not
// enough to name it: `SPEXCODE_HOME` scopes the store and `SPEXCODE_TMUX` scopes the tmux server, so two
// worlds on one box (a fixture, a migration, a copied record) can hold the same session id — and while the
// path ignored that scoping, they SHARED this socket. That is how an isolated teardown reached out and
// stranded a live production agent, and delivery would have crossed the same way. So the path a launch hands
// its agent is derived from the runtime the session belongs to (`runtimeRoot()` — the same identity that
// scopes its store) and STAMPED beside the record, exactly like `agent.pid`: a launch-time fact, readable by
// everyone who needs to reach that agent afterwards. Recording it (rather than re-deriving) also means the
// derivation can change again without stranding anything already running.
// `legacyRvSock` is the answer for a session launched BEFORE the stamp existed — its agent really did bind
// the unscoped path — so those keep working untouched, and the fallback retires as they turn over.
export const legacyRvSock = (id: string) => join(tmpdir(), `spexcode-rv-${id}.sock`)
export const scopedRvSock = (id: string, dir = runtimeRoot()) =>
  join(tmpdir(), `spexcode-rv-${createHash('sha1').update(dir).digest('hex').slice(0, 12)}-${id}.sock`)
const rvStamp = (id: string) => sessionArtifactPath(id, 'rv.path')
export const rvSock = (id: string): string => {
  try { return readFileSync(rvStamp(id), 'utf8').trim() || legacyRvSock(id) } catch { return legacyRvSock(id) }
}
// launch's half: derive this session's socket in ITS runtime and record it, so every later reader (launch env,
// liveness probe, delivery, teardown) reads the one path the agent actually bound.
export function stampRvSock(id: string, dir = runtimeRoot()): string {
  const path = scopedRvSock(id, dir)
  mkdirSync(dirname(rvStamp(id)), { recursive: true })
  writeFileSync(rvStamp(id), path)
  return path
}

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
export function listenerAt(path: string, timeoutMs = 800): Promise<ListenerProbe> {
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
    try { c = createConnection({ path }) } catch { return done('unproven') }
    c.on('connect', () => done('live'))
    c.on('error', (e) => done(PROVEN_DEAD.has((e as NodeJS.ErrnoException).code ?? '') ? 'dead' : 'unproven'))
  })
}
export const rendezvousListening = (id: string, timeoutMs = 800): Promise<ListenerProbe> => listenerAt(rvSock(id), timeoutMs)
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
  return codexGenerationSocketPath(dir)
}
export const codexAppServerPid = (dir = runtimeRoot()) => join(dir, 'codex-app-server.pid')
export const codexAppServerReceipt = (dir = runtimeRoot()) => join(dir, 'codex-app-server.detached.json')
const codexAppServerLegacyScope = (dir = runtimeRoot()) => join(dir, 'codex-app-server.scope')
type CodexRuntimeGenerationProof = Readonly<{
  identity: VerifiedDetachedRuntime
  socket: Readonly<{ path: string; dev: number; ino: number }>
}>
function codexRuntimeGenerationProof(dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir)): CodexRuntimeGenerationProof | null {
  try {
    const pid = Number(readFileSync(endpoint.pidFile, 'utf8').trim())
    const detached = verifyDetachedRuntime(pid, endpoint.receiptFile)
    const socketPath = endpoint.socketPath
    const socket = statSync(socketPath)
    if (!(pid > 0) || !detached.ok || !socket.isSocket()) return null
    return Object.freeze({
      identity: detached.identity,
      socket: Object.freeze({ path: socketPath, dev: socket.dev, ino: socket.ino }),
    })
  } catch { return null }
}
const codexRuntimeGenerationToken = (proof: CodexRuntimeGenerationProof) =>
  `${detachedRuntimeGenerationToken(proof.identity)}|${proof.socket.path}|${proof.socket.dev}:${proof.socket.ino}`
function codexRuntimeGeneration(dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir)): string | null {
  const proof = codexRuntimeGenerationProof(dir, endpoint)
  return proof ? codexRuntimeGenerationToken(proof) : null
}

function codexMutationGeneration(dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir)): string | null {
  const current = codexRuntimeGeneration(dir, endpoint)
  if (current) return current
  if (endpoint.id !== 'legacy') return null
  let pid: number
  try {
    pid = Number(readFileSync(codexAppServerPid(dir), 'utf8').trim())
    if (!Number.isInteger(pid) || pid <= 0 || !statSync(codexAppServerSock(dir)).isSocket()) return null
  } catch { return null }
  if (!migrateLegacyDetachedRuntimeReceipt(pid, codexAppServerLegacyScope(dir), codexAppServerReceipt(dir))) return null
  return codexRuntimeGeneration(dir, endpoint)
}

const codexDescriptorKey = (endpoint: CodexGenerationEndpoint) => endpoint.id === 'legacy' ? 'codex-app-server' : `codex-app-server:${endpoint.id}`

function codexEndpointForRecord(rec: HarnessLivenessRecord & { harnessSessionId?: string | null }, dir = runtimeRoot()): CodexGenerationEndpoint | null {
  if (!rec.harnessSessionId) return null
  const ledger = readCodexGenerationLedger(dir)
  if (ledger.revision === 0 && !ledger.current && !Object.keys(ledger.generations).length) return legacyCodexGenerationEndpoint(dir)
  return resolveCodexGenerationForSession(dir, rec.session, rec.harnessSessionId)
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

export async function deliverViaSocketOrWake(
  id: string,
  text: string,
  coldWake: () => Promise<DispatchResult>,
  unprovenError: string,
): Promise<DispatchResult> {
  const probe = await rendezvousListening(id)
  if (probe === 'live') return deliverViaRendezvous(id, text)
  if (probe === 'unproven') return { ok: false, error: unprovenError }
  return coldWake()
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
export function codexInjectMessage(threadId: string, text: string, cwd: string | undefined, activeTurnId: string | null, id = 4, clientUserMessageId?: string): JsonRpc {
  const marker = clientUserMessageId ? { clientUserMessageId } : {}
  if (activeTurnId)
    return { id, method: 'turn/steer', params: { threadId, input: codexTextInput(text), expectedTurnId: activeTurnId, ...marker } }
  return { id, method: 'turn/start', params: { threadId, input: codexTextInput(text), ...(cwd ? { cwd } : {}), ...marker } }
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

// Headless adapters all feed non-zero ephemeral turn exits through one state writer. Keep this reporter at the
// adapter seam: controllers may call it directly, while shell-homed turns use headlessTurnFailureShell below.
export async function reportHeadlessTurnExit(id: string, harness: string, code: number | null, cwd = process.cwd()): Promise<void> {
  if (code === 0) return
  const exitCode = code === null ? 'signal' : String(code)
  try {
    await pexec(SPEX, ['internal', 'session-turn-fail', id, harness, exitCode], { cwd, env: process.env })
  } catch (error) {
    console.error(`[spex ${harness}] could not record turn failure for ${id}: ${(error as Error).message}`)
  }
}

export function headlessTurnFailureShell(harness: string, swallow = true): string {
  return `${shQuote(SPEX)} internal session-turn-fail "$SPEXCODE_SESSION_ID" ${shQuote(harness)} "$__spex_rc"${swallow ? ' || true' : ''}`
}
// @@@ sessionIdentityEnvVars - every environment variable that names ONE session: the launch-injected record
// id plus each adapter's own `sessionEnvVar`. Adapter-derived, so a new harness needs no edit here. A
// per-session process is entitled to carry them; a SHARED, project-scoped daemon must not — see the app-server
// spawn below.
export function sessionIdentityEnvVars(): string[] {
  return [...new Set(['SPEXCODE_SESSION_ID', ...HARNESSES.map((h) => h.sessionEnvVar)])].filter(Boolean)
}
export function codexLaunchCommand(id: string, codexCmd = 'codex', serverCmd?: string, dir = runtimeRoot(), attachTui = true): string {
  const server = process.env.SPEXCODE_CODEX_SERVER_CMD || serverCmd || codexBinary(codexCmd)
  // The bypass flag ONLY reaches a thread's hook trust as a per-request `config` override, NOT as a CLI flag on
  // the shared `app-server` process (the app-server never reads its own `--dangerously-bypass-hook-trust` for a
  // thread — it was INERT there, the bug). Two thread paths carry it: (1) the BACKEND-owned `thread/start` sends
  // `config.bypass_hook_trust` from codex-launch ([[harness-adapter]]); (2) the visible `--remote … resume` TUI,
  // where codex's OWN client forwards this flag into its thread/start+thread/resume config — so a reopen in a
  // fresh app-server (where codex-launch never runs) still trusts our hooks. Hence the flag lives on the resume
  // TUI, never on the app-server invocation. Guarded against a double-flag when an env override already carries it.
  const tuiBypass = !codexCmd.includes('--dangerously-bypass-hook-trust') && codexSupportsBypassHookTrust(codexBinary(codexCmd)) ? ' --dangerously-bypass-hook-trust' : ''
  const script = [
    `dir=${shQuote(dir)}`,
    // codex-launch's bypass-trust gate (and writeTrust's) resolves the codex binary from SPEXCODE_CODEX_CMD;
    // WE already hold the launcher's real cmd here (it drives the app-server + resume TUI + tuiBypass above), so
    // pin it into the environment the codex-launch child inherits. Without this the child falls back to a bare
    // `codex`, which on a multi-install box (e.g. an old Homebrew codex on PATH beside the launcher's newer one)
    // probes the WRONG binary — deciding "no --dangerously-bypass-hook-trust support" and silently dropping the
    // thread/start bypass, so the worktree's hooks stay untrusted and NO lifecycle hooks fire.
    `export SPEXCODE_CODEX_CMD=${shQuote(codexCmd)}`,
    // The runtime command is the single generation-ledger boundary. A new turn receives canonical `current`;
    // resume resolves its existing session/thread binding and therefore cannot jump an old conversation to a
    // replacement root. It prints only shell assignments for the exact proven endpoint.
    'if [ "$1" = "--resume" ]; then',
    `  eval "$( ${SPEX} internal codex-generation-session "$dir" "$SPEXCODE_SESSION_ID" "$2" )" || exit 1`,
    'else',
    `  eval "$( ${SPEX} internal codex-generation-current "$dir" ${shQuote(server)} )" || exit 1`,
    'fi',
    // The delegated bearer arrived only through fd 9. The shared-spawn helper consumed it (or the already-live
    // socket made it unnecessary); close and scrub the channel before the per-session Codex client starts.
    '[ "${SPEXCODE_MAINTENANCE_DELEGATE_FD:-}" != "9" ] || exec 9<&-',
    'unset SPEXCODE_MAINTENANCE_DELEGATE_FD SPEXCODE_MAINTENANCE_SESSION_ID',
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
    ...(attachTui ? [] : [
      // A headless forced reopen has no TUI to attach and the shared app-server already owns the thread. Keep it
      // a no-op instead of calling codex-launch without a prompt (which would mint an unrelated empty thread).
      `elif [ "$#" -eq 0 ]; then`,
      `  exit 0`,
    ]),
    `else`,
    `  tid=$(${SPEX} internal codex-launch "$sock" "$PWD" "$@")`,
    `  __spex_rc=$?`,
    ...(attachTui ? [`  [ "$__spex_rc" -eq 0 ] || exit 1`] : [
      `  if [ "$__spex_rc" -ne 0 ]; then ${headlessTurnFailureShell('codex-headless')}; exit "$__spex_rc"; fi`,
    ]),
    `fi`,
    `[ -n "$tid" ] || { echo "[spex] codex-launch produced no resumable thread" >&2; exit 1; }`,
    // The visible TUI is the OTHER entry point that creates an execution context for this session (a fresh
    // launch attaches to the thread codex-launch just made; a reopen resumes an existing one), so it injects
    // the same per-thread identity through codex's own `-c` override. Same rule, both entry points: whoever
    // creates a context stamps that context's record id, and nothing downstream re-derives it.
    ...(attachTui ? [`exec ${codexCmd}${tuiBypass} -c ${shQuote(`shell_environment_policy.set.SPEXCODE_SESSION_ID=${id}`)} --remote unix://"$sock" resume "$tid"`] : []),
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

// Codex has no StopFailure hook, but its app-server has the stronger native signal: every subscribed turn ends
// with turn/completed and a final completed/interrupted/failed status. Rejoin is atomic with subscription, so
// this observer also survives backend replacement; a thread already in systemError is reconciled from its
// latest turn before later live notifications take over.
export function codexTurnFailureObserver(
  rec: HarnessDeliveryRecord,
  onFailure: (failure: TurnFailure) => void,
): FailureSubscription {
  const threadId = rec.harnessSessionId
  if (!threadId) return { close: () => {}, closed: Promise.resolve(null) }
  const runtimeDir = rec.runtimeDir || runtimeRoot()
  const endpoint = codexEndpointForRecord(rec, runtimeDir)
  if (!endpoint) {
    return {
      close: () => {},
      closed: Promise.resolve(`Codex turn observer refused: no exact generation binding for session ${rec.session}`),
    }
  }
  const sock = endpoint.socketPath
  const conn: Socket = createConnection(sock)
  const frames: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
  let upgraded = false, settled = false
  let reconciliationTimer: ReturnType<typeof setTimeout> | null = null
  let resolveClosed!: (reason: string | null) => void
  const closed = new Promise<string | null>((resolve) => { resolveClosed = resolve })
  const cancelReconciliation = () => {
    if (!reconciliationTimer) return
    clearTimeout(reconciliationTimer)
    reconciliationTimer = null
  }
  const finish = (reason: string | null) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    cancelReconciliation()
    try { conn.destroy() } catch {}
    resolveClosed(reason)
  }
  const timer = setTimeout(() => finish('Codex turn observer did not subscribe within 5000ms'), 5000)
  timer.unref?.()
  const send = (message: JsonRpc) => conn.write(wsText(JSON.stringify(message)))
  const report = (turn: unknown, fallbackMessage?: string) => {
    const value = turn as { status?: unknown; completedAt?: unknown; error?: { message?: unknown } | null }
    if (value?.status !== 'failed' && !fallbackMessage) return
    const nativeMessage = typeof value?.error?.message === 'string' ? value.error.message.trim() : ''
    onFailure({
      message: nativeMessage || fallbackMessage || 'Codex turn failed',
      completedAt: typeof value?.completedAt === 'number' && Number.isFinite(value.completedAt) ? value.completedAt : null,
    })
  }
  conn.on('error', (error) => finish(`Codex turn observer connection failed: ${rpcError(error)}`))
  conn.on('close', () => finish('Codex turn observer connection closed'))
  conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
  const handle = (json: string) => {
    let message: JsonRpc
    try { message = JSON.parse(json) } catch { return }
    if (message.error) return finish(`Codex turn observer request failed: ${message.error.message || JSON.stringify(message.error)}`)
    if (message.id === 1 && message.result) {
      send({ method: 'initialized', params: {} })
      return send({
        id: 2,
        method: 'thread/resume',
        params: { threadId, excludeTurns: true, initialTurnsPage: { limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' } },
      })
    }
    if (message.id === 2 && message.result) {
      clearTimeout(timer)
      const result = message.result as { thread?: { status?: { type?: unknown } }; initialTurnsPage?: { data?: unknown } }
      if (result.thread?.status?.type === 'systemError') {
        const turns = result.initialTurnsPage?.data
        const latest = Array.isArray(turns) ? turns[0] : null
        // Give a concurrently-starting turn's native notification precedence over this historical snapshot.
        reconciliationTimer = setTimeout(() => {
          reconciliationTimer = null
          report(latest, 'Codex thread entered systemError before the turn observer subscribed')
        }, 100)
        reconciliationTimer.unref?.()
      }
      return
    }
    if (message.method === 'turn/started') {
      const params = message.params as { threadId?: unknown } | undefined
      if (params?.threadId === threadId) cancelReconciliation()
    }
    if (message.method === 'turn/completed') {
      const params = message.params as { threadId?: unknown; turn?: unknown } | undefined
      if (params?.threadId === threadId) {
        cancelReconciliation()
        report(params.turn)
      }
    }
  }
  conn.on('data', (chunk: Buffer) => {
    frames.buf = Buffer.concat([frames.buf, chunk])
    if (!upgraded) {
      const split = frames.buf.indexOf('\r\n\r\n')
      if (split < 0) return
      const head = frames.buf.slice(0, split).toString('utf8')
      if (!/^HTTP\/1\.1 101/.test(head)) return finish(`Codex app-server refused turn observer: ${head.split('\r\n')[0]}`)
      upgraded = true
      frames.buf = frames.buf.slice(split + 4)
      send(wsInitialize)
    }
    if (drainWsFrames(frames, conn, handle)) finish('Codex app-server closed the turn observer')
  })
  return { close: () => finish(null), closed }
}

// Protocol-verified cold/restore seam. The Codex schema (`codex app-server generate-json-schema --experimental`)
// defines thread/archive and thread/unarchive with {threadId}; no guessed method or process command is used.
type CodexGenerationFence = { dir: string; endpoint: CodexGenerationEndpoint; generation: string }
function codexThreadMutation(sock: string, method: 'thread/archive' | 'thread/unarchive', threadId: string, fence?: CodexGenerationFence): Promise<{ ok: true } | { ok: false; error: string }> {
  const generationError = () => fence && codexRuntimeGeneration(fence.dir, fence.endpoint) !== fence.generation
    ? `Codex ${method} refused because the shared app-server generation changed`
    : null
  const before = generationError()
  if (before) return Promise.resolve({ ok: false, error: before })
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false
    const done = (r: { ok: true } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch {}
      resolve(r)
    }
    // thread/archive may wait up to 10s in shutdown_and_wait before the server commits; keep a margin so a
    // legitimate late response is not turned into an early commit-unknown race.
    const timer = setTimeout(() => done({ ok: false, error: generationError() || `Codex ${method} timed out after 15s` }), 15000)
    conn.on('error', (e) => done({ ok: false, error: generationError() || `Codex ${method} connection failed: ${rpcError(e)}` }))
    conn.on('close', () => { if (!settled) done({ ok: false, error: `Codex app-server closed during ${method}` }) })
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => {
      const changed = generationError()
      if (changed) return done({ ok: false, error: changed })
      conn.write(WS_UPGRADE(randomBytes(16).toString('base64')))
    })
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) return done({ ok: false, error: generationError() || `Codex ${method} failed: ${m.error.message || JSON.stringify(m.error)}` })
      if (m.id === 1 && m.result) {
        const changed = generationError()
        if (changed) return done({ ok: false, error: changed })
        send({ method: 'initialized', params: {} })
        return send({ id: 2, method, params: { threadId } })
      }
      if (m.id === 2 && m.result) {
        const changed = generationError()
        return changed ? done({ ok: false, error: changed }) : done({ ok: true })
      }
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `Codex app-server refused WebSocket upgrade for ${method}` })
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: `Codex app-server closed during ${method}` })
    })
  })
}

type CodexPagedIdsResult = { ok: true; ids: string[] } | { ok: false; error: string }
// Codex treats an omitted or empty sourceKinds filter as "interactive" defaults. Cold proof must census the
// entire native thread graph, including subAgent/thread-spawn rows that have no Spex record, so the adapter
// supplies every protocol source kind explicitly for its thread/list calls.
export const CODEX_THREAD_SOURCE_KINDS = [
  'cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact',
  'subAgentThreadSpawn', 'subAgentOther', 'unknown',
] as const
function codexPagedIds(
  sock: string,
  method: 'thread/list' | 'thread/loaded/list',
  params: Record<string, unknown>,
  extractId: (item: unknown) => string | null,
  label: string,
  onItem?: (item: unknown) => void,
): Promise<CodexPagedIdsResult> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false, requestId = 2, cursor: string | null = null
    const ids = new Set<string>()
    const done = (result: CodexPagedIdsResult) => {
      if (settled) return
      settled = true; clearTimeout(timer); try { conn.destroy() } catch {}; resolve(result)
    }
    const timer = setTimeout(() => done({ ok: false, error: `Codex ${label} timed out` }), 5000)
    conn.on('error', (error) => done({ ok: false, error: `Codex ${label} failed: ${rpcError(error)}` }))
    conn.on('close', () => { if (!settled) done({ ok: false, error: `Codex app-server closed during ${label}` }) })
    const send = (message: JsonRpc) => conn.write(wsText(JSON.stringify(message)))
    const requestPage = () => send({ id: requestId, method, params: { ...params, ...(cursor ? { cursor } : {}), limit: 100 } })
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let message: JsonRpc
      try { message = JSON.parse(json) } catch { return }
      if (message.error) return done({ ok: false, error: `Codex ${label} failed: ${message.error.message || JSON.stringify(message.error)}` })
      if (message.id === 1 && message.result) { send({ method: 'initialized', params: {} }); return requestPage() }
      if (message.id !== requestId || !message.result) return
      const page = message.result as { data?: unknown; nextCursor?: unknown }
      if (Array.isArray(page.data)) for (const item of page.data) {
        onItem?.(item)
        const id = extractId(item)
        if (typeof id === 'string') ids.add(id)
      }
      cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null
      if (!cursor) return done({ ok: true, ids: [...ids] })
      requestId++
      requestPage()
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `Codex app-server refused loaded-reference census: ${head.split('\r\n')[0]}` })
        upgraded = true; fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: `Codex app-server closed during ${label}` })
    })
  })
}

// Lightweight resident census: unlike the full shared-runtime probe, this scans only paginated manager IDs
// and never issues thread/read includeTurns for each loaded reference.
export async function codexLoadedReferenceIds(sock: string): Promise<{ ok: true; referenceIds: string[] } | { ok: false; error: string }> {
  const result = await codexPagedIds(sock, 'thread/loaded/list', {}, (item) => {
    if (typeof item === 'string') return item
    const value = item as { id?: unknown; threadId?: unknown } | null
    return typeof value?.id === 'string' ? value.id : typeof value?.threadId === 'string' ? value.threadId : null
  }, 'loaded-reference census')
  return result.ok ? { ok: true, referenceIds: result.ids } : result
}

function codexTargetTurnPresence(sock: string, threadId: string): Promise<{ ok: true; turnPresence: 'idle' | 'active' | 'unknown' } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false
    const done = (result: { ok: true; turnPresence: 'idle' | 'active' | 'unknown' } | { ok: false; error: string }) => {
      if (settled) return
      settled = true; clearTimeout(timer); try { conn.destroy() } catch {}; resolve(result)
    }
    const timer = setTimeout(() => done({ ok: false, error: `Codex target thread ${threadId} read timed out after 5000ms` }), 5000)
    conn.on('error', (error) => done({ ok: false, error: `Codex target thread ${threadId} read failed: ${rpcError(error)}` }))
    conn.on('close', () => { if (!settled) done({ ok: false, error: `Codex app-server closed during target thread ${threadId} read` }) })
    const send = (message: JsonRpc) => conn.write(wsText(JSON.stringify(message)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let message: JsonRpc
      try { message = JSON.parse(json) } catch { return }
      if (message.error) return done({ ok: false, error: `Codex target thread ${threadId} read failed: ${message.error.message || JSON.stringify(message.error)}` })
      if (message.id === 1 && message.result) {
        send({ method: 'initialized', params: {} })
        return send({ id: 2, method: 'thread/read', params: { threadId, includeTurns: true } })
      }
      if (message.id !== 2 || !message.result) return
      const turns = (message.result as { thread?: { turns?: unknown } }).thread?.turns
      if (!Array.isArray(turns)) return done({ ok: true, turnPresence: 'unknown' })
      return done({ ok: true, turnPresence: activeTurnIdFromThread(message.result) ? 'active' : 'idle' })
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `Codex app-server refused target thread ${threadId} read: ${head.split('\r\n')[0]}` })
        upgraded = true; fs.buf = fs.buf.slice(i + 4); send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: `Codex app-server closed during target thread ${threadId} read` })
    })
  })
}

// The app-server's loaded/list is cursor-paginated. Archive proof must scan every page; a first page that omits
// a sibling/descendant is not a cold proof. This helper is also used by the descendant guard below.
export function codexThreadList(sock: string, params: Record<string, unknown>): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  return codexThreadCollection(sock, params).then((result) => result.ok ? { ok: true, ids: result.ids } : result)
}

type CodexThreadCollectionResult =
  | { ok: true; ids: string[]; parentById: Map<string, string | null> }
  | { ok: false; error: string }

function codexThreadCollection(sock: string, params: Record<string, unknown>): Promise<CodexThreadCollectionResult> {
  const sourceKinds = Array.isArray(params.sourceKinds) && params.sourceKinds.length
    ? params.sourceKinds
    : [...CODEX_THREAD_SOURCE_KINDS]
  const parentById = new Map<string, string | null>()
  const conflictingParents = new Set<string>()
  return codexPagedIds(sock, 'thread/list', { ...params, sourceKinds, useStateDbOnly: true }, (item) => {
    if (typeof item === 'string') return item
    const id = (item as { id?: unknown } | null)?.id
    return typeof id === 'string' ? id : null
  }, 'thread/list', (item) => {
    if (!item || typeof item !== 'object') return
    const row = item as { id?: unknown; parentThreadId?: unknown }
    if (typeof row.id !== 'string') return
    const parent = typeof row.parentThreadId === 'string' ? row.parentThreadId : null
    if (parentById.has(row.id) && parentById.get(row.id) !== parent) conflictingParents.add(row.id)
    parentById.set(row.id, parent)
  }).then((result) => {
    if (!result.ok) return result
    if (conflictingParents.size) return { ok: false as const, error: `Codex thread/list returned conflicting parent ownership for ${[...conflictingParents].join(', ')}` }
    return { ...result, parentById }
  })
}

async function codexTargetMutationGuard(threadId: string, dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir)): Promise<SharedRuntimeMutationGuard> {
  const generationBefore = codexMutationGeneration(dir, endpoint)
  if (!generationBefore) return { healthy: false, referenceIds: [], targetTurnPresence: 'unknown', descendantIds: [], error: 'Codex shared app-server generation is unproven' }
  const sock = endpoint.socketPath
  const [loaded, activeDescendants, archivedDescendants] = await Promise.all([
    codexLoadedReferenceIds(sock),
    codexThreadList(sock, { ancestorThreadId: threadId, archived: false, sourceKinds: [] }),
    codexThreadList(sock, { ancestorThreadId: threadId, archived: true, sourceKinds: [] }),
  ])
  const referenceIds = loaded.ok ? loaded.referenceIds : []
  const descendantIds = activeDescendants.ok && archivedDescendants.ok
    ? [...new Set([...activeDescendants.ids, ...archivedDescendants.ids])]
    : []
  if (!loaded.ok) return { healthy: false, referenceIds, targetTurnPresence: 'unknown', descendantIds, error: loaded.error }
  if (!activeDescendants.ok) return { healthy: false, referenceIds, targetTurnPresence: 'unknown', descendantIds, error: activeDescendants.error }
  if (!archivedDescendants.ok) return { healthy: false, referenceIds, targetTurnPresence: 'unknown', descendantIds, error: archivedDescendants.error }
  let targetTurnPresence: SharedRuntimeMutationGuard['targetTurnPresence'] = 'none'
  if (referenceIds.includes(threadId)) {
    const target = await codexTargetTurnPresence(sock, threadId)
    if (!target.ok) return { healthy: false, referenceIds, targetTurnPresence: 'unknown', descendantIds, error: target.error }
    targetTurnPresence = target.turnPresence
  }
  if (codexRuntimeGeneration(dir, endpoint) !== generationBefore)
    return { healthy: false, referenceIds, targetTurnPresence, descendantIds, error: 'shared Codex app-server generation changed during target guard' }
  return { healthy: true, referenceIds, targetTurnPresence, descendantIds }
}

const CODEX_COLD_PLAN = Symbol('codex-cold-plan')
type CodexColdPlan = Readonly<{
  [CODEX_COLD_PLAN]: true
  kind: 'codex-cold-subtree-v1'
  threadId: string
  generation: string
  endpoint: CodexGenerationEndpoint
  guard: SharedRuntimeMutationGuard
  descendantIds: readonly string[]
  parentEdges: readonly (readonly [string, string])[]
  subtreeIds: readonly string[]
  activeIds: readonly string[]
  archivedIds: readonly string[]
}>
type CodexColdPreflight = { ok: true; alreadyCold?: boolean; receipt: CodexColdPlan } | { ok: false; reason: string }

const sameIdSet = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id) => right.includes(id))

const sameParentEdges = (left: readonly (readonly [string, string])[], right: readonly (readonly [string, string])[]) =>
  left.length === right.length && left.every(([id, parent]) => right.some(([otherId, otherParent]) => id === otherId && parent === otherParent))

const isCodexColdPlan = (value: unknown): value is CodexColdPlan => {
  if (!value || typeof value !== 'object') return false
  const plan = value as Partial<CodexColdPlan>
  return plan[CODEX_COLD_PLAN] === true && plan.kind === 'codex-cold-subtree-v1' && typeof plan.threadId === 'string' &&
    typeof plan.generation === 'string' && isEndpointLike(plan.endpoint) && Array.isArray(plan.descendantIds) &&
    Array.isArray(plan.parentEdges) && Array.isArray(plan.subtreeIds) &&
    Array.isArray(plan.activeIds) && Array.isArray(plan.archivedIds) && !!plan.guard
}

function isEndpointLike(value: unknown): value is CodexGenerationEndpoint {
  return !!value && typeof value === 'object' && typeof (value as CodexGenerationEndpoint).id === 'string' &&
    typeof (value as CodexGenerationEndpoint).pidFile === 'string' && typeof (value as CodexGenerationEndpoint).receiptFile === 'string' &&
    typeof (value as CodexGenerationEndpoint).socketPath === 'string'
}

async function codexColdPreflight(threadId: string, dir = runtimeRoot(), expectedGeneration?: string, endpoint = legacyCodexGenerationEndpoint(dir)): Promise<CodexColdPreflight> {
  const generation = expectedGeneration ?? codexMutationGeneration(dir, endpoint)
  if (!generation || codexRuntimeGeneration(dir, endpoint) !== generation)
    return { ok: false, reason: 'Codex shared app-server generation is unproven or changed before subtree census' }
  const sock = endpoint.socketPath
  const [loaded, activeDescendants, archivedDescendants, archivedList, activeList] = await Promise.all([
    codexLoadedReferenceIds(sock),
    codexThreadCollection(sock, { ancestorThreadId: threadId, archived: false, sourceKinds: [] }),
    codexThreadCollection(sock, { ancestorThreadId: threadId, archived: true, sourceKinds: [] }),
    codexThreadList(sock, { archived: true, sourceKinds: [] }),
    codexThreadList(sock, { archived: false, sourceKinds: [] }),
  ])
  if (codexRuntimeGeneration(dir, endpoint) !== generation)
    return { ok: false, reason: 'shared Codex app-server generation changed during subtree census' }
  if (!loaded.ok) return { ok: false, reason: loaded.error }
  if (!activeDescendants.ok) return { ok: false, reason: activeDescendants.error }
  if (!archivedDescendants.ok) return { ok: false, reason: archivedDescendants.error }
  if (!archivedList.ok) return { ok: false, reason: archivedList.error }
  if (!activeList.ok) return { ok: false, reason: activeList.error }

  const activeDescendantSet = new Set(activeDescendants.ids)
  const archivedDescendantSet = new Set(archivedDescendants.ids)
  const duplicateDescendants = activeDescendants.ids.filter((id) => archivedDescendantSet.has(id))
  if (duplicateDescendants.length)
    return { ok: false, reason: `Codex subtree members occur in both active and archived descendant collections (${duplicateDescendants.join(', ')})` }
  const descendantIds = [...activeDescendants.ids, ...archivedDescendants.ids]
  if (descendantIds.includes(threadId)) return { ok: false, reason: `Codex target ${threadId} is duplicated in its own descendant closure` }

  const parentById = new Map([...activeDescendants.parentById, ...archivedDescendants.parentById])
  const depthById = new Map<string, number>()
  for (const id of descendantIds) {
    const seen = new Set([id])
    let cursor = id
    let depth = 0
    while (cursor !== threadId) {
      const next = parentById.get(cursor)
      if (!next) return { ok: false, reason: `Codex descendant ${id} has no complete parent chain to target ${threadId} (unowned or reassigned)` }
      if (seen.has(next)) return { ok: false, reason: `Codex descendant ${id} has a cyclic parent chain` }
      seen.add(next)
      cursor = next
      depth++
    }
    depthById.set(id, depth)
  }

  const activeSet = new Set(activeList.ids)
  const archivedSet = new Set(archivedList.ids)
  const subtreeIds = [...descendantIds, threadId]
  for (const id of subtreeIds) {
    const inActive = activeSet.has(id)
    const inArchived = archivedSet.has(id)
    if (!inActive && !inArchived)
      return { ok: false, reason: `Codex subtree member ${id} is absent from both native collections (unowned or reassigned)` }
    if (inActive && inArchived)
      return { ok: false, reason: `Codex subtree member ${id} occurs in both active and archived native collections` }
    if (id !== threadId) {
      const expectedActive = activeDescendantSet.has(id)
      if (inActive !== expectedActive)
        return { ok: false, reason: `Codex subtree member ${id} changed collection assignment during ownership census` }
    }
  }

  const loadedSet = new Set(loaded.referenceIds)
  const loadedSubtreeIds = subtreeIds.filter((id) => loadedSet.has(id))
  const turnStates = await Promise.all(loadedSubtreeIds.map(async (id) => ({ id, state: await codexTargetTurnPresence(sock, id) })))
  if (codexRuntimeGeneration(dir, endpoint) !== generation)
    return { ok: false, reason: 'shared Codex app-server generation changed during subtree turn census' }
  for (const { id, state } of turnStates) {
    if (!state.ok) return { ok: false, reason: state.error }
    if (state.turnPresence === 'active') return { ok: false, reason: `Codex subtree member ${id} has an active turn` }
    if (state.turnPresence === 'unknown') return { ok: false, reason: `Codex subtree member ${id} turn state is unknown` }
    if (archivedSet.has(id)) return { ok: false, reason: `Codex archived subtree member ${id} remains loaded` }
  }

  const targetTurnPresence: SharedRuntimeMutationGuard['targetTurnPresence'] = loadedSet.has(threadId) ? 'idle' : 'none'
  const guard: SharedRuntimeMutationGuard = {
    healthy: true,
    referenceIds: [...loaded.referenceIds],
    targetTurnPresence,
    descendantIds: [...descendantIds],
  }
  const activeIds = [...activeDescendants.ids]
    .sort((left, right) => (depthById.get(right) ?? 0) - (depthById.get(left) ?? 0))
    .concat(activeSet.has(threadId) ? [threadId] : [])
  const archivedIds = [...archivedDescendants.ids, ...(archivedSet.has(threadId) ? [threadId] : [])]
  const parentEdges = descendantIds.map((id) => [id, parentById.get(id)!] as const)
  const receipt: CodexColdPlan = Object.freeze({
    [CODEX_COLD_PLAN]: true as const,
    kind: 'codex-cold-subtree-v1',
    threadId,
    generation,
    endpoint,
    guard,
    descendantIds: Object.freeze([...descendantIds]),
    parentEdges: Object.freeze(parentEdges),
    subtreeIds: Object.freeze([...subtreeIds]),
    activeIds: Object.freeze(activeIds),
    archivedIds: Object.freeze(archivedIds),
  })
  return { ok: true, ...(activeIds.length ? {} : { alreadyCold: true }), receipt }
}

async function codexQuarantineOrphanThread(threadId: string, opts: { excludingSessionId: string }): Promise<HarnessOrphanThreadQuarantine> {
  const dir = runtimeRoot()
  const generation = codexMutationGeneration(dir)
  if (!generation) return { ok: false, reason: 'Codex shared app-server generation is unproven' }
  const owners = governedSharedRuntimeOwners(dir, 'codex-app-server', threadId, opts.excludingSessionId)
  if (owners === null) return { ok: false, reason: 'governed Codex thread-owner census is unreadable' }
  if (owners.length) return { ok: false, reason: `Codex native thread ${threadId} has governed owner(s) ${owners.join(', ')}` }
  const before = await codexColdPreflight(threadId, dir, generation)
  if (!before.ok) return before
  const plan = before.receipt
  if (plan.descendantIds.length || plan.guard.descendantIds.length)
    return { ok: false, reason: `Codex native thread ${threadId} has descendants (${[...new Set([...plan.descendantIds, ...plan.guard.descendantIds])].join(', ')})` }
  if (plan.guard.targetTurnPresence === 'active' || plan.guard.targetTurnPresence === 'unknown')
    return { ok: false, reason: `Codex native thread ${threadId} is ${plan.guard.targetTurnPresence === 'active' ? 'active' : 'unknown'}` }
  if (plan.subtreeIds.length !== 1 || plan.subtreeIds[0] !== threadId)
    return { ok: false, reason: `Codex native thread ${threadId} has an ambiguous ownership closure` }
  const unchangedOwners = () => governedSharedRuntimeOwners(dir, 'codex-app-server', threadId, opts.excludingSessionId)
  const rollback = () => codexRestoreColdPlan(plan, dir)
  if (plan.activeIds.length === 0) {
    if (plan.archivedIds.length !== 1 || plan.archivedIds[0] !== threadId || plan.guard.referenceIds.includes(threadId))
      return { ok: false, reason: `Codex native thread ${threadId} is not uniquely archived and unloaded` }
    const afterOwners = unchangedOwners()
    if (afterOwners === null || afterOwners.length) return { ok: false, reason: 'governed Codex thread-owner census changed during quarantine verification' }
    return { ok: true, audit: { adapter: 'codex', threadId, action: 'already-unloaded' }, compensate: async () => ({ ok: true }) }
  }
  if (plan.activeIds.length !== 1 || plan.activeIds[0] !== threadId || plan.archivedIds.length)
    return { ok: false, reason: `Codex native thread ${threadId} is not one exact active orphan` }
  const siblingIds = plan.guard.referenceIds.filter((id) => id !== threadId)
  const legacy = legacyCodexGenerationEndpoint(dir)
  const archived = await codexThreadMutation(legacy.socketPath, 'thread/archive', threadId, { dir, endpoint: legacy, generation })
  if (!archived.ok) return { ok: false, reason: `${archived.error} while archiving orphan Codex thread ${threadId}` }
  const after = await codexColdPreflight(threadId, dir, generation)
  const failed = (reason: string): HarnessOrphanThreadQuarantine => ({ ok: false, reason })
  if (!after.ok) {
    const restored = await rollback()
    return failed(restored.ok ? after.reason : `${after.reason}; ${restored.reason}`)
  }
  const afterOwners = unchangedOwners()
  const afterPlan = after.receipt
  const valid = afterPlan.descendantIds.length === 0 && afterPlan.subtreeIds.length === 1 && afterPlan.subtreeIds[0] === threadId &&
    afterPlan.activeIds.length === 0 && afterPlan.archivedIds.length === 1 && afterPlan.archivedIds[0] === threadId &&
    !afterPlan.guard.referenceIds.includes(threadId) && siblingIds.every((id) => afterPlan.guard.referenceIds.includes(id)) &&
    afterOwners !== null && afterOwners.length === 0
  if (!valid) {
    const restored = await rollback()
    return failed(restored.ok ? `Codex orphan thread ${threadId} changed during archive verification` : `Codex orphan thread ${threadId} changed during archive verification; ${restored.reason}`)
  }
  return { ok: true, audit: { adapter: 'codex', threadId, action: 'archived' }, compensate: rollback }
}

async function codexMutationGuard(
  threadId: string,
  dir = runtimeRoot(),
  opts: { coldReceipt?: unknown } = {},
  endpoint = legacyCodexGenerationEndpoint(dir),
): Promise<SharedRuntimeMutationGuard> {
  if (opts.coldReceipt === undefined) return codexTargetMutationGuard(threadId, dir, endpoint)
  if (!isCodexColdPlan(opts.coldReceipt) || opts.coldReceipt.threadId !== threadId)
    return { healthy: false, referenceIds: [], targetTurnPresence: 'unknown', descendantIds: [], error: 'adapter cold teardown receipt is invalid' }
  if (opts.coldReceipt.endpoint.id !== endpoint.id) return { healthy: false, referenceIds: [], targetTurnPresence: 'unknown', descendantIds: [], error: 'adapter cold teardown receipt names a different generation' }
  const current = await codexColdPreflight(threadId, dir, opts.coldReceipt.generation, endpoint)
  if (!current.ok) {
    const guard = await codexTargetMutationGuard(threadId, dir, endpoint)
    return { ...guard, healthy: false, coldTeardownAuthorized: false, error: current.reason }
  }
  const authorized = sameIdSet(opts.coldReceipt.descendantIds, current.receipt.descendantIds) &&
    sameParentEdges(opts.coldReceipt.parentEdges, current.receipt.parentEdges) &&
    sameIdSet(opts.coldReceipt.activeIds, current.receipt.activeIds) &&
    sameIdSet(opts.coldReceipt.archivedIds, current.receipt.archivedIds)
  return {
    ...current.receipt.guard,
    healthy: authorized,
    coldTeardownAuthorized: authorized,
    ...(authorized ? {} : { error: 'adapter cold teardown receipt no longer matches the target subtree' }),
  }
}

async function codexRestoreColdPlan(plan: CodexColdPlan, dir = runtimeRoot()): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (codexRuntimeGeneration(dir, plan.endpoint) !== plan.generation)
    return { ok: false, reason: 'shared Codex app-server generation changed, so no compensation was attempted' }
  const sock = plan.endpoint.socketPath
  const [activeBefore, archivedBefore] = await Promise.all([
    codexThreadList(sock, { archived: false, sourceKinds: [] }),
    codexThreadList(sock, { archived: true, sourceKinds: [] }),
  ])
  if (!activeBefore.ok || !archivedBefore.ok)
    return { ok: false, reason: 'archive state is unknown and could not be reconciled' }
  if (codexRuntimeGeneration(dir, plan.endpoint) !== plan.generation)
    return { ok: false, reason: 'shared Codex app-server generation changed, so no compensation was attempted' }
  const activeSet = new Set(activeBefore.ids)
  const archivedSet = new Set(archivedBefore.ids)
  if (plan.archivedIds.some((id) => !archivedSet.has(id) || activeSet.has(id)))
    return { ok: false, reason: 'an originally-archived Codex subtree member changed collection; compensation was not authorized' }
  if (plan.activeIds.some((id) => activeSet.has(id) === archivedSet.has(id)))
    return { ok: false, reason: 'an originally-active Codex subtree member has ambiguous collection state' }
  const fence = { dir, endpoint: plan.endpoint, generation: plan.generation }
  const restoreIds = [...plan.activeIds].reverse().filter((id) => archivedSet.has(id))
  for (const id of restoreIds) {
    const restored = await codexThreadMutation(sock, 'thread/unarchive', id, fence)
    if (!restored.ok) return { ok: false, reason: `compensation failed for ${id}: ${restored.error}` }
  }
  const [activeAfter, archivedAfter] = await Promise.all([
    codexThreadList(sock, { archived: false, sourceKinds: [] }),
    codexThreadList(sock, { archived: true, sourceKinds: [] }),
  ])
  const restored = activeAfter.ok && archivedAfter.ok && codexRuntimeGeneration(dir, plan.endpoint) === plan.generation &&
    plan.activeIds.every((id) => activeAfter.ids.includes(id) && !archivedAfter.ids.includes(id)) &&
    plan.archivedIds.every((id) => archivedAfter.ids.includes(id) && !activeAfter.ids.includes(id))
  return restored ? { ok: true } : { ok: false, reason: 'compensation failed or archive state is unknown' }
}

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

// Resource ownership asks the adapter for what the shared server actually owns now. Records are joined later;
// they are never treated as references by themselves. A loaded thread is a control-plane reference and its
// fresh inProgress turn (the same predicate used by delivery) distinguishes active from addressable-idle.
export function codexSharedRuntimeProbe(dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir)): Promise<SharedRuntimeProbe> {
  const sock = endpoint.socketPath
  return (async () => {
    // File presence is not process identity. A dead PID plus a stale socket file is the normal crash residue;
    // only a live PID and a live listener establish a resident control plane. This keeps a deliberately absent
    // root a healthy empty census while leaving live-but-ambiguous roots loud and visible.
    let pid = 0
    try { pid = Number(readFileSync(endpoint.pidFile, 'utf8').trim()) } catch { /* absent/stale */ }
    const pidLive = pid > 0 && !!processStartToken(pid)
    const listener = await listenerAt(sock, 800)
    if (!pidLive && listener === 'dead') return { healthy: true, references: [] }
    if (!pidLive || listener !== 'live') return { healthy: false, references: [], error: 'Codex shared root state is unknown (PID/listener identity is not proven)' }
    const generation = codexRuntimeGeneration(dir, endpoint)
    if (!generation) return { healthy: false, references: [], error: 'Codex shared root detached receipt/socket generation is not proven' }
    return new Promise<SharedRuntimeProbe>((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    const references = new Map<string, SharedRuntimeProbe['references'][number]>()
    const requests = new Map<number, string>()
    const loadedRequests = new Set<number>()
    const loadedIds = new Set<string>()
    let loadedRequestId = 2
    let loadedCursor: string | null = null
    let upgraded = false
    let settled = false
    let timer: NodeJS.Timeout
    const done = (result: SharedRuntimeProbe) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(result.healthy && codexRuntimeGeneration(dir, endpoint) !== generation
        ? { healthy: false, references: result.references, error: 'Codex shared root detached receipt/socket generation changed during ownership probe' }
        : result)
    }
    const fail = (error: string) => done({ healthy: false, references: [...references.values()], error })
    timer = setTimeout(() => fail('codex app-server ownership probe timed out after 5000ms'), 5000)
    conn.on('error', (e) => fail(`codex app-server ownership probe failed: ${rpcError(e)}`))
    conn.on('close', () => fail('codex app-server closed during ownership probe'))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) {
        if (typeof m.id === 'number' && loadedRequests.has(m.id)) return fail(`codex app-server loaded/list failed: ${m.error.message || JSON.stringify(m.error)}`)
        const request = typeof m.id === 'number' ? requests.get(m.id) : undefined
        if (request) {
          requests.delete(m.id!)
          if (!requests.size) done({ healthy: true, references: [...references.values()] })
          return
        }
        return fail(`codex app-server ownership request ${m.id ?? 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}`)
      }
      if (m.id === 1 && m.result) {
        send({ method: 'initialized', params: {} })
        loadedRequests.add(loadedRequestId)
        return send({ id: loadedRequestId, method: 'thread/loaded/list', params: { limit: 100 } })
      }
      if (typeof m.id === 'number' && loadedRequests.has(m.id) && m.result) {
        loadedRequests.delete(m.id)
        const data = (m.result as { data?: unknown }).data
        const ids = [...new Set(Array.isArray(data) ? data.flatMap((item) => {
          if (typeof item === 'string') return [item]
          const id = (item as { id?: unknown; threadId?: unknown })?.id ?? (item as { threadId?: unknown })?.threadId
          return typeof id === 'string' ? [id] : []
        }) : [])]
        for (const threadId of ids) loadedIds.add(threadId)
        const next = (m.result as { nextCursor?: unknown }).nextCursor
        loadedCursor = typeof next === 'string' && next ? next : null
        if (loadedCursor) {
          loadedRequestId++
          loadedRequests.add(loadedRequestId)
          return send({ id: loadedRequestId, method: 'thread/loaded/list', params: { cursor: loadedCursor, limit: 100 } })
        }
        // Continue with the complete paginated set, not just the first manager page.
        if (!loadedIds.size) return done({ healthy: true, references: [] })
        loadedIds.forEach((threadId) => {
          const id = 100 + requests.size
          references.set(threadId, { referenceId: threadId, turnPresence: 'unknown' })
          requests.set(id, threadId)
          send({ id, method: 'thread/read', params: { threadId, includeTurns: true } })
        })
        return
      }
      if (typeof m.id === 'number' && requests.has(m.id) && m.result) {
        const threadId = requests.get(m.id)!
        requests.delete(m.id)
        const thread = (m.result as { thread?: { turns?: Array<{ id?: string; status?: string }> } }).thread
        const turnId = activeTurnIdFromThread(m.result)
        references.set(threadId, {
          referenceId: threadId,
          turnPresence: !Array.isArray(thread?.turns) ? 'unknown' : turnId ? 'active' : 'idle',
          ...(turnId ? { turnId } : {}),
        })
        if (!requests.size) done({ healthy: true, references: [...references.values()] })
      }
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return fail(`codex app-server refused ownership probe: ${head.split('\r\n')[0]}`)
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) fail('codex app-server closed during ownership probe')
    })
    })
  })()
}

// @@@ codexStartThread - the BACKEND owns the thread. On the shared PER-PROJECT app-server we `thread/start
// { cwd }` (codex resolves config/hooks/AGENTS.md from that worktree cwd — exactly as claude loads CLAUDE.md
// per-worktree — so one project-scoped server behaves analogously to a per-worktree launch), and the result
// carries the new thread id (`result.thread.id`). The launcher stores that id on the governed record and
// fires the first turn; there is no capture hook and no rollout/cwd scan. Same WS framing as codexThreadId.
// Never throws.
// @@@ codexStartThreadParams - what a BACKEND-owned thread is created with. `config` is the per-request
// override map (the only channel that reaches a thread): `bypass_hook_trust` so our hooks run, and
// `shell_environment_policy.set` so every command this thread spawns carries the governed record id. The
// latter is codex's answer to a structural fact — a codex tool shell descends from the SHARED app-server, so
// it must inherit no identity and be given its own instead (verified live: the shell reports exactly the
// injected id, and the launcher's env leaks nothing).
export function codexStartThreadParams(cwd?: string, bypassHookTrust = false, shellEnv?: Record<string, string>): Record<string, unknown> {
  const config = {
    ...(bypassHookTrust ? { bypass_hook_trust: true } : {}),
    ...(shellEnv && Object.keys(shellEnv).length ? { shell_environment_policy: { set: shellEnv } } : {}),
  }
  return { ...(cwd ? { cwd } : {}), ...(Object.keys(config).length ? { config } : {}) }
}
export function codexStartThread(sock: string, cwd?: string, bypassHookTrust = false, shellEnv?: Record<string, string>): Promise<{ ok: true; threadId: string } | { ok: false; error: string }> {
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
        // The same override map carries the thread's IDENTITY. A codex tool shell is spawned by the SHARED
        // app-server, so it can inherit no session id — and must not, that leak was github#76. Codex's own
        // `shell_environment_policy.set` injects vars into every command THIS thread spawns, so the backend
        // stamps the governed record id there at thread creation, the same moment and the same knowledge with
        // which a claude launch bakes it into its agent's env. Identity then arrives per-thread, needing no
        // alias, no store lookup, and no cwd anywhere downstream.
        return send({ id: 2, method: 'thread/start', params: codexStartThreadParams(cwd, bypassHookTrust, shellEnv) })
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

const codexTurnConfirmMs = () => {
  const configured = Number(process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS)
  return Number.isFinite(configured) && configured >= 100 ? configured : 15_000
}

function sendCodexAppServerTurn(sock: string, threadId: string, text: string, cwd?: string, clientUserMessageId?: string): Promise<DispatchResult> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const hs = codexHandshakeMessages(threadId)   // [initialize(1), initialized, thread/loaded/list(2), thread/read(3)]
    let buf = Buffer.alloc(0), upgraded = false, settled = false
    let fragOp = 0, fragBuf = Buffer.alloc(0)
    let steering = false   // the id-4 message we sent was a steer → an expectedTurnId race may retry as start(5)
    let injected = false
    const done = (r: DispatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const unresolved = (error: string) => done({ ok: false, outcome: injected ? 'commit-unknown' : 'rejected', error })
    const timer = setTimeout(() => unresolved(`codex app-server did not confirm the turn within ${codexTurnConfirmMs()}ms`), codexTurnConfirmMs())
    conn.on('error', (e) => unresolved(`codex app-server connection failed: ${rpcError(e)}`))
    conn.on('close', () => unresolved('codex app-server closed the connection before the turn was confirmed'))
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
          return send(codexInjectMessage(threadId, text, cwd, null, 5, clientUserMessageId))
        if (m.id === 3)                                                     // thread not readable yet (a freshly-started thread is "not materialized
          return send(codexInjectMessage(threadId, text, cwd, null, 5, clientUserMessageId)) // before its first user message") → just turn/start
        return done({ ok: false, outcome: 'rejected', error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      }
      // JSON-RPC initialization is ordered. Under a quiet server the premature notification happened to win;
      // under shared app-server load it was ignored and every later turn waited until the old 5s wall expired.
      if (m.id === 1 && m.result) { send(hs[1]); return send(hs[2]) }      // initialize ack → initialized → ask which threads are loaded
      if (m.id === 2 && m.result) {                                         // loaded-thread list → confirm OUR thread is live, then read it
        const loaded = (m.result as { data?: unknown })?.data
        if (Array.isArray(loaded) && !loaded.includes(threadId))
          return done({ ok: false, error: `Codex thread ${threadId} is not loaded in the app-server (loaded: ${loaded.join(', ') || 'none'}) — prompt NOT delivered` })
        return send(hs[3])                                                 // thread is live → read it to decide steer-vs-start
      }
      if (m.id === 3 && m.result) {                                        // thread read → in-progress turn? steer into it; else start a new one
        const turnId = activeTurnIdFromThread(m.result)
        steering = !!turnId
        injected = true
        return send(codexInjectMessage(threadId, text, cwd, turnId, 4, clientUserMessageId)) // id 4: turn/steer the live turn, or turn/start
      }
      if ((m.id === 4 || m.id === 5) && m.result) return done({ ok: true, outcome: 'accepted' }) // steer/start accepted → the model has the message
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
        if (op === 0x8) return unresolved('codex app-server sent a WebSocket close before turn/start was confirmed')
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
        send(hs[0])                 // wait for initialize before its required initialized notification
      }
      drainFrames()
    })
  })
}

// fire a turn on an owned thread over the per-project socket — the same steer-vs-start delivery the live UI
// uses. The launcher calls this to materialize a freshly-started thread's rollout (the first turn = the launch
// prompt), and delivery reuses it for follow-ups. Exported so the CLI's `codex-launch` can fire the first turn.
export function codexTurn(sock: string, threadId: string, text: string, cwd?: string, clientUserMessageId?: string): Promise<DispatchResult> {
  return sendCodexAppServerTurn(sock, threadId, text, cwd, clientUserMessageId)
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
  const runtimeDir = rec.runtimeDir ?? runtimeRoot()
  const endpoint = rec.harnessSessionId ? codexEndpointForRecord(rec, runtimeDir) : currentCodexGeneration(runtimeDir)
  if (!endpoint) return { ok: false, error: `no exact Codex generation binding for session ${rec.session} — prompt NOT delivered` }
  const sock = endpoint.socketPath
  if (!existsSync(sock)) return { ok: false, error: `no Codex app-server socket for this project — prompt NOT delivered` }
  // use the backend-owned thread id stored at launch; fall back to reading the one loaded thread only if it's
  // empty (a pre-existing session from before the id was stored).
  let threadId = rec.harnessSessionId
  if (!threadId) {
    const r = await codexThreadId(sock)
    if (!r.ok) return { ok: false, error: `${r.error} — prompt NOT delivered` }
    threadId = r.threadId
  }
  return sendCodexAppServerTurn(sock, threadId!, text, rec.worktreePath, rec.deliveryId)
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
export function writeCodexTrust(proj: string, events: readonly string[], cmdFor: (e: string) => string): string {
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
  return file
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
function cleanHarness(h: Harness, proj: string, arts: HarnessArtifacts, preserveProject = false): void {
  // deleteIfEmpty ONLY for an UNTRACKED contract file: a wholly-ours generated file goes; a HOST-TRACKED file
  // that carried nothing but our block (an empty committed CLAUDE.md we folded into) is stripped back to its
  // pristine emptiness but never deleted — deleting a tracked file would surface as a `D` in the host's status.
  for (const f of h.contractFiles(proj)) removeManagedBlock(f, ['<!-- ', ' -->'], !isTrackedFile(proj, f))
  const shim = h.shimFile(proj)
  if ((h.shimScope === 'tree' || !preserveProject) && existsSync(shim) && readFileSync(shim, 'utf8').includes('dispatch.sh')) rmSync(shim, { force: true })
  const anchor = h.worktreeHookAnchor(proj)   // the linked-worktree anchor copy, same identity gate as the shim
  if (anchor && existsSync(anchor) && readFileSync(anchor, 'utf8').includes('dispatch.sh')) rmSync(anchor, { force: true })
  if (!preserveProject) h.removeTrust(proj)
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
// the two implementations.

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification'] as const
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const
// the five claude-shaped events pi's generated extension SYNTHESIZES from its own lifecycle (session_start →
// SessionStart, input → UserPromptSubmit, tool_call → PreToolUse, tool_result → PostToolUse, agent_end +
// agent_settled → Stop). pi has no idle/attention or failed-stop event → no Notification/StopFailure, same
// real gap as codex.
const PI_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

// the resolved base launcher command per harness (the wrapper that sets the config-dir env), shared by
// launchCmd and baseCmd so the two never diverge: the launcher's pinned `cmd` wins. The plain command is only
// the fallback for a truly-old record with NO pinned cmd and NO launcher name — compatibility must preserve
// the harness's normal permission model, never silently introduce an automatic-permission flag. There is no
// env/config-field resolution because launchers are ordinary named config entries ([[launcher-select]]).
const claudeBaseCmd = (cmd?: string) => cmd || 'claude'
const codexBaseCmd = (cmd?: string) => cmd || 'codex'
const piBaseCmd = (cmd?: string) => cmd || 'pi'   // pi runs tools without permission prompts — no yolo flag exists or is needed
const opencodeBaseCmd = (cmd?: string) => cmd || 'opencode'

// @@@ opencodeLaunchCommand - the tail-branching launch script (the codex marker pattern, minus any server:
// opencode is a per-session process like claude). The caller-appended tail ("$@") is EITHER one single-quoted
// prompt arg (a NEW launch → `--prompt`), or a resume marker from opencodeHarness.resumeArg: `--resume <id>`
// re-attaches the owned opencode session (`--session <id>`, the SAME conversation), `--continue` re-attaches
// the worktree's last session when no id was ever captured (the plugin failed before its first event). A new
// launch's tail can never BE a literal marker (it's one quoted prompt), so the branch is unambiguous.
export function opencodeLaunchCommand(opencodeCmd = 'opencode'): string {
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

const socketListenerLiveness: Harness['liveness'] = (_rec, tmuxAlive, _runtimeDir, _pane, socketLive) =>
  (tmuxAlive && !!socketLive ? 'online' : 'offline')

const socketListenerOrPidAliveLiveness: Harness['liveness'] = (_rec, tmuxAlive, _runtimeDir, pane, socketLive) =>
  (tmuxAlive && (!!socketLive || pane?.pidAlive === true) ? 'online' : 'offline')

const recordOnline: Harness['liveness'] = (rec) => rec.stopped ? 'offline' : 'online'

// @@@ unlinkSocks - remove ONLY the transport this teardown PROVED dead. `cleanupRuntime` unlinks *their*
// socket, and the honest test of "theirs" is that the agent it just killed is GONE. It used to unlink on
// faith, which is unsound because a socket path is derived from the session id ALONE: it is the one
// per-session resource NOT scoped by the store (`SPEXCODE_HOME`) or the tmux server (`SPEXCODE_TMUX`), so an
// isolated instance closing an id that also names a LIVE session elsewhere had its `kill-session` miss (that
// IS namespaced) while this unlink landed (it is not) — deleting a working agent's socket out from under it.
// The damage is invisible and permanent: the listener stays bound to an unlinked path, so nothing can ever
// connect again (delivery fails its existsSync gate) and every probe ENOENTs, which the liveness axis reads as
// PROVEN death — a live worker reading `offline`, which in turn disarms the relaunch guard.
// So: poll until death is proven, then unlink. A listener still answering past the wall is somebody's live
// agent — mine that failed to die, or one that was never mine — and either way it is not ours to remove: leave
// it and say so. `unproven` is not proof either, so it is left too. The asymmetry is deliberate: a dead-but-
// unlinked file is harmless residue the next teardown reaps, while a wrong unlink strands a working agent.
const SOCK_DEATH_WALL_MS = 2000   // a killed agent releases its listener in well under this; the wall only bounds the wrong case
const SOCK_DEATH_POLL_MS = 100
export const unlinkSocks = async (...paths: string[]): Promise<void> => {
  for (const path of paths) {
    if (!existsSync(path)) continue
    const deadline = Date.now() + SOCK_DEATH_WALL_MS
    let probe = await listenerAt(path)
    while (probe !== 'dead' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, SOCK_DEATH_POLL_MS))
      probe = await listenerAt(path)
    }
    if (probe !== 'dead') {
      console.warn(`spex: left ${path} in place — ${probe === 'live'
        ? 'a listener is still answering it, so it belongs to a running agent (this teardown did not kill it, or it was never ours)'
        : 'the listener probe could not conclude, and death was never proven'}`)
      continue
    }
    try { rmSync(path, { force: true }) } catch { /* already gone */ }
  }
}

const rendezvousLaunchEnv = (id: string): string[] => [
  'CLAUDE_BG_BACKEND=daemon',
  `CLAUDE_BG_RENDEZVOUS_SOCK=${rvSock(id)}`,
]
const noLaunchEnv = (): string[] => []

export const claudeHarness: Harness = {
  id: 'claude',
  dispatchId: 'claude',
  headless: false,
  events: CLAUDE_EVENTS,
  ownsRendezvous: true,                              // reclaude opens the rendezvous control socket (prompt delivery + liveness)
  paneTitleIsSelfSummary: true,                      // claude writes its live task summary into the OSC pane title → headline derives from it
  launchCmd: (_id, _rt, cmd) => claudeBaseCmd(cmd),  // claude's full invocation IS its base command (the tail is appended by the caller)
  baseCmd: claudeBaseCmd,
  sessionIdArg: (id) => `--session-id ${id}`,        // the caller chooses the id
  sessionEnvVar: 'CLAUDE_CODE_SESSION_ID',
  launchEnv: rendezvousLaunchEnv,
  shimFile: (proj) => join(proj, '.claude', 'settings.json'),
  shimScope: 'tree',
  worktreeHookAnchor: () => null,                    // claude's shim already lives in the worktree (.claude/settings.json) — self-anchors, no root rewrite
  contractFiles: (proj) => [join(proj, 'CLAUDE.md')],
  skillDir: (proj) => join(proj, '.claude', 'skills'),
  agentDir: (proj) => join(proj, '.claude', 'agents'),
  shim: (dispatch, spex) => buildShim('claude', CLAUDE_EVENTS, dispatch, spex),
  writeTrust: () => [],                            // Claude relies on folder-trust — no artifact to report
  removeTrust: () => { /* Claude wrote no trust — nothing to strip */ },
  clean(proj, arts, preserveProject) { cleanHarness(this, proj, arts, preserveProject) },
  slashCommands: claudeSlashCommands,
  // online iff the window is up AND a LIVE LISTENER is on the rendezvous socket (`socketLive`, connect-probed by
  // the caller) — NOT the mere existence of a stale socket FILE a crashed claude leaves behind (the 30-min
  // dead-pane-reads-working bug). See rendezvousListening.
  liveness: socketListenerLiveness,
  leafOwnerNeedle: (rec) => rec.session,
  deliver: (rec, text) => deliverViaRendezvous(rec.session, text),
  cleanupRuntime: (rec) => unlinkSocks(rvSock(rec.session)),
  coldRuntime: async () => ({ ok: true }),
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
  // claude's settled launch failures, in its own words: a `--resume` id it has no conversation for (the id was
  // never claude's, or its transcript is gone), and a rejected credential. Both are the same command failing
  // the same way every time — the human must repair the conversation or the login, so the transport stops at
  // one attempt and shows this line instead of burying it under two more identical failures.
  fatalLaunchOutput: ['No conversation found with session ID', 'Invalid API key', 'Please run /login'],
}

// Claude headless is a separate harness, not a claude mode. Its materialize half is exactly Claude's and is
// reused by object composition; the whole runtime half is replaced by the stream-json controller.
export const claudeHeadlessHarness: Harness = {
  ...claudeHarness,
  id: 'claude-headless',
  headless: true,
  runtimeOwnership: 'adapter',
  ownsRendezvous: false,
  paneTitleIsSelfSummary: false,
  launchCmd: (id, runtimeDir, cmd) => claudeHeadlessLaunchCommand(id, runtimeDir ?? runtimeRoot(), claudeBaseCmd(cmd)),
  launchEnv: noLaunchEnv,
  // Liveness is the intact, non-stopped record's property. A missing controller/child fails loudly at control
  // time rather than turning an idle (no child) session into a speculative offline row.
  liveness: recordOnline,
  deliver: deliverViaClaudeHeadless,
  interrupt: interruptClaudeHeadless,
  cleanupRuntime: (rec) => unlinkSocks(claudeHeadlessSock(rec.session)),
  coldRuntime: async () => ({ ok: false, reason: 'claude-headless has no exact resident unload verification' }),
  deliveryBlockedBy: undefined,
}

function codexRuntimeDescriptor(endpoint: CodexGenerationEndpoint, runtimeDir: string): SharedRuntimeDescriptor {
  return {
    key: codexDescriptorKey(endpoint),
    label: endpoint.id === 'legacy' ? 'Codex app-server' : `Codex app-server ${endpoint.id.slice(0, 18)}`,
    pidFile: endpoint.pidFile,
    receiptFile: endpoint.receiptFile,
    residency: async () => {
      let pid = 0
      try { pid = Number(readFileSync(endpoint.pidFile, 'utf8').trim()) } catch { /* stale/missing pid */ }
      const pidLive = pid > 0 && !!processStartToken(pid)
      const listener = await listenerAt(endpoint.socketPath, 800)
      if (!pidLive && listener === 'dead') return { healthy: true, referenceIds: [], rootAbsent: true }
      if (pidLive && (!codexRuntimeGeneration(runtimeDir, endpoint) || listener !== 'live'))
        return { healthy: false, referenceIds: [], error: 'Codex shared root identity/socket generation is not proven' }
      if (!pidLive || listener !== 'live')
        return { healthy: false, referenceIds: [], error: 'Codex shared root state is unknown' }
      const result = await codexLoadedReferenceIds(endpoint.socketPath)
      return result.ok ? { healthy: true, referenceIds: result.referenceIds } : { healthy: false, referenceIds: [], error: result.error }
    },
    mutationGuard: (targetReferenceId, opts) => codexMutationGuard(targetReferenceId, runtimeDir, opts, endpoint),
    probe: () => codexSharedRuntimeProbe(runtimeDir, endpoint),
  }
}

function codexRuntimeDescriptors(runtimeDir: string): SharedRuntimeDescriptor[] {
  const endpoints = codexGenerationEndpoints(runtimeDir)
  return (endpoints.length ? endpoints : [legacyCodexGenerationEndpoint(runtimeDir)])
    .map((endpoint) => codexRuntimeDescriptor(endpoint, runtimeDir))
}

export const codexHarness: Harness = {
  id: 'codex',
  dispatchId: 'codex',
  headless: false,
  sharedRuntimeSpawn: true,
  events: CODEX_EVENTS,
  ownsRendezvous: false,                             // no reclaude daemon — liveness + prompts through the project app-server socket
  paneTitleIsSelfSummary: false,                     // codex's pane title is a spinner + the cwd folder name, NOT a task summary → headline uses the prompt
  launchCmd: (id, runtimeDir, cmd) => codexLaunchCommand(id, codexBaseCmd(cmd), undefined, runtimeDir ?? runtimeRoot()),   // the full app-server+TUI script BUILT AROUND the resolved base command; ONE app-server per PROJECT
  baseCmd: codexBaseCmd,
  sessionIdArg: () => '',                            // codex assigns its own id (the backend owns it via thread/start)
  sessionEnvVar: 'CODEX_THREAD_ID',
  launchEnv: noLaunchEnv,
  // Codex discovers a LINKED worktree's PROJECT hooks from the ROOT CHECKOUT's `.codex`, NOT the worktree's
  // (codex-rs `root_checkout_hooks_folder_for_dir` rewrites the hooks-config folder to <repo_root>/<rel>/.codex
  // for any linked worktree). Every worktree's thread (cwd = worktree root) therefore reads the SAME
  // <mainCheckout>/.codex/hooks.json — so the codex hooks shim + its trust materialize at the MAIN checkout
  // (one per project, mirroring the per-project runtime tier), while the AGENTS.md contract + skills stay
  // per-worktree (codex loads THOSE by walking the thread cwd). dispatch.sh resolves `proj` from the thread
  // cwd, so one shared shim serves every worktree.
  shimFile: (proj) => join(mainCheckout(proj), '.codex', 'hooks.json'),
  shimScope: 'project',
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
  writeTrust: (proj, cmdFor) => [writeCodexTrust(mainCheckout(proj), CODEX_EVENTS, cmdFor)],
  // trust is keyed by the MAIN checkout (where the codex shim materializes) — strip it at the same key.
  removeTrust: (proj) => removeCodexTrust(mainCheckout(proj)),
  clean(proj, arts, preserveProject) { cleanHarness(this, proj, arts, preserveProject) },
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
  leafOwnerNeedle: (rec) => rec.harnessSessionId ?? null,
  deliver: (rec, text) => deliverViaCodexAppServer(rec, text),
  observeTurnFailures: codexTurnFailureObserver,
  cleanupRuntime: async () => { /* project-scoped app-server is shared; no per-session transport to remove */ },
  targetDescriptorKey: (rec) => {
    const endpoint = codexEndpointForRecord(rec)
    return endpoint ? codexDescriptorKey(endpoint) : null
  },
  coldRetirementPreflight: async (rec) => {
    if (!rec.harnessSessionId) return { ok: false, reason: 'no exact Codex thread identity is registered' }
    const threadId = rec.harnessSessionId
    const dir = runtimeRoot()
    const endpoint = codexEndpointForRecord(rec, dir)
    if (!endpoint) return { ok: false, reason: 'no exact Codex generation binding is registered for this target' }
    const generationBefore = codexRuntimeGeneration(dir, endpoint)
    if (!generationBefore) return { ok: false, reason: 'Codex shared app-server generation is unproven' }
    const result = await codexColdPreflight(threadId, dir, generationBefore, endpoint)
    if (codexRuntimeGeneration(dir, endpoint) !== generationBefore)
      return { ok: false, reason: 'shared Codex app-server generation changed during cold retirement guard' }
    if (!result.ok) return result
    if (!result.alreadyCold)
      return { ok: false, reason: `Codex target subtree ${result.receipt.activeIds.join(', ')} is not fully archived` }
    return { ok: true, alreadyCold: true }
  },
  coldPreflight: async (rec) => {
    if (!rec.harnessSessionId) return { ok: false, reason: 'no exact Codex thread identity is registered' }
    const endpoint = codexEndpointForRecord(rec)
    return endpoint ? codexColdPreflight(rec.harnessSessionId, runtimeRoot(), undefined, endpoint)
      : { ok: false, reason: 'no exact Codex generation binding is registered for this target' }
  },
  coldRuntime: async (rec, suppliedReceipt) => {
    if (!rec.harnessSessionId) return { ok: false, reason: 'no exact Codex thread identity is registered' }
    const threadId = rec.harnessSessionId
    const dir = runtimeRoot()
    const endpoint = codexEndpointForRecord(rec, dir)
    if (!endpoint) return { ok: false, reason: 'no exact Codex generation binding is registered for this target' }
    const sock = endpoint.socketPath
    const generationBefore = codexRuntimeGeneration(dir, endpoint)
    if (!generationBefore) return { ok: false, reason: 'Codex shared app-server generation is unproven' }
    if (suppliedReceipt !== undefined && (!isCodexColdPlan(suppliedReceipt) || suppliedReceipt.threadId !== threadId))
      return { ok: false, reason: 'Codex cold teardown receipt is missing, malformed, or names a different target' }
    const frozenPlan = isCodexColdPlan(suppliedReceipt) ? suppliedReceipt : null
    if (frozenPlan && (frozenPlan.generation !== generationBefore || frozenPlan.endpoint.id !== endpoint.id))
      return { ok: false, reason: 'shared Codex app-server generation changed after archive preflight' }
    const preflight = await codexColdPreflight(threadId, dir, frozenPlan?.generation ?? generationBefore, endpoint)
    if (!preflight.ok) return preflight
    const plan = frozenPlan ?? preflight.receipt
    if (frozenPlan && (!sameIdSet(frozenPlan.descendantIds, preflight.receipt.descendantIds) ||
      !sameParentEdges(frozenPlan.parentEdges, preflight.receipt.parentEdges) ||
      !sameIdSet(frozenPlan.activeIds, preflight.receipt.activeIds) ||
      !sameIdSet(frozenPlan.archivedIds, preflight.receipt.archivedIds)))
      return { ok: false, reason: 'Codex target subtree ownership or collection assignment changed after archive preflight' }
    if (codexRuntimeGeneration(dir, endpoint) !== plan.generation)
      return { ok: false, reason: 'shared Codex app-server generation changed during target subtree guard' }
    if (plan.activeIds.length === 0) return { ok: true }
    const subtreeSet = new Set(plan.subtreeIds)
    const siblingBefore = plan.guard.referenceIds.filter((referenceId) => !subtreeSet.has(referenceId))
    const fence = { dir, endpoint, generation: plan.generation }

    const compensate = async (reason: string): Promise<{ ok: false; reason: string }> => {
      const restored = await codexRestoreColdPlan(plan, dir)
      return { ok: false, reason: restored.ok ? reason : `${reason}; ${restored.reason}` }
    }

    const coldCheck = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const after = await codexColdPreflight(threadId, dir, plan.generation, endpoint)
      if (!after.ok) return after
      if (codexRuntimeGeneration(dir, endpoint) !== plan.generation) return { ok: false, reason: 'shared Codex app-server generation changed during archive' }
      if (!sameIdSet(plan.descendantIds, after.receipt.descendantIds) || !sameParentEdges(plan.parentEdges, after.receipt.parentEdges))
        return { ok: false, reason: `Codex target descendant closure changed during archive (before=${plan.descendantIds.join(', ')}; after=${after.receipt.descendantIds.join(', ')})` }
      if (after.receipt.activeIds.length)
        return { ok: false, reason: `Codex target subtree remains in the active collection (${after.receipt.activeIds.join(', ')})` }
      if (!sameIdSet(plan.subtreeIds, after.receipt.archivedIds))
        return { ok: false, reason: 'Codex target subtree is not uniquely archived after cold teardown' }
      const afterIds = new Set(after.receipt.guard.referenceIds.filter((referenceId) => !subtreeSet.has(referenceId)))
      if (siblingBefore.some((referenceId) => !afterIds.has(referenceId))) return { ok: false, reason: 'a pre-existing shared Codex sibling reference disappeared during archive' }
      return { ok: true }
    }
    for (const id of plan.activeIds) {
      const archived = await codexThreadMutation(sock, 'thread/archive', id, fence)
      if (!archived.ok) return compensate(`${archived.error} while archiving Codex subtree member ${id}`)
    }
    let verified: { ok: true } | { ok: false; reason: string } = { ok: false, reason: 'Codex archive verification timed out' }
    const verifyDeadline = Date.now() + 30_000
    for (let attempt = 0; attempt < 6 && Date.now() < verifyDeadline; attempt++) {
      verified = await coldCheck()
      if (verified.ok) break
      if (Date.now() < verifyDeadline) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (verified.ok) return verified
    return compensate(verified.reason)
  },
  quarantineOrphanThread: codexQuarantineOrphanThread,
  restoreRuntime: async (rec, suppliedReceipt) => {
    if (!rec.harnessSessionId) return { ok: false, reason: 'no exact Codex thread identity is registered' }
    if (suppliedReceipt !== undefined) {
      if (!isCodexColdPlan(suppliedReceipt) || suppliedReceipt.threadId !== rec.harnessSessionId)
        return { ok: false, reason: 'Codex cold compensation receipt is invalid or names a different target' }
      return codexRestoreColdPlan(suppliedReceipt)
    }
    const endpoint = codexEndpointForRecord(rec)
    if (!endpoint) return { ok: false, reason: 'no exact Codex generation binding is registered for this target' }
    const sock = endpoint.socketPath
    const reconcile = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const [active, archived] = await Promise.all([
        codexThreadList(sock, { archived: false, sourceKinds: [] }),
        codexThreadList(sock, { archived: true, sourceKinds: [] }),
      ])
      if (!active.ok || !archived.ok) return { ok: false, reason: 'Codex restore state could not be reconciled' }
      const inActive = active.ids.includes(rec.harnessSessionId!)
      const inArchived = archived.ids.includes(rec.harnessSessionId!)
      if (inActive && !inArchived) return { ok: true }
      if (inArchived && !inActive) return { ok: false, reason: 'Codex thread remains archived; restore can be retried' }
      return { ok: false, reason: 'Codex restore state is ambiguous (thread in both or neither collection)' }
    }
    const restored = await codexThreadMutation(sock, 'thread/unarchive', rec.harnessSessionId)
    if (!restored.ok) return reconcile()
    return reconcile()
  },
  sharedRuntimes: codexRuntimeDescriptors,
  // owned thread id → `--resume <id>` MARKER the codex launch script reads to resume that thread DIRECTLY (NOT
  // a tail handed to a bare `codex` — the script's final `codex … resume "$tid"` performs codex's own resume on
  // the owned id, the SAME conversation); none → empty tail → relaunch a FRESH thread on the same worktree/record.
  resumeArg: (rec) => (rec.harnessSessionId ? `--resume ${rec.harnessSessionId}` : ''),
  // codex's own settled failure: a thread id whose rollout is not on disk can never be resumed, so the launch
  // that says so has already decided. (Its transient sibling — the rollout still being written — is handled
  // BEFORE launch by waitForCodexRollout, so what reaches here is the permanent case.)
  fatalLaunchOutput: ['no rollout found for thread id'],
}

type CodexHeadlessLaunchReadinessProof = Readonly<{
  kind: 'codex-headless-shared-runtime'
  descriptorKey: string
  generation: CodexRuntimeGenerationProof
  target: Readonly<{
    sessionId: string
    threadId: string
    ownerSessionId: string
    ownerCount: 1
    ownerState: 'governed'
    referenceState: 'loaded'
    protectsControlPlane: true
  }>
}>

const sameCodexHeadlessReadinessProof = (left: CodexHeadlessLaunchReadinessProof, right: CodexHeadlessLaunchReadinessProof) =>
  left.kind === right.kind &&
  left.descriptorKey === right.descriptorKey &&
  codexRuntimeGenerationToken(left.generation) === codexRuntimeGenerationToken(right.generation) &&
  left.target.sessionId === right.target.sessionId &&
  left.target.threadId === right.target.threadId &&
  left.target.ownerSessionId === right.target.ownerSessionId &&
  left.target.ownerCount === right.target.ownerCount &&
  left.target.ownerState === right.target.ownerState &&
  left.target.referenceState === right.target.referenceState &&
  left.target.protectsControlPlane === right.target.protectsControlPlane

const governedSharedRuntimeOwners = (runtimeDir: string, descriptorKey: string, threadId: string, excludingSessionId?: string): string[] | null => {
  const root = join(runtimeDir, 'sessions')
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null }
  const owners: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === excludingSessionId) continue
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(join(root, entry.name, 'session.json'), 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as { session_id?: unknown; governed?: unknown; harness?: unknown; harness_session_id?: unknown }
    if (typeof record.session_id !== 'string') return null
    if (record.governed !== true) continue
    const harnessId = typeof record.harness === 'string' && record.harness ? record.harness : defaultHarness.id
    let sharesDescriptor = false
    try { sharesDescriptor = (harnessById(harnessId).sharedRuntimes?.(runtimeDir) ?? []).some((descriptor) => descriptor.key === descriptorKey) }
    catch { return null }
    if (sharesDescriptor && record.harness_session_id === threadId) owners.push(record.session_id)
  }
  return owners
}

async function codexHeadlessReadinessProof(current: () => HarnessLaunchReadyRecord | null): Promise<CodexHeadlessLaunchReadinessProof | null> {
  const record = current()
  if (!record?.governed || record.stopped || record.archived || !record.harnessSessionId) return null
  const endpoint = codexEndpointForRecord(record, record.runtimeDir)
  if (!endpoint) return null
  const descriptor = codexHeadlessHarness.sharedRuntimes?.(record.runtimeDir)
    .find((candidate) => candidate.key === codexDescriptorKey(endpoint))
  if (!descriptor?.residency) return null
  const generationBefore = codexRuntimeGenerationProof(record.runtimeDir, endpoint)
  if (!generationBefore) return null
  let resident: Awaited<ReturnType<NonNullable<SharedRuntimeDescriptor['residency']>>>
  try { resident = await descriptor.residency() }
  catch { return null }
  if (!resident.healthy) return null
  if (!resident.referenceIds.includes(record.harnessSessionId)) return null
  const owners = governedSharedRuntimeOwners(record.runtimeDir, descriptor.key, record.harnessSessionId)
  if (!owners || owners.length !== 1 || owners[0] !== record.session) return null
  const generationAfter = codexRuntimeGenerationProof(record.runtimeDir, endpoint)
  if (!generationAfter || codexRuntimeGenerationToken(generationBefore) !== codexRuntimeGenerationToken(generationAfter)) return null
  return Object.freeze({
    kind: 'codex-headless-shared-runtime',
    descriptorKey: descriptor.key,
    generation: generationAfter,
    target: Object.freeze({
      sessionId: record.session,
      threadId: record.harnessSessionId,
      ownerSessionId: owners[0],
      ownerCount: 1,
      ownerState: 'governed',
      referenceState: 'loaded',
      protectsControlPlane: true,
    }),
  })
}

// Codex headless is an independent adapter: its materialization and app-server delivery are exactly Codex's,
// while launch only runs the backend-owned thread/start + first turn. There is no TUI to attach after that turn;
// the shared project app-server keeps the thread addressable and idle sends use the inherited JSON-RPC channel.
export const codexHeadlessHarness: Harness = {
  ...codexHarness,
  id: 'codex-headless',
  headless: true,
  runtimeOwnership: 'adapter',
  launchOneShot: true,
  launchCmd: (id, runtimeDir, cmd) => codexHeadlessLaunchCommand(id, codexBaseCmd(cmd), undefined, runtimeDir ?? runtimeRoot()),
  // Record-backed liveness is the family contract for sleeping headless threads. An explicit stop is the one
  // offline marker; other app-server/thread failures surface through delivery rather than speculative liveness.
  liveness: recordOnline,
  launchReady: async (current, deadline) => {
    for (;;) {
      const proof = await codexHeadlessReadinessProof(current)
      if (proof) return {
        proof,
        validate: async (latest) => {
          const currentProof = await codexHeadlessReadinessProof(latest)
          return !!currentProof && sameCodexHeadlessReadinessProof(proof, currentProof)
        },
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) return null
      await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)))
    }
  },
  // There is no TUI to restart and the project app-server keeps the thread addressable. A forced reopen therefore
  // runs the headless launch's empty-tail no-op; normal resume remains guarded by record-backed online liveness.
  resumeArg: () => '',
}

// @@@ piHarness - the pi adapter (@earendil-works/pi-coding-agent). pi is the CLOSEST to claude of the four:
// the caller pins the session id at launch (`--session-id <id>`, creating the session if missing), the shim
// lives IN the worktree, and the rendezvous prompt/liveness channel is REUSED wholesale — pi has no external
// hook binding (its lifecycle surface is the in-process extension API), so the shim is a GENERATED TypeScript
// extension (.pi/extensions/spexcode.ts, run natively by pi) that forwards five claude-shaped events to
// dispatch.sh AND binds this session's rendezvous socket itself (the adapter's launchEnv exports
// CLAUDE_BG_RENDEZVOUS_SOCK) speaking the reclaude line protocol — so
// deliverViaRendezvous and the socket-listener liveness work UNCHANGED. Trust: pi gates project-local
// extensions behind saved per-directory trust (~/.pi/agent/trust.json), so writeTrust stamps the main
// checkout there (the nearest-parent lookup covers nested worktrees) and the launch carries `--approve` as
// one-run defence. See pi-harness.ts for the extension source + trust mechanics.
export const piHarness: Harness = {
  id: 'pi',
  dispatchId: 'pi',
  headless: false,
  events: PI_EVENTS,
  ownsRendezvous: true,                              // the generated extension binds rvSock(id) and speaks the reclaude protocol
  paneTitleIsSelfSummary: false,                     // pi's pane title is not an agent-written task summary → headline uses the prompt preview
  launchCmd: (_id, _rt, cmd) => `${piBaseCmd(cmd)} --approve`,   // --approve = one-run project trust (belt to writeTrust's braces)
  baseCmd: piBaseCmd,
  sessionIdArg: (id) => `--session-id ${id}`,        // caller pins the exact session id, claude-style (created if missing)
  sessionEnvVar: 'PI_SESSION_ID',                    // exported by the generated extension at session_start; tool subprocesses inherit it
  launchEnv: rendezvousLaunchEnv,
  shimFile: (proj) => join(proj, '.pi', 'extensions', 'spexcode.ts'),
  shimScope: 'tree',
  worktreeHookAnchor: () => null,                    // the extension lives in the worktree and self-anchors, like claude
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],   // pi auto-loads AGENTS.md context files (shared with codex — writeManagedBlock is idempotent)
  skillDir: (proj) => join(proj, '.pi', 'skills'),   // Agent Skills standard dirs, discovered after project trust
  agentDir: () => null,                              // pi has no file-discovered sub-agent primitive — materialize skips it
  shim: (dispatch, spex) => ({
    content: piExtensionSource(dispatch, spex),
    cmd: (e: string) => `SPEX='${spex}' bash ${dispatch} pi ${e}`,   // what the extension actually spawns, for parity with buildShim
  }),
  writeTrust: (proj) => [writePiTrust(mainCheckout(proj))], // trust keys on the MAIN checkout; nearest-parent lookup covers worktrees
  removeTrust: (proj) => removePiTrust(mainCheckout(proj)),
  clean(proj, arts, preserveProject) { cleanHarness(this, proj, arts, preserveProject) },
  slashCommands: piSlashCommands,
  // claude's exact liveness: the window is up AND a live LISTENER answers on the rendezvous socket — the
  // socket the generated extension binds. socketLive is already probed for every windowed session.
  liveness: socketListenerLiveness,
  leafOwnerNeedle: (rec) => rec.session,
  deliver: (rec, text) => deliverViaRendezvous(rec.session, text),
  cleanupRuntime: (rec) => unlinkSocks(rvSock(rec.session)),
  coldRuntime: async () => ({ ok: true }),
  // reopen the SAME conversation: `--session <id>` resumes the exact session we pinned at launch and FAILS
  // LOUD when its file is gone (unlike `--session-id`, which would silently mint a fresh empty session).
  resumeArg: (rec) => `--session ${rec.session}`,
}

// pi-headless is an independent harness: its materialization surface is literally pi's, while a resident
// controller owns non-interactive text-mode turns. Active turns steer through pi's rendezvous extension;
// idle delivery cold-wakes the exact saved session with `--session` (never `--session-id`, which would create a
// new conversation). The controller deliberately reports record-backed liveness, matching Claude headless.
export const piHeadlessHarness: Harness = {
  ...piHarness,
  id: 'pi-headless',
  headless: true,
  runtimeOwnership: 'adapter',
  paneTitleIsSelfSummary: false,
  launchCmd: (id, runtimeDir, cmd) => piHeadlessLaunchCommand(id, runtimeDir ?? runtimeRoot(), piBaseCmd(cmd)),
  liveness: recordOnline,
  deliver: deliverViaPiHeadless,
  cleanupRuntime: (rec) => unlinkSocks(piHeadlessSock(rec.session), rvSock(rec.session)),
  coldRuntime: async () => ({ ok: false, reason: 'pi-headless has no exact resident unload verification' }),
  deliveryBlockedBy: undefined,
  resumeArg: (rec) => `--session ${rec.session}`,
}

export const opencodeHarness: Harness = {
  id: 'opencode',
  dispatchId: 'opencode',
  headless: false,
  events: OPENCODE_EVENTS,
  // LITERALLY true: the generated plugin ([[opencode-harness]], opencode.ts) BINDS the per-session rendezvous
  // socket the launch env hands it and speaks the reply/repaint mini-protocol, so claude's deliver (atomic
  // parse-confirmed write) and socket-listener liveness are reused verbatim — no opencode transport code.
  ownsRendezvous: true,
  paneTitleIsSelfSummary: false,                     // opencode's TUI title is not the agent's live task self-summary → headline uses the prompt
  launchCmd: (_id, _rt, cmd) => opencodeLaunchCommand(opencodeBaseCmd(cmd)),   // the tail-branching script (prompt vs --resume/--continue marker)
  baseCmd: opencodeBaseCmd,
  sessionIdArg: () => '',                            // opencode mints its own session id; the plugin's first event reports it back (opencode-capture)
  // opencode exports NO per-session env var to its tool subprocesses (probed, 1.18.3). Identity flows through
  // the launch-injected SPEXCODE_SESSION_ID — honest here because each opencode TUI is a per-session process
  // (no codex-style shared-server contamination). This var is therefore never set; envSessionId's
  // SPEXCODE_SESSION_ID tier resolves the record.
  sessionEnvVar: 'OPENCODE_SESSION_ID',
  launchEnv: rendezvousLaunchEnv,
  // the "shim" is a generated opencode PLUGIN in the worktree's own tree — opencode auto-loads project plugins
  // by walking the cwd, so like claude it self-anchors and needs no root-checkout rewrite or worktree anchor.
  shimFile: (proj) => join(proj, '.opencode', 'plugins', 'spexcode.ts'),
  shimScope: 'tree',
  worktreeHookAnchor: () => null,
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],   // opencode reads AGENTS.md natively (same file codex owns; the managed block is idempotent across writers)
  skillDir: (proj) => join(proj, '.opencode', 'skills'),
  agentDir: (proj) => join(proj, '.opencode', 'agents'),
  // content = the plugin source; cmd = the SAME per-event command the plugin bakes into dispatch calls, so
  // any consumer that hashes/inspects commands sees one truth (trust is a no-op here regardless).
  shim: (dispatch, spex) => ({ content: opencodePluginSource(dispatch, spex), cmd: (e) => `SPEX='${spex}' bash ${dispatch} opencode ${e}` }),
  writeTrust: () => [],                            // permission policy stays with the launcher command; no trust artifact to report
  removeTrust: () => { /* nothing was written */ },
  clean(proj, arts, preserveProject) { cleanHarness(this, proj, arts, preserveProject) },
  slashCommands: opencodeSlashCommands,
  // online iff the window is up AND the agent answers on a channel: PREFER the rendezvous socket listener
  // (the plugin is alive), FALL BACK to the launch-registered agent.pid (kill-0) so a plugin that failed to
  // load still reads honestly from the process signal instead of a false offline.
  liveness: socketListenerOrPidAliveLiveness,
  leafOwnerNeedle: (rec) => rec.session,
  deliver: (rec, text) => deliverViaRendezvous(rec.session, text),
  cleanupRuntime: (rec) => unlinkSocks(rvSock(rec.session)),
  coldRuntime: async () => ({ ok: true }),
  // owned opencode session id → `--resume <id>` marker (the launch script re-attaches `--session <id>`, the
  // SAME conversation); never captured → `--continue` marker (opencode's own "last session in this directory",
  // which in a dedicated worktree is this worker's). The discriminator is sound for the same reason codex's
  // is: a NEW launch's tail is always ONE single-quoted prompt arg, never a literal marker.
  resumeArg: (rec) => (rec.harnessSessionId ? `--resume ${rec.harnessSessionId}` : '--continue'),
}

// OpenCode headless is a separate harness, not an opencode mode. Its materialize half is exactly
// opencodeHarness; only the one-turn runtime and its capability row differ.
export const opencodeHeadlessHarness: Harness = {
  ...opencodeHarness,
  id: 'opencode-headless',
  headless: true,
  runtimeOwnership: 'adapter',
  launchCmd: (_id, _runtimeDir, cmd) => opencodeHeadlessLaunchCommand(opencodeBaseCmd(cmd)),
  // A sleeping native conversation is still addressable by its non-stopped record. Transport breakage belongs
  // to the next delivery, where the live rendezvous or pane wake reports it loudly.
  liveness: recordOnline,
  coldRuntime: async () => ({ ok: false, reason: 'opencode-headless has no exact resident unload verification' }),
  deliver: async (rec, text) => {
    return deliverViaSocketOrWake(
      rec.session,
      text,
      () => spawnOpenCodeHeadlessTurn(rec, text, opencodeBaseCmd(rec.launchCmd ?? undefined), rvSock(rec.session)),
      `opencode-headless rendezvous probe was inconclusive for session ${rec.session} - refusing to start a possibly duplicate turn`,
    )
  },
}

// every adapter — materialize iterates this to write each harness's artifacts in one pass.
export const HARNESSES: readonly Harness[] = [claudeHarness, codexHarness, opencodeHarness, piHarness, claudeHeadlessHarness, opencodeHeadlessHarness, piHeadlessHarness, codexHeadlessHarness]

// the legacy/default adapter for old records and config defaults. New launches derive harness from a launcher.
export const defaultHarness: Harness = claudeHarness

// resolve an adapter by id (the detector). Throws on an unknown id — fail loud, never silently default.
export function harnessById(id: string): Harness {
  const h = HARNESSES.find((x) => x.id === id)
  if (!h) throw new Error(`unknown harness '${id}' (known: ${HARNESSES.map((x) => x.id).join(', ')})`)
  return h
}

// --- named launcher profiles ([[launcher-select]]) ----------------------------------------------------------
// a launcher = a `{ harness, cmd }` entry in spexcode.json's `sessions.launchers`, keyed by a
// human-chosen name. `claude` and `codex` are NOT special built-ins — `spex init` SEEDS them as ordinary named
// launchers (with the regular command path), so they are edited like any other. harness defaults to claude.
// resolveLauncher throws fail-loud on an unknown name (a session must never silently launch under the wrong
// auth) and validates the harness id. There is NO env-derived built-in fallback: this registry lists exactly
// the config's real launchers; dashboardLauncherList applies only the dashboard visibility projection.
export type Launcher = { name: string; harness: string; cmd: string; headless: boolean }
export type LauncherDefault = { default: string | null; error: string | null }

// the complete configured named launchers from spexcode.json, as a stable name-sorted list (for CLI/session
// resolution and downstream projections). Picking a launcher is the ONLY launch choice; the old separate
// harness pick is gone.
export function launcherList(root = mainCheckout()): Launcher[] {
  const m = readConfig(root).sessions?.launchers || {}
  return Object.keys(m)
    .map((name) => {
      const harness = harnessById(m[name].harness || defaultHarness.id)
      return { name, harness: harness.id, cmd: m[name].cmd, headless: harness.headless }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// The dashboard's visibility projection. It never removes a launcher from the complete config/CLI path;
// it only narrows GET /api/settings for the New Session picker ([[launcher-visibility]]).
export function dashboardLauncherList(root = mainCheckout()): Launcher[] {
  const showHeadless = readConfig(root).dashboard?.showHeadlessLaunchers === true
  return launcherList(root).filter((launcher) => showHeadless || !launcher.headless)
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
  const harness = harnessById(l.harness || defaultHarness.id)   // validate the harness id fail-loud
  return { name, harness: harness.id, cmd: l.cmd, headless: harness.headless }
}
