import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createConnection } from 'node:net'
import { claudeSlashCommands, opencodeSlashCommands, piSlashCommands, type SlashCommand } from './slash-commands.js'
import { OPENCODE_EVENTS, opencodePluginSource } from './opencode.js'
import { piExtensionSource, writePiTrust, removePiTrust } from './pi-harness.js'
import { claudeHeadlessColdRuntime, claudeHeadlessLaunchCommand, claudeHeadlessSock, deliverViaClaudeHeadless, interruptClaudeHeadless } from './claude-headless.js'
import { opencodeHeadlessColdRuntime, opencodeHeadlessLaunchCommand, spawnOpenCodeHeadlessTurn } from './opencode-headless.js'
import { piHeadlessLaunchCommand, piHeadlessSock, deliverViaPiHeadless, interruptPiHeadless, piHeadlessColdRuntime } from './pi-headless.js'
import { runtimeRoot, mainCheckout, readConfig, sessionArtifactPath, spexcodeHome } from '@spexcode/spec-core'
import { shQuote } from './sh.js'
import { claudeTranscript, claudeTranscriptReader, opencodeTranscript, piTranscript, unsupportedTranscript, type TranscriptReader } from '@spexcode/transcript'
import { harnessIdentity, type HarnessId } from '@spexcode/spec-core'
import { codexHarness, codexHeadlessHarness } from './codex-harness.js'
import { buildShim, cleanHarness, listenerAt, noLaunchEnv, pexec, SPEX } from './harness-shim.js'
import type { ListenerProbe } from './harness-shim.js'
export { buildShim, cleanHarness, headlessTurnFailureShell, listenerAt, noLaunchEnv, paneTreeRuns, procSnapshot, sessionIdentityEnvVars, writeManagedBlock, removeManagedBlock, writeManagedJsonHooks, removeManagedJsonHooks, sharedShimHasHostContent, GENERATED_MARK, isGeneratedArtifact } from './harness-shim.js'
export type { ListenerProbe } from './harness-shim.js'

// @@@ harness-adapter - the ONE seam between SpexCode and the coding-agent harness (Claude Code, native adapter, …).
// Every harness-specific fact lives behind THIS interface with one implementation per harness; product code
// (materialize, sessions, slash, the hook scripts) never branches on which harness it is — it resolves an
// adapter ONCE and calls it. The only `if (native adapter)` / `if (claude)` in the whole product is the detector that
// picks the adapter (here), plus its shell mirror in hooks/harness.sh (shell cannot import this module).
//
// DETECTION. There is no payload-sniffing: each adapter OWNS its shim, and the shim bakes the harness id as
// dispatch.sh's first argument (`bash <dispatch> <id> <Event>`). dispatch.sh exports SPEXCODE_HARNESS, so a
// hook subprocess learns its harness deterministically from the shim that wired it — never from guessing the
// payload shape. On the TS side the harness is derived from the selected launcher or ALL adapters at once
// (materialize writes every harness's artifacts).

export type { HarnessId } from '@spexcode/spec-core'
export type HarnessLivenessRecord = { session: string; harnessSessionId?: string | null; stopped?: boolean; archived?: boolean }
export type HarnessLaunchReadyRecord = HarnessLivenessRecord & { governed?: boolean; runtimeDir: string }
export type HarnessLaunchReadinessFence = {
  readonly proof: Readonly<Record<string, unknown>>
  validate(current: () => HarnessLaunchReadyRecord | null): Promise<boolean>
}
export type TurnFailure = { message: string; completedAt: number | null }
export type FailureSubscription = { close(): void; readonly closed: Promise<string | null>; readonly ready?: Promise<boolean> }
// An adapter's native input transport can be ready, temporarily inconclusive, or proven unreachable. This is
// deliberately separate from agent liveness: sessions.ts joins an unreachable transport with its independent
// registered-pid witness before it calls the conversation stranded.
export type DeliveryTransportState =
  | { kind: 'reachable' }
  | { kind: 'unproven' }
  | { kind: 'unreachable'; reason: string }
// the per-pane runtime probe the caller snapshots ONCE for the whole session list and hands liveness():
// the pane's root pid (tmux `#{pane_pid}`), the hot-tier `pidAlive` verdict, and — ONLY on the legacy path —
// one whole-box pid→(ppid, comm) table (a single `ps` spawn).
//   `pidAlive` = the hot registry's verdict for THIS session's launch-registered `agent.pid`: true = the pid
//     answers kill-0 (alive), false = proven dead (ESRCH, permanently latched per pid-reuse guard), undefined =
//     NO agent.pid file (a pre-registration/old session). native adapter reads this as its liveness truth when present
//     and falls back to `procs` (the whole-box tree walk) only when it is undefined; claude ignores it (its
//     truth is the rendezvous socket).
//   `procs` is gathered (the single `ps` spawn) ONLY when a pid-less native adapter session still needs the legacy
//     tree-walk, so a box with no native adapter — or all pid-registered launches — never pays for it.
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
  // Resource reporting supplies the exact governed references for this generation. The probe still lists
  // every loaded id, but only reads native status for those references; unowned history stays visible as
  // unknown without replaying it on every report.
  probe(referenceIds?: readonly string[]): Promise<SharedRuntimeProbe>
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
  readonly dispatchId: HarnessId
  // whether this harness runs without an interactive TUI. The session projection carries it as
  // `capabilities.headless` (the Conversation-only console); launcher resolution never branches on it.
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
  // native adapter's canonical hook event set (its `HookEventName` enum, native adapter 0.142.3) has no failed-stop and no
  // idle/attention event, so native adapter has NO equivalent of StopFailure / Notification — a real harness difference,
  // not a TODO. It binds only the five it actually fires (see NATIVE ADAPTER_EVENTS).
  readonly events: readonly string[]
  // whether the harness's agent opens Claude Code's background-daemon rendezvous control socket (`CLAUDE_BG_BACKEND=daemon` +
  // `CLAUDE_BG_RENDEZVOUS_SOCK`, a stock claude feature — no wrapper involved). Claude does; native adapter has no such
  // daemon and uses its app-server JSON-RPC control plane instead.
  readonly ownsRendezvous: boolean
  // whether this harness's tmux pane_title is the agent's OWN live task self-summary (so the board headline
  // may derive from it — see [[session-activity]]). Claude continuously writes a one-line task summary into
  // its OSC title → true. native adapter sets the pane title to a spinner glyph + the cwd basename (the worktree FOLDER
  // name), which is NOT a self-summary → false, so its headline falls through to the launch-prompt preview
  // instead of showing the folder name. This is the ONLY harness branch in the headline path: the capability
  // is data on the adapter, not an `if (native adapter)` in sessions.ts.
  readonly paneTitleIsSelfSummary: boolean
  // THE native-thread reader ([[transcript-reader]]): a cheap change probe plus a bounded interval read of the
  // harness's own conversation, returned as normalized turns. Every surface that shows what the agent did —
  // the history seam, the live tail, the transcript stream — reads through this one field, so a harness has
  // exactly one parser. Adapters without a reliable native transcript declare `unsupportedTranscript`, which
  // fails loudly instead of pretending the conversation was empty.
  readonly transcript: TranscriptReader
  // the same reader addressed under a DECLARED agent config dir ([[launcher-select]]'s `configDir`): two
  // launchers of one harness may keep their threads under different dirs (reclaude → ~/.claude, claude-glm →
  // ~/.claude-glm), and the default `transcript` above only knows the harness default root. Optional — an
  // adapter whose thread location is not config-dir-relative simply has no override to offer.
  readonly transcriptAt?: (configDir: string) => TranscriptReader
  // --- launch / sessionId ---
  // the base agent command. Claude: `claude …`; native adapter starts a project-scoped app-server and launches the
  // visible TUI with `--remote` pointed at it. `cmd` is the SESSION's persisted launcher command
  // ([[launcher-select]]) — the resolved `cmd` of the named launcher it was created under. A session always
  // carries one (pinned at creation), so resume keeps that exact command (and auth), never reverting to a
  // global default. Omitted is only for tests and old records before launch_cmd was pinned (→ the bare default).
  launchCmd(id: string, runtimeDir?: string, cmd?: string): string
  // the RESOLVED base launcher command alone — the wrapper/binary that carries the agent's config-dir env
  // (claude `CLAUDE_CONFIG_DIR`, native adapter `NATIVE ADAPTER_HOME`), WITHOUT the per-launch script built around it. `cmd`,
  // when given (the named launcher's `cmd`), IS the answer; else the harness's bare built-in default — there is
  // no env/config-field resolution (claude/native adapter are ordinary named launchers). The launch owner PINS this on the record
  // at creation so a resume replays the EXACT launcher that created the conversation — never re-resolving
  // against a since-changed default, which would point `--resume` at the wrong config dir and lose the
  // transcript ([[launcher-select]], the resume-launcher-pin). launchCmd builds its invocation ON TOP of this.
  baseCmd(cmd?: string): string
  // @@@ oneShotTurn - ONE non-interactive turn: the harness reads a single prompt, works, and exits. This is
  // the seam [[flat]] converges on, and it is deliberately NOT launchCmd — that builds a RESIDENT invocation
  // (a TUI in a tmux pane, or a controller owning a socket) whose prompt tail the launch script appends, and
  // which nothing waits on. Flatcode needs the opposite: a process whose exit means the turn is over.
  // Adapters carry the prompt whichever way their own CLI accepts it — on stdin where the harness reads it
  // (so a multi-KB prompt is never shell-quoted), as an argument where it does not — and product code just
  // writes `stdin` and runs `command` without learning which harness answered. An adapter with no
  // non-interactive mode declares none, and the caller refuses that launcher BY NAME rather than substituting
  // a spelling that would quietly behave differently.
  oneShotTurn?(prompt: string, cmd?: string): { command: string; stdin: string }
  // the flag that pins the session id at launch. Claude lets the caller choose (`--session-id <id>`); native adapter
  // assigns its own, so there is nothing to pass (the id is captured/resumed afterwards).
  sessionIdArg(id: string): string
  // the env var the agent's OWN process carries so its `spex …` calls know their session id.
  readonly sessionEnvVar: string
  // transport bootstrap variables scoped to this launch. Rendezvous adapters own their daemon mode + socket;
  // product launch code only composes these with generic session/home env.
  launchEnv(id: string): string[]

  // --- materialize: shim + contract + trust ([[harness-delivery]]) ---
  // the auto-discovered hook shim file for this harness (.claude/settings.json vs .agent/hooks.json).
  shimFile(proj: string): string
  // whether that shim belongs to one checkout or the whole project. This is adapter placement data: native adapter
  // reads one root-checkout hook file for every linked tree; the other harnesses discover their tree-local file.
  shimScope: 'tree' | 'project'
  // a LINKED WORKTREE's extra shim copy — the worktree-side `.native adapter` hook file that ANCHORS native adapter's project
  // config layer, or null when the harness needs none. native adapter-rs only builds a project config layer (and thus
  // only DISCOVERS a worktree thread's hooks) for a dir in [cwd..project_root] that contains a `.agent/`
  // directory; it then REWRITES that layer's hooks-config folder to the ROOT checkout (root_checkout_hooks_-
  // folder_for_dir), so the shim CONTENT is still read from `shimFile` at the main checkout. But with the native adapter
  // shim living ONLY at the main checkout, a linked worktree has NO `.agent/` at all → native adapter anchors no layer →
  // the rewritten root hooks are never visited → ZERO hooks fire (bypass_hook_trust can't help: it only rescues
  // an untrusted HANDLER inside an already-discovered layer, it never creates one). So native adapter ALSO writes its
  // shim into the worktree's own `.agent/hooks.json` purely to anchor the layer (the rewrite ignores its
  // content, reading the root's — and a native adapter that DIDN'T rewrite would read this identical shim, so it is
  // correct either way). Claude: null — its shim already lives IN the worktree (`.claude/settings.json`) and
  // self-anchors; it has no root-checkout rewrite. Non-worktree (proj == main checkout): null — `shimFile`
  // already wrote `.agent/hooks.json` there.
  worktreeHookAnchor(proj: string): string | null
  // the contract file(s) the `surface: system` block is folded into. Claude: ./CLAUDE.md; native adapter: ONLY ./AGENTS.md.
  contractFiles(proj: string): string[]
  // the dir this harness auto-discovers skills from, or null if it has no skill primitive — the ONLY place skill-surface divergence lives.
  skillDir(proj: string): string | null
  // the dir this harness auto-discovers sub-agent definitions from, or null if it has no agent primitive — the
  // ONLY place agent-surface divergence lives (the skillDir analog). Claude reads .claude/agents/<name>.md;
  // native adapter has no file-discovered agent-definition primitive, so it returns null and materialize skips it.
  agentDir(proj: string): string | null
  // the shim payload: `content` is whatever artifact THIS harness auto-discovers to wire every event to the
  // dispatcher (harness id baked in) — a settings/hooks JSON for claude/native adapter, a generated event-bus PLUGIN
  // for opencode, a generated TypeScript EXTENSION for pi — plus the per-event command string (shared with
  // the trust writer so they hash identically).
  shim(dispatch: string, spex: string): { content: string; hooks?: Record<string, unknown[]>; cmd: (e: string) => string }
  // WHO OWNS shimFile. 'exclusive' — a spexcode-named source file (opencode's plugin, pi's extension) that is
  // wholly ours: whole-file write, whole-file delete. 'shared-json' — a config file the HOST AGENT shares with
  // the user (`.claude/settings.json`, `.agent/hooks.json`, `.zcode/settings.json` also carry their
  // permissions, env, statusLine and their OWN hooks), so we co-own only the identity-stamped hook entries
  // inside it: merged in by writeManagedJsonHooks, removed the same way, and the file itself deleted only
  // when nothing of the user's is left. A 'shared-json' adapter's shim() also returns the `hooks` payload the
  // merge writer needs; an 'exclusive' one returns only `content`.
  shimOwnership: 'exclusive' | 'shared-json'
  // make a dispatched/self-launched agent run the hooks with zero prompts. native adapter writes PROJECT trust — and, on
  // a binary without `--dangerously-bypass-hook-trust`, per-hook trusted_hash blocks — into the GLOBAL
  // ~/.agent/config.toml (native adapter's security model: trust is global-only). PROJECT trust is UNCONDITIONAL: it
  // ENABLES the project config layer so native adapter discovers our hooks at all, a tier bypass_hook_trust does NOT
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
  // channel check. claude: online iff the window is up AND its rendezvous socket has a live LISTENER
  // (`socketLive` — a connect that a live claude accepts and a stale socket FILE refuses; claude IGNORES the
  // pane probe). native adapter: online iff the window is up AND the launch-registered `agent.pid` is alive
  // (`pane.pidAlive`, the hot-tier kill-0 verdict — zero ps scan); a pre-registration session with no agent.pid
  // (`pidAlive` undefined) falls back to the LEGACY whole-box tree walk — a native adapter-ish process (`native adapter` by any
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
  // Native identity and the first durable turn are established asynchronously by this adapter. Session
  // lifecycle retains its authoritative launch payload until the adapter completes that proof.
  launchPayloadProof?: true
  // The exact native conversation target derivable from this record. Pinned-id adapters return the governed
  // session id; native-assigned adapters return only a captured id; adapters with no native conversation return
  // null. This is deliberately unrelated to OS leaf ownership and runtime liveness.
  exactNativeTargetId(rec: HarnessLivenessRecord & { harnessSessionId?: string | null }): string | null
  // Poke a live session and report whether this immediate channel accepted the attempt. Claude-family adapters
  // write one idempotent rendezvous reply; native adapter uses JSON-RPC on the same app-server WebSocket the
  // visible TUI uses — it reads the thread live and either `turn/steer`s the message INTO an in-progress turn
  // (mid-turn, not queued for after the agent stops) or `turn/start`s a fresh turn when the thread is idle.
  // `ok=false` leaves the message OWED on the session's delivery queue, for a later pass to hand over.
  deliver(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult>
  // Report what the adapter can prove about its native prompt transport BEFORE a new debt is accepted. An
  // inconclusive probe remains retryable; a proven-unreachable channel is joined with the session-owned pid
  // witness by sessions.ts, which is the only place allowed to call a live agent's transport stranded.
  deliveryTransport?(rec: HarnessDeliveryRecord): Promise<DeliveryTransportState>
  // Observe native turn failures that this harness does not expose as a lifecycle hook. The adapter owns the
  // transport subscription; sessions owns observer reconciliation and the active-only lifecycle CAS.
  observeTurnFailures?(rec: HarnessDeliveryRecord, onFailure: (failure: TurnFailure) => void): FailureSubscription
  // Hard-interrupt the current turn through the harness's native control plane. Optional: a headless harness
  // without a confirmed native interrupt refuses rather than emulating one with a signal; a pane-backed TUI
  // without one receives the operator's own interrupt key in its pane (sessions.ts interruptSession).
  interrupt?(rec: HarnessDeliveryRecord): Promise<DispatchResult>
  // Remove this harness's ephemeral runtime transport after stop/close. This is the runtime inverse of
  // launch: rendezvous owners unlink rvSock, claude-headless unlinks its control socket, native adapter owns no
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
  // The one pane state where this harness swallows an immediate poke: given live pane text, return the reason
  // to skip that courtesy attempt or null when the pane can take it. sendText consults this after append;
  // absent on harnesses whose poke ignores pane state. Claude's
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
  // native adapter removes its `~/.agent/config.toml` block; Claude is a no-op (it wrote none).
  removeTrust(proj: string): void

  // the relaunch tail reopen() hands launch() to bring the SAME work back up. claude resumes the same
  // conversation (`--resume <id>`, the id we pinned at launch). native adapter's own thread id is un-pinnable on the
  // launch flag, so the BACKEND owns it: it `thread/start`s the thread and stores the id at launch, so reopen
  // resumes the SAME conversation via native adapter's own `resume <thread-id>` subcommand (the stored harnessSessionId,
  // its rollout persisted on disk). An adapter may use the authoritative pending launch payload to recover a
  // pre-identity launch; absence remains a loud adapter decision rather than an implicit empty tail.
  resumeArg(rec: { session: string; harnessSessionId?: string | null }, pendingLaunchPayload?: string | null): string
}

// `ok` describes only this round's immediate adapter poke: the socket write, native controller request, or
// app-server turn request reached its channel. [[dispatch]] has already decided delivery at the timeline append,
// so an error means only that the reader will show the line at a later turn boundary. Defined here because this
// is the adapter result sessions.ts consumes for same-turn timing.
export type DispatchResult = { ok: boolean; error?: string }
export type HarnessDeliveryRecord = {
  session: string
  harness?: string
  stopped?: boolean
  archived?: boolean
  worktreePath?: string
  harnessSessionId?: string | null
  runtimeDir?: string
  launchCmd?: string | null
  // The message's timeline id ([[session-timeline]]). native adapter maps it to its native `clientUserMessageId`, while
  // other adapters may ignore it; product routing never needs to know which harness recognizes the marker.
  mid?: string
}
// the on-demand surface artifacts a materialize pass wrote, by node NAME — so clean() knows EXACTLY which
// skill subdirs / agent files are SpexCode's to remove (name-scoped, never a blind wipe of a dir the user may
// also populate). materialize passes the live skill/agent node names; clean reconstructs the same paths.
export type HarnessArtifacts = { skills: readonly string[]; agents: readonly string[] }

// @@@ rendezvous control socket - claude's DETERMINISTIC, ONLY input path for PROMPTS to sessions WE launch.
// sessions.ts starts `claude` with CLAUDE_BG_BACKEND=daemon + CLAUDE_BG_RENDEZVOUS_SOCK=<this path> set ONLY on
// that one spawned command (env prefix, never global). claude opens a unix socket here; writing one line
// `{"type":"reply","text":"…"}\n` injects + submits the text as a prompt — no PTY typing, so multi-line input
// and Enters can't be corrupted the way `tmux send-keys` was. It lives in SpexCode's own durable store, and
// its launch-time stamp still gives it no independent lifecycle. liveness CONNECTS to it (a live LISTENER, not
// merely the file — see rendezvousListening); deliver writes to it.
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

// @@@ scoped rendezvous path - a rendezvous endpoint IS this session's address, so it needs a durable home and
// a bounded name. `<SPEXCODE_HOME>/s/<16hex>/c` is both: the store is SpexCode-owned (normally ~/.spexcode),
// while one fixed digest of runtime scope + session identity gives every world/session its own short directory
// without carrying either raw value in the pathname. This is deliberately NOT the native adapter app-server rule: that
// endpoint routes project-shared threads; this one names a session-owned listener. Existing launches retain
// their stamped old path through rvSock(); only a new stamp uses this derivation.
const RENDEZVOUS_SUN_PATH_LIMIT = 104
export const scopedRvSock = (id: string, dir = runtimeRoot()) =>
  join(spexcodeHome(), 's', createHash('sha1').update(`${dir}\0${id}`).digest('hex').slice(0, 16), 'c')
export function assertRvSockPath(id: string, dir = runtimeRoot()): string {
  const path = scopedRvSock(id, dir)
  const bytes = Buffer.byteLength(path)
  if (bytes >= RENDEZVOUS_SUN_PATH_LIMIT) {
    throw new Error(`rendezvous socket path is ${bytes} bytes (must be < ${RENDEZVOUS_SUN_PATH_LIMIT}): ${path}; shorten SPEXCODE_HOME before creating this session`)
  }
  return path
}
const rvStamp = (id: string) => sessionArtifactPath(id, 'rv.path')
export const rvSock = (id: string): string => {
  try { return readFileSync(rvStamp(id), 'utf8').trim() || legacyRvSock(id) } catch { return legacyRvSock(id) }
}
// launch's half: derive this session's socket in ITS runtime and record it, so every later reader (launch env,
// liveness probe, delivery, teardown) reads the one path the agent actually bound.
export function stampRvSock(id: string, dir = runtimeRoot()): string {
  const path = assertRvSockPath(id, dir)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
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
export const rendezvousListening = (id: string, timeoutMs = 800): Promise<ListenerProbe> => listenerAt(rvSock(id), timeoutMs)
const rendezvousDeliveryTransportAt = async (path: string): Promise<DeliveryTransportState> => {
  const probe = await listenerAt(path)
  if (probe === 'live') return { kind: 'reachable' }
  if (probe === 'unproven') return { kind: 'unproven' }
  return { kind: 'unreachable', reason: 'its launch-time rendezvous listener is absent or refusing connections' }
}
const rendezvousDeliveryTransport = (rec: HarnessDeliveryRecord): Promise<DeliveryTransportState> =>
  rendezvousDeliveryTransportAt(rvSock(rec.session))
// the spex launcher (bin/spex.mjs), baked into the native adapter launch script (mirrors materialize.ts's SPEX) so
// the launch shell can call back into `spex agent-launch` to own the thread + fire the first turn before it
// exec's the visible TUI. The launcher, never a raw source entry: it runs the compiled CLI and keeps the
// source-workspace mid-merge guard (conflicted source -> one line + exit 75, not a stacktrace).
// The timeline is the message's copy, so rendezvous needs no receipt protocol. It writes one idempotent poke
// carrying the timeline mid and reports only whether that write reached the local transport.
type ClaudeForkTransport = { sock: string; auth: string }

// The backend need not share the agent's config root: an explicitly chosen launcher can point Claude at its
// own home. A moved source process remains alive by definition, so its one config-dir environment field is the
// live authority for locating the daemon roster. A stale/reused pid can at worst name a roster with no exact
// successor; it cannot select one without the moved/session-source checks below.
function claudeConfigRoots(sourceSessionId: string, runtimeDir?: string): string[] {
  const roots: string[] = []
  try {
    const pidFile = runtimeDir ? join(runtimeDir, 'sessions', sourceSessionId, 'agent.pid') : sessionArtifactPath(sourceSessionId, 'agent.pid')
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    if (Number.isInteger(pid) && pid > 0) {
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
      const config = env.find((entry) => entry.startsWith('CLAUDE_CONFIG_DIR='))?.slice('CLAUDE_CONFIG_DIR='.length)
      if (config) roots.push(config)
    }
  } catch { /* source not available or this platform does not expose procfs */ }
  if (process.env.CLAUDE_CONFIG_DIR) roots.push(process.env.CLAUDE_CONFIG_DIR)
  roots.push(join(homedir(), '.claude'))
  return [...new Set(roots)]
}

// A moved Claude conversation is a daemon-owned fork. Its launch-time socket still answers, but that process
// no longer returns to its prompt. A successor hook may have already recorded its exact Claude session id in
// `moved`; use that durable identity first, then retain the roster's source-transcript relation for deployments
// without the stamp. The roster remains the sole source of the live socket and current auth token. Keep this
// lookup Claude-local so other rendezvous adapters cannot adopt a coincidentally matching id.
function claudeForkTransport(sourceSessionId: string, runtimeDir?: string): ClaudeForkTransport | null {
  const moved = (() => {
    try {
      const stamp = runtimeDir ? join(runtimeDir, 'sessions', sourceSessionId, 'moved') : sessionArtifactPath(sourceSessionId, 'moved')
      return readFileSync(stamp, 'utf8').trim()
    } catch {
      return ''
    }
  })()
  for (const configDir of claudeConfigRoots(sourceSessionId, runtimeDir)) {
    try {
      const roster = JSON.parse(readFileSync(join(configDir, 'daemon', 'roster.json'), 'utf8')) as { workers?: Record<string, any> }
      const workers = Object.values(roster.workers ?? {})
      const usable = (worker: any) => typeof worker?.rendezvousSock === 'string' && typeof worker.rvAuth === 'string'
      const recorded = workers.filter((worker) => usable(worker) && moved && worker?.sessionId === moved)
      const candidates = recorded.length ? recorded : workers.filter((worker) => {
        const launch = worker?.dispatch?.launch
        if (launch?.mode !== 'resume' || launch.fork !== true || typeof launch.sessionId !== 'string') return false
        const source = basename(launch.sessionId).replace(/\.jsonl$/, '')
        return source === sourceSessionId && usable(worker)
      })
      const worker = candidates.sort((a, b) => Number(b.startedAt ?? 0) - Number(a.startedAt ?? 0))[0]
      if (worker) return { sock: worker.rendezvousSock, auth: worker.rvAuth }
    } catch { /* this Claude config has no readable daemon roster */ }
  }
  return null
}

async function claudeDeliveryTransport(rec: HarnessDeliveryRecord): Promise<DeliveryTransportState> {
  const fork = claudeForkTransport(rec.session, rec.runtimeDir)
  if (!fork) return rendezvousDeliveryTransport(rec)
  const forkState = await rendezvousDeliveryTransportAt(fork.sock)
  if (forkState.kind !== 'unreachable' || fork.sock === rvSock(rec.session)) return forkState
  // A stale roster row must not strand a source worker whose stamped launch transport is still reachable.
  return rendezvousDeliveryTransport(rec)
}

const unprovenDeliveryTransport = async (): Promise<DeliveryTransportState> => ({ kind: 'unproven' })

type ReplyOutcome = DispatchResult & { kicked?: boolean }

// Claude's rendezvous daemon owns one connection at a time. A liveness probe can therefore destroy a
// delivery connection after its write has reached the kernel but before the daemon parses the line. Send the
// reply and an in-order repaint probe in one chunk: repaint-done proves the reply line was parsed first; a
// close/reset before that proves the whole chunk was discarded and is safe to retry. An open connection that
// outlives the wall is treated as busy, not lost, preserving the no-false-failure behavior for active turns.
function replyViaSocket(sock: string, text: string, mid?: string, auth?: string, wallMs = 10_000): Promise<ReplyOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let c: ReturnType<typeof createConnection>
    let wall: NodeJS.Timeout
    const done = (r: ReplyOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(wall)
      if (r.ok) {
        // A confirmed repaint has already crossed the parser. On a busy timeout, finish the stream cleanly so
        // the daemon can consume the buffered pair before its FIN; never destroy an unparsed write.
        try { c?.end() } catch { /* */ }
      } else {
        try { c?.destroy() } catch { /* */ }
      }
      resolve(r)
    }
    wall = setTimeout(() => done({ ok: true }), wallMs)
    try {
      c = createConnection({ path: sock })
    } catch (e) {
      done({ ok: false, error: `rendezvous socket connect threw: ${String(e)}` })
      return
    }
    c.on('error', (e: NodeJS.ErrnoException) => {
      const code = e?.code || String(e)
      done({ ok: false, kicked: code === 'ECONNRESET' || code === 'EPIPE', error: `rendezvous socket error: ${code} — prompt NOT delivered` })
    })
    c.on('close', () => done({ ok: false, kicked: true, error: 'rendezvous connection closed before the daemon parsed the prompt (kicked by a concurrent connect)' }))
    c.on('connect', () => c.write(
      `${auth ? JSON.stringify({ role: 'controller', auth }) + '\n' : ''}${JSON.stringify({ type: 'reply', text, ...(mid ? { mid } : {}) })}\n${JSON.stringify({ type: 'repaint' })}\n`,
    ))
    let buf = ''
    c.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let nl: number
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
const POKE_ATTEMPTS = 2
async function pokeRendezvous(sock: string, text: string, mid?: string, auth?: string, wallMs?: number): Promise<DispatchResult> {
  let last: ReplyOutcome = { ok: false, error: 'not attempted' }
  for (let attempt = 0; attempt < POKE_ATTEMPTS; attempt++) {
    last = await replyViaSocket(sock, text, mid, auth, wallMs)
    if (last.ok) return last
    if (!last.kicked) break
    await new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 140))
  }
  return { ok: false, error: `rendezvous poke failed after ${POKE_ATTEMPTS} attempts: ${last.error ?? 'unknown error'}` }
}

export async function deliverViaRendezvous(id: string, text: string, mid?: string, wallMs?: number): Promise<DispatchResult> {
  return pokeRendezvous(rvSock(id), text, mid, undefined, wallMs)
}

export async function deliverViaClaudeRendezvous(id: string, text: string, mid?: string, runtimeDir?: string): Promise<DispatchResult> {
  const fork = claudeForkTransport(id, runtimeDir)
  const sourceSock = rvSock(id)
  if (!fork) return pokeRendezvous(sourceSock, text, mid)

  const forkResult = await pokeRendezvous(fork.sock, text, mid, fork.auth)
  if (forkResult.ok || fork.sock === sourceSock) return forkResult

  const sourceResult = await pokeRendezvous(sourceSock, text, mid)
  if (sourceResult.ok) return sourceResult
  return { ok: false, error: `fork rendezvous failed: ${forkResult.error}; source fallback failed: ${sourceResult.error}` }
}

export async function deliverViaSocketOrWake(
  id: string,
  text: string,
  mid: string | undefined,
  coldWake: () => Promise<DispatchResult>,
  unprovenError: string,
): Promise<DispatchResult> {
  const probe = await rendezvousListening(id)
  if (probe === 'live') return deliverViaRendezvous(id, text, mid)
  if (probe === 'unproven') return { ok: false, error: unprovenError }
  return coldWake()
}

const RENDEZVOUS_INTERRUPT_WALL_MS = 10_000
const RENDEZVOUS_INTERRUPT_SETTLE_MS = 15_000
// @@@ interruptViaRendezvous - one `interrupt` line to the session's LIVE rendezvous listener, confirmed by the
// shim's own answer ([[shim-runtime]] runs the host's native abort — pi's ctx.abort(), opencode's
// session.abort — and writes interrupt-done / interrupt-rejected). Unlike a reply poke, whose durable copy is
// the timeline, an interrupt has nothing to fall back on: silence is a loud failure, never an optimistic ok.
// A generative shim serves its socket only while a turn process is alive, so a dead listener means no turn
// is running — nothing to interrupt — and an unproven probe sends nothing. `settle` additionally waits for
// that listener to go dead: for a one-turn-per-process adapter the abort ends the process, and confirming
// only then means a delivery that follows the interrupt wakes cold instead of poking an exiting agent.
export async function interruptViaRendezvous(id: string, harness: string, opts: { settle?: boolean } = {}): Promise<DispatchResult> {
  const probe = await rendezvousListening(id)
  if (probe === 'dead') return { ok: false, error: `no ${harness} turn is running for session ${id} - nothing to interrupt` }
  if (probe === 'unproven') return { ok: false, error: `${harness} rendezvous listener for session ${id} is unproven - interrupt NOT sent` }
  const answered = await sendRendezvousInterrupt(id, harness)
  if (!answered.ok || !opts.settle) return answered
  const deadline = Date.now() + RENDEZVOUS_INTERRUPT_SETTLE_MS
  for (;;) {
    const state = await rendezvousListening(id)
    if (state === 'dead') return { ok: true }
    if (Date.now() >= deadline) return { ok: false, error: `${harness} confirmed the interrupt but its turn process for session ${id} is still ${state === 'live' ? 'serving' : 'unproven'} after ${RENDEZVOUS_INTERRUPT_SETTLE_MS}ms` }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

function sendRendezvousInterrupt(id: string, harness: string): Promise<DispatchResult> {
  return new Promise((resolve) => {
    let settled = false
    let c: ReturnType<typeof createConnection> | undefined
    const done = (r: DispatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(wall)
      try { c?.destroy() } catch { /* */ }
      resolve(r)
    }
    const wall = setTimeout(() => done({ ok: false, error: `${harness} did not confirm the interrupt for session ${id} within ${RENDEZVOUS_INTERRUPT_WALL_MS}ms (a shim materialized before interrupt support never answers - rerun spex materialize)` }), RENDEZVOUS_INTERRUPT_WALL_MS)
    try { c = createConnection({ path: rvSock(id) }) } catch (e) { done({ ok: false, error: `rendezvous socket connect threw: ${String(e)} - interrupt NOT sent` }); return }
    c.on('error', (e: NodeJS.ErrnoException) => done({ ok: false, error: `rendezvous socket error: ${e?.code || String(e)} - interrupt NOT confirmed` }))
    c.on('close', () => done({ ok: false, error: `rendezvous connection closed before ${harness} answered the interrupt` }))
    c.on('connect', () => c!.write(`${JSON.stringify({ type: 'interrupt' })}\n`))
    let buf = ''
    c.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let msg: { type?: string; error?: string } = {}
        try { msg = JSON.parse(line) as { type?: string; error?: string } } catch { continue }
        if (msg.type === 'interrupt-done') return done({ ok: true })
        if (msg.type === 'interrupt-rejected') return done({ ok: false, error: `${harness} rejected the interrupt: ${msg.error || 'no reason given'}` })
      }
    })
  })
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

// idempotent replace is implemented in harness-shim.ts.
// shared shim helpers live in harness-shim.ts.
// shared process helpers live in harness-shim.ts.
// process snapshot helper lives in harness-shim.ts.

// ---------------------------------------------------------------------------------------------------------
// the two implementations.

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification'] as const
// the five claude-shaped events pi's generated extension SYNTHESIZES from its own lifecycle (session_start →
// SessionStart, input → UserPromptSubmit, tool_call → PreToolUse, tool_result → PostToolUse, agent_end +
// agent_settled → Stop). pi has no idle/attention or failed-stop event → no Notification/StopFailure, same
// real gap as native adapter.
const PI_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const
// z-code reads Claude-compatible hooks but has neither the idle Notification nor StopFailure lifecycle event.
// This is a real harness difference, not a TODO: the existing Claude-only idle state is unavailable.
const ZCODE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

// the resolved base launcher command per harness (the wrapper that sets the config-dir env), shared by
// launchCmd and baseCmd so the two never diverge: the launcher's pinned `cmd` wins. The plain command is only
// the fallback for a truly-old record with NO pinned cmd and NO launcher name — compatibility must preserve
// the harness's normal permission model, never silently introduce an automatic-permission flag. There is no
// env/config-field resolution because launchers are ordinary named config entries ([[launcher-select]]).
const claudeBaseCmd = (cmd?: string) => cmd || 'claude'
const piBaseCmd = (cmd?: string) => cmd || 'pi'   // pi runs tools without permission prompts — no yolo flag exists or is needed
const opencodeBaseCmd = (cmd?: string) => cmd || 'opencode'
const zcodeBaseCmd = (cmd?: string) => cmd || 'zcode'

// @@@ opencodeLaunchCommand - the tail-branching launch script (the native adapter marker pattern, minus any server:
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

const panePidLiveness: Harness['liveness'] = (_rec, tmuxAlive, _runtimeDir, pane) =>
  (tmuxAlive && pane?.pidAlive === true ? 'online' : 'offline')

// Leaf-backed headless sessions are the controller process, not the tmux pane that hosts it. The pane can
// survive a SIGKILL as a bare shell, so tmux presence without the launch-registered PID is never online.
const sessionHomeLiveness: Harness['liveness'] = (_rec, tmuxAlive, _runtimeDir, pane) =>
  (tmuxAlive && pane?.pidAlive === true ? 'online' : 'offline')

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

export const claudeHarness: Harness = {
  id: 'claude',
  dispatchId: 'claude',
  headless: false,
  events: CLAUDE_EVENTS,
  ownsRendezvous: true,                              // claude's background daemon opens the rendezvous control socket (prompt delivery + liveness)
  paneTitleIsSelfSummary: true,                      // claude writes its live task summary into the OSC pane title → headline derives from it
  transcript: claudeTranscript,
  transcriptAt: (configDir) => claudeTranscriptReader(join(configDir, 'projects')),   // claude's threads live at <configDir>/projects/<project>/<id>.jsonl
  launchCmd: (_id, _rt, cmd) => claudeBaseCmd(cmd),  // claude's full invocation IS its base command (the tail is appended by the caller)
  baseCmd: claudeBaseCmd,
  oneShotTurn: (prompt, cmd) => ({ command: `${claudeBaseCmd(cmd)} -p`, stdin: prompt }),   // --print reads the prompt from stdin
  sessionIdArg: (id) => `--session-id ${id}`,        // the caller chooses the id
  sessionEnvVar: harnessIdentity('claude').sessionEnvVar,
  launchEnv: rendezvousLaunchEnv,
  shimFile: (proj) => join(proj, '.claude', 'settings.json'),
  shimScope: 'tree',
  shimOwnership: 'shared-json',
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
  exactNativeTargetId: (rec) => rec.session,
  deliveryTransport: claudeDeliveryTransport,
  deliver: (rec, text) => deliverViaClaudeRendezvous(rec.session, text, rec.mid, rec.runtimeDir),
  cleanupRuntime: (rec) => unlinkSocks(rvSock(rec.session)),
  coldRuntime: async () => ({ ok: true }),
  // The TUI's sessions panel ("← for agents") swallows an injected reply into PANEL context and never drains it
  // (verified live: `queue-operation: enqueue` with no dequeue, no turn, daemon silent), so skip this courtesy
  // poke and leave the timeline reader to show the message. Matched on the panel's own
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
  sessionEnvVar: harnessIdentity('claude-headless').sessionEnvVar,
  headless: true,
  runtimeOwnership: 'leaf',
  ownsRendezvous: false,
  paneTitleIsSelfSummary: false,
  launchCmd: (id, runtimeDir, cmd) => claudeHeadlessLaunchCommand(id, runtimeDir ?? runtimeRoot(), claudeBaseCmd(cmd)),
  launchEnv: noLaunchEnv,
  // The controller's registered PID is the liveness witness; the tmux home is only the address boundary.
  liveness: sessionHomeLiveness,
  deliveryTransport: unprovenDeliveryTransport,
  deliver: deliverViaClaudeHeadless,
  interrupt: interruptClaudeHeadless,
  cleanupRuntime: (rec) => unlinkSocks(claudeHeadlessSock(rec.session)),
  coldRuntime: async (rec) => {
    const result = await claudeHeadlessColdRuntime(rec)
    return result.ok ? { ok: true } : { ok: false, reason: result.error || 'claude-headless runtime remains unproven' }
  },
  deliveryBlockedBy: undefined,
}

// @@@ piHarness - the pi adapter (@earendil-works/pi-coding-agent). pi is the CLOSEST to claude of the four:
// the caller pins the session id at launch (`--session-id <id>`, creating the session if missing), the shim
// lives IN the worktree, and the rendezvous prompt/liveness channel is REUSED wholesale — pi has no external
// hook binding (its lifecycle surface is the in-process extension API), so the shim is a GENERATED TypeScript
// extension (.pi/extensions/spexcode.ts, run natively by pi) that forwards five claude-shaped events to
// dispatch.sh AND binds this session's rendezvous socket itself (the adapter's launchEnv exports
// CLAUDE_BG_RENDEZVOUS_SOCK) speaking claude's rendezvous line protocol — so
// deliverViaRendezvous and the socket-listener liveness work through the same adapter seam. Trust: pi gates project-local
// extensions behind saved per-directory trust (~/.pi/agent/trust.json), so writeTrust stamps the main
// checkout there (the nearest-parent lookup covers nested worktrees) and the launch carries `--approve` as
// one-run defence. See pi-harness.ts for the extension source + trust mechanics.
export const piHarness: Harness = {
  id: 'pi',
  dispatchId: 'pi',
  headless: false,
  events: PI_EVENTS,
  ownsRendezvous: true,                              // the generated extension binds rvSock(id) and speaks claude's rendezvous protocol
  paneTitleIsSelfSummary: false,                     // pi's pane title is not an agent-written task summary → headline uses the prompt preview
  transcript: piTranscript,
  launchCmd: (_id, _rt, cmd) => `${piBaseCmd(cmd)} --approve`,   // --approve = one-run project trust (belt to writeTrust's braces)
  baseCmd: piBaseCmd,
  sessionIdArg: (id) => `--session-id ${id}`,        // caller pins the exact session id, claude-style (created if missing)
  sessionEnvVar: harnessIdentity('pi').sessionEnvVar, // exported by the generated extension at session_start; tool subprocesses inherit it
  launchEnv: rendezvousLaunchEnv,
  shimFile: (proj) => join(proj, '.pi', 'extensions', 'spexcode.ts'),
  shimScope: 'tree',
  shimOwnership: 'exclusive',
  worktreeHookAnchor: () => null,                    // the extension lives in the worktree and self-anchors, like claude
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],   // pi auto-loads AGENTS.md context files (shared with native adapter — writeManagedBlock is idempotent)
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
  exactNativeTargetId: (rec) => rec.session,
  deliveryTransport: rendezvousDeliveryTransport,
  deliver: (rec, text) => deliverViaRendezvous(rec.session, text, rec.mid),
  cleanupRuntime: (rec) => unlinkSocks(rvSock(rec.session)),
  coldRuntime: async () => ({ ok: true }),
  // reopen the SAME conversation: `--session <id>` resumes the exact session we pinned at launch and FAILS
  // LOUD when its file is gone (unlike `--session-id`, which would silently mint a fresh empty session).
  resumeArg: (rec) => `--session ${rec.session}`,
}

// pi-headless is an independent harness: its materialization surface is literally pi's, while a resident
// controller owns non-interactive text-mode turns. Active turns steer through pi's rendezvous extension;
// idle delivery cold-wakes the exact saved session with `--session` (never `--session-id`, which would create a
// new conversation). The exact tmux home is its public addressability and physical-cold boundary.
export const piHeadlessHarness: Harness = {
  ...piHarness,
  id: 'pi-headless',
  sessionEnvVar: harnessIdentity('pi-headless').sessionEnvVar,
  headless: true,
  deliveryTransport: unprovenDeliveryTransport,
  // The controller is a per-session process launched in the target tmux pane. Its launch-registered PID
  // and argv session id are exact leaf ownership evidence.
  runtimeOwnership: 'leaf',
  paneTitleIsSelfSummary: false,
  launchCmd: (id, runtimeDir, cmd) => piHeadlessLaunchCommand(id, runtimeDir ?? runtimeRoot(), piBaseCmd(cmd)),
  // The controller's registered PID is the liveness witness; the tmux home is only the address boundary.
  liveness: sessionHomeLiveness,
  deliver: deliverViaPiHeadless,
  // the controller aborts its own turn child natively and confirms only once that child is gone
  interrupt: interruptPiHeadless,
  cleanupRuntime: (rec) => unlinkSocks(piHeadlessSock(rec.session), rvSock(rec.session)),
  coldRuntime: async (rec) => {
    const result = await piHeadlessColdRuntime(rec)
    return result.ok ? { ok: true } : { ok: false, reason: result.error || 'pi-headless runtime remains unproven' }
  },
  deliveryBlockedBy: undefined,
  resumeArg: (rec) => `--session ${rec.session}`,
}

const ZCODE_CONTROL_UNAVAILABLE = 'zcode has no control channel; start a new session instead of delivering to an existing one'

// z-code's app-server is stdin/stdout NDJSON, unlike native adapter's Unix-socket WebSocket + thread RPC. This row
// intentionally covers the one-turn `--prompt` launcher and Claude-compatible hooks only; control operations
// refuse rather than pretending the incompatible protocol accepted them.
export const zcodeHarness: Harness = {
  id: 'zcode',
  dispatchId: 'zcode',
  headless: true,
  launchOneShot: true,
  events: ZCODE_EVENTS,
  ownsRendezvous: false,
  paneTitleIsSelfSummary: false,
  transcript: unsupportedTranscript('zcode'),
  launchCmd: (_id, _rt, cmd) => `${zcodeBaseCmd(cmd)} --prompt`,
  baseCmd: zcodeBaseCmd,
  // z-code's one-turn launcher already IS the non-interactive shape; it takes the prompt as an argument.
  oneShotTurn: (prompt, cmd) => ({ command: `${zcodeBaseCmd(cmd)} --prompt ${shQuote(prompt)}`, stdin: '' }),

  sessionIdArg: () => '',
  sessionEnvVar: harnessIdentity('zcode').sessionEnvVar,
  launchEnv: noLaunchEnv,
  shimFile: (proj) => join(proj, '.zcode', 'settings.json'),
  shimScope: 'tree',
  shimOwnership: 'shared-json',
  worktreeHookAnchor: () => null,
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],
  skillDir: (proj) => join(proj, '.zcode', 'skills'),
  agentDir: (proj) => join(proj, '.zcode', 'agents'),
  shim: (dispatch, spex) => buildShim('zcode', ZCODE_EVENTS, dispatch, spex),
  writeTrust: () => [],
  removeTrust: () => { /* z-code wrote no trust artifact */ },
  clean(proj, arts, preserveProject) { cleanHarness(this, proj, arts, preserveProject) },
  slashCommands: () => [],
  liveness: panePidLiveness,
  exactNativeTargetId: () => null,
  deliver: async () => { throw new Error(ZCODE_CONTROL_UNAVAILABLE) },
  cleanupRuntime: async () => { /* one-shot z-code owns no SpexCode transport to remove */ },
  coldRuntime: async () => ({ ok: true }),
  resumeArg: () => { throw new Error(ZCODE_CONTROL_UNAVAILABLE) },
}

export const opencodeHarness: Harness = {
  id: 'opencode',
  dispatchId: 'opencode',
  headless: false,
  events: OPENCODE_EVENTS,
  // LITERALLY true: the generated plugin ([[opencode-harness]], opencode.ts) BINDS the per-session rendezvous
  // socket the launch env hands it, so the shared reply poke and socket-listener liveness are reused verbatim.
  ownsRendezvous: true,
  paneTitleIsSelfSummary: false,                     // opencode's TUI title is not the agent's live task self-summary → headline uses the prompt
  transcript: opencodeTranscript,
  launchCmd: (_id, _rt, cmd) => opencodeLaunchCommand(opencodeBaseCmd(cmd)),   // the tail-branching script (prompt vs --resume/--continue marker)
  baseCmd: opencodeBaseCmd,
  // `opencode run` takes the message positionally; it documents no stdin form, so the prompt is an argument.
  oneShotTurn: (prompt, cmd) => ({ command: `${opencodeBaseCmd(cmd)} run ${shQuote(prompt)}`, stdin: '' }),

  sessionIdArg: () => '',                            // opencode mints its own session id; the plugin's first event reports it back (opencode-capture)
  // opencode exports NO per-session env var to its tool subprocesses (probed, 1.18.3). Identity flows through
  // the launch-injected SPEXCODE_SESSION_ID — honest here because each opencode TUI is a per-session process
  // (no native adapter-style shared-server contamination). This var is therefore never set; envSessionId's
  // SPEXCODE_SESSION_ID tier resolves the record.
  sessionEnvVar: harnessIdentity('opencode').sessionEnvVar,
  launchEnv: rendezvousLaunchEnv,
  // the "shim" is a generated opencode PLUGIN in the worktree's own tree — opencode auto-loads project plugins
  // by walking the cwd, so like claude it self-anchors and needs no root-checkout rewrite or worktree anchor.
  shimFile: (proj) => join(proj, '.opencode', 'plugins', 'spexcode.ts'),
  shimScope: 'tree',
  shimOwnership: 'exclusive',
  worktreeHookAnchor: () => null,
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],   // opencode reads AGENTS.md natively (same file native adapter owns; the managed block is idempotent across writers)
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
  exactNativeTargetId: (rec) => rec.harnessSessionId || null,
  deliveryTransport: rendezvousDeliveryTransport,
  deliver: (rec, text) => deliverViaRendezvous(rec.session, text, rec.mid),
  cleanupRuntime: (rec) => unlinkSocks(rvSock(rec.session)),
  coldRuntime: async () => ({ ok: true }),
  // owned opencode session id → `--resume <id>` marker (the launch script re-attaches `--session <id>`, the
  // SAME conversation); never captured → `--continue` marker (opencode's own "last session in this directory",
  // which in a dedicated worktree is this worker's). The discriminator is sound for the same reason native adapter's
  // is: a NEW launch's tail is always ONE single-quoted prompt arg, never a literal marker.
  resumeArg: (rec) => (rec.harnessSessionId ? `--resume ${rec.harnessSessionId}` : '--continue'),
}

// OpenCode headless is a separate harness, not an opencode mode. Its materialize half is exactly
// opencodeHarness; only the one-turn runtime and its capability row differ.
export const opencodeHeadlessHarness: Harness = {
  ...opencodeHarness,
  id: 'opencode-headless',
  sessionEnvVar: harnessIdentity('opencode-headless').sessionEnvVar,
  headless: true,
  runtimeOwnership: 'leaf',
  deliveryTransport: unprovenDeliveryTransport,
  launchCmd: (_id, _runtimeDir, cmd) => opencodeHeadlessLaunchCommand(opencodeBaseCmd(cmd)),
  // The controller's registered PID is the liveness witness; the tmux home is only the address boundary.
  liveness: sessionHomeLiveness,
  coldRuntime: async (rec) => {
    const result = await opencodeHeadlessColdRuntime(rec)
    return result.ok ? { ok: true } : { ok: false, reason: result.error || 'opencode-headless runtime remains unproven' }
  },
  deliver: async (rec, text) => {
    return deliverViaSocketOrWake(
      rec.session,
      text,
      rec.mid,
      () => spawnOpenCodeHeadlessTurn(rec, text, opencodeBaseCmd(rec.launchCmd ?? undefined), rvSock(rec.session)),
      `opencode-headless rendezvous probe was inconclusive for session ${rec.session} - refusing to start a possibly duplicate turn`,
    )
  },
  // `opencode run` serves the rendezvous socket only for the turn it runs, so the plugin's session abort IS the
  // interrupt, and the listener going dead is the turn's exit — confirmed only then, so the next delivery wakes cold
  interrupt: (rec) => interruptViaRendezvous(rec.session, 'opencode-headless', { settle: true }),
}

// every adapter — materialize iterates this to write each harness's artifacts in one pass.
export const HARNESSES: readonly Harness[] = [claudeHarness, codexHarness, opencodeHarness, piHarness, zcodeHarness, claudeHeadlessHarness, opencodeHeadlessHarness, piHeadlessHarness, codexHeadlessHarness]

// the legacy/default adapter for old records and config defaults. New launches derive harness from a launcher.
export const defaultHarness: Harness = claudeHarness

// the registry lookup as DATA. A sweep over records nobody is currently asking about (a removed plugin, a
// renamed id) must report an unresolvable harness rather than abort, so it resolves through this.
export function harnessByIdOrNull(id: string): Harness | null {
  return HARNESSES.find((x) => x.id === id) ?? null
}

// resolve an adapter by id (the detector). Throws on an unknown id — fail loud, never silently default.
export function harnessById(id: string): Harness {
  const h = harnessByIdOrNull(id)
  if (!h) throw new Error(`unknown harness '${id}' (known: ${HARNESSES.map((x) => x.id).join(', ')})`)
  return h
}

// --- named launcher profiles ([[launcher-select]]) ----------------------------------------------------------
// a launcher = a `{ harness, cmd }` entry in spexcode.json's `sessions.launchers`, keyed by a
// human-chosen name. `claude` and `native adapter` are NOT special built-ins — `spex init` SEEDS them as ordinary named
// launchers (with the regular command path), so they are edited like any other. harness defaults to claude.
// resolveLauncher throws fail-loud on an unknown name (a session must never silently launch under the wrong
// auth) and validates the harness id. There is NO env-derived built-in fallback: this registry lists exactly
// the config's real launchers, and the dashboard picker offers that same complete list.
export type Launcher = { name: string; harness: string; cmd: string; headless: boolean; configDir: string | null }
export type LauncherDefault = { default: string | null; error: string | null }

// the complete configured named launchers from spexcode.json, as a stable name-sorted list (for CLI/session
// resolution and downstream projections). Picking a launcher is the ONLY launch choice; the old separate
// harness pick is gone.
export function launcherList(root = mainCheckout()): Launcher[] {
  const m = readConfig(root).sessions?.launchers || {}
  return Object.keys(m)
    .map((name) => {
      const harness = harnessById(m[name].harness || defaultHarness.id)
      return { name, harness: harness.id, cmd: m[name].cmd, headless: harness.headless, configDir: m[name].configDir || null }
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
  const harness = harnessById(l.harness || defaultHarness.id)   // validate the harness id fail-loud
  return { name, harness: harness.id, cmd: l.cmd, headless: harness.headless, configDir: l.configDir || null }
}
