---
title: harness-adapter
status: active
hue: 280
desc: One seam between SpexCode and the coding-agent harness (Claude Code, Codex, …). Every harness-specific fact lives behind a single Adapter interface with one impl per harness; product code never branches on which harness it is.
code:
  - spec-cli/src/harness.ts
related:
  - packages/spec-core/src/harness-identity.ts
  - spec-cli/src/harness-identity.test.ts
  - spec-cli/src/headless-controller.ts
  - spec-cli/src/execution-trace.ts
  - spec-cli/src/session-execution.ts
  - spec-cli/src/sh.ts
  - spec-cli/src/slash-commands.ts
  - spec-cli/src/materialize.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/session-declarations.ts
  - spec-cli/src/transcript-reader.ts
  - spec-cli/src/harness.test.ts
  - spec-cli/hooks/harness.sh
  - spec-cli/templates/hooks/prepare-commit-msg
  - spec-cli/src/session-stamp.test.ts
  - spec-eval/scenarios/harness-delivery-campaign.mjs
---

# harness-adapter

## raw source

SpexCode integrates with whatever coding-agent harness the user runs — today Claude Code, Claude headless, Codex, Codex headless,
OpenCode, pi ([[pi-harness]]), pi headless ([[pi-headless]]), and z-code ([[zcode-harness]]), tomorrow others. Their differences are real and many. The rule (the project's own platform-boundary
principle): **platform differences live at an adapter boundary; product semantics never know which harness
is in play.** So there is ONE `Harness` interface, ONE implementation per harness, and an `if (codex)` /
`if (claude)` branch ANYWHERE in product code (materialize, dispatch, sessions, board, slash) is forbidden —
that branching belongs to the harness detector and the adapter only.

A harness can be asked for two different shapes of run, and the adapter owns both spellings. `launchCmd` is
the **resident** one — a TUI in a pane or a controller holding a socket, whose prompt tail the launch script
appends and whose exit means something went wrong. `oneShotTurn` is the **bounded** one: a command that reads
a single prompt, works, and exits, where the exit is the turn finishing normally. [[flat]]'s conversion rounds
are the caller that needs the second shape, and they wait on it. Adapters carry the prompt whichever way their
own CLI takes it — on stdin where the harness reads stdin, so a multi-KB prompt is never shell-quoted, as an
argument where it does not — and the caller writes the returned stdin and runs the returned command without
learning which harness answered. A harness with no non-interactive mode declares none, and callers refuse that
launcher by name; substituting a different harness would run the work under credentials and a model the user
did not choose.

## acceptance

An adapter is accepted by LIVE BEHAVIOR, never by artifact inspection: pi's stop-gate bridge shipped with every
mechanical proof green while a real session silently dropped every stop-gate rejection and hung `active` forever.
A new or reworked adapter with a resident or controller-backed runtime merges only with per-behavior eval readings,
each measured through a REAL dispatched session of that harness. The eight lifecycle behaviors, the replacement rows
for adapters whose runtime shape removes a premise, and the prompt-delivery combination campaign are
[[live-matrix]]'s contract; each harness node's `eval.md` declares its scenarios and this node files the aggregate.

## expanded spec

The harness is resolved ONCE into the matching adapter; everything downstream calls the adapter. DETECTION is
not payload-sniffing: each adapter OWNS its shim, and the shim bakes the harness id as the dispatcher's first
argument (`dispatch.sh <id> <Event>`), so `dispatch.sh` exports `SPEXCODE_HARNESS` and a hook subprocess learns
its harness from the shim that wired it — deterministically, never by guessing the payload shape. There is a
third baked id beyond the native two: `plugin`, written by the [[plugin-harness]] bundle's `hooks.json`. It has
no `Harness` adapter of its own (it is a DELIVERY form, not a runtime) — `dispatch.sh` accepts it and `harness.sh`
routes it through the **claude family** (a plugin host like adopter-a/Claude shares Claude's payload shape) via the
default case, so the shell side needs no separate `plugin)` arm. On the TS side the harness is derived from the
selected launcher or the materialized tree's explicit harness set. Product code loops adapters and their
placement facts; it never branches on a harness id. The Adapter owns exactly these divergence points — its whole
surface:

- **slashCommands()** — the `/` menu, computed the way THAT harness computes its own (Claude: a captured
  built-in set + `.claude/commands/**` + skills; Codex: its built-ins + `~/.codex/prompts/**` + plugin
  commands). Decoupled from execution — see `slash-commands.ts` (today Claude-only; becomes the Claude impl).
- **executionTrace(thread, currentTurn)** — the one read-only transcript seam. The four base adapters locate
  and incrementally parse their current native thread behind this shared selector, returning only the last
  displayable assistant working prose plus the small typed tool-step projection after it. It never returns raw
  envelopes, arguments, outputs, reasoning, or another message history. The selector comes fresh from the
  durable human timeline and a reader uses it only to compare native user boundaries; it never stores one. Session
  and HTTP code consume only that normalized result and never branch on a harness id. The transcript is an
  ephemeral adapter observation, never a second SpexCode session record: [[message-stream]] owns the one
  conversation entry and its REST/SSE transport.
- **readTranscript(thread, range)** — the durable payload seam ([[transcript-reader]]). Claude and Codex resolve
  their native files and return bounded, interval-filtered turns with tool output; adapters without a reliable
  native transcript return an explicit unsupported error. This reader is independent of runtime liveness and never
  writes the session record or timeline.
- **events / shim** — which lifecycle events to bind, and the per-harness hook shim that points each at the
  dispatcher (`.claude/settings.json` vs `.codex/hooks.json` vs pi's generated `.pi/extensions/spexcode.ts` —
  the shim's `content` is whatever FILE that harness discovers, not necessarily a hooks JSON; pi has no
  external hook binding at all, so its shim is an extension synthesizing claude-shaped payloads —
  [[pi-harness]]). Every GENERATIVE shim (pi's extension, opencode's plugin) composes the ONE shared
  shim runtime ([[shim-runtime]], embedded verbatim): the generator declares only its event-name mapping
  and host API bindings, while the payload synthesis, the single block-verdict contract (exit 2 + stdout
  decision:block JSON), and the multi-connection rendezvous server live in that one source — never
  rewritten per harness. Where a harness discovers its shim, and what a linked worktree needs for the shim to be seen at all, is that
  adapter's own fact — Codex's root-checkout discovery, its layer anchor, and its native turn-failure observer are
  [[codex-runtime]]'s.
- **contract file(s)** — where the `surface: system` block is materialized ([[harness-delivery]]): Claude
  `./CLAUDE.md` or `./.claude/CLAUDE.md`; Codex ONLY the repo-root `./AGENTS.md`.
- **artifact dirs** — the auto-discovered dirs the on-demand surfaces materialize into, or null when the harness
  lacks that primitive: `skillDir` for `surface: skill` (`SKILL.md`s — claude `.claude/skills/`, codex
  `.codex/skills/`) and `agentDir` for `surface: agent` (sub-agent `<name>.md`s — claude `.claude/agents/`;
  Codex has no file-discovered agent-definition primitive → null, so materialize skips it). Each is ONE
  adapter line; a null dir is the whole "this harness can't" branch, never an `if (codex)` in materialize.
- **trust** — make an agent run our hooks with zero prompts. This is codex's HARDEST divergence, because
  `--dangerously-bypass-hook-trust` covers only ONE of THREE independent codex tiers a dispatched worker must
  satisfy — the other two the adapter establishes explicitly (bypass alone leaves a fresh-init codex worker
  firing ZERO hooks, runtime.json frozen, no Session trailer):
  Codex's three independent tiers — layer BUILT, layer ENABLED, hooks REVIEWED — and the duplicate-safe trust
  writer that satisfies them are [[codex-runtime]]'s contract. A trust writer returns the path it asserted (or no
  paths for a harness whose trust mechanism writes nothing), making the materialization receipt and user-facing
  init report derive from the adapter's real side effect instead of a parallel capability claim. Claude relies on
  folder-trust (often nothing).
- **shimOwnership** — WHO owns `shimFile`. `exclusive`: a spexcode-named source file of our own
  (`.opencode/plugins/spexcode.ts`, `.pi/extensions/spexcode.ts`) — whole-file write, whole-file delete.
  `shared-json`: a config file the HOST AGENT shares with the user (`.claude/settings.json`,
  `.codex/hooks.json`, `.zcode/settings.json` also carry their permissions, env, statusLine and their own
  hooks), where a whole-file write is silent data loss and a whole-file delete makes it permanent for an
  untracked file. There we co-own only identity-stamped ENTRIES: JSON has no comment syntax, so the stamp is
  the hook COMMAND — every entry we write invokes `dispatch.sh`, and only such entries are ever written or
  removed. Everything else round-trips: other keys, other events, foreign hook groups, and the user's half of
  a group that mixes both. Re-landing replaces our entries rather than accumulating them, and the file itself
  disappears only when nothing of theirs is left. A `shared-json` adapter's `shim()` returns the hook payload
  the merge writer needs alongside the standalone bytes; the ownership fact is static, so `clean` reads it
  without building a shim. What co-ownership cannot preserve is hand layout — see [[content-filter]].
- **clean / removeTrust** — the materialize INVERSE: `clean(proj, arts, preserveProject)` surgically removes
  ONLY this harness's tree-local artifacts — the managed contract block (sentinels), the shim (whole-file or
  entry-wise per `shimOwnership`), and the `arts`-named skill/agent files. Project-scoped shim/trust is
  installation transport: ordinary
  re-materialize preserves it and the tree's final dispatch allowlist makes it inert when unselected;
  project-wide dematerialize/uninstall passes the destructive mode and calls `removeTrust`. Every step is gated on a SpexCode
  identity stamp (the managed-block sentinels, the shim's own `dispatch.sh` command line, the trust sentinels,
  the `GENERATED_MARK` on each on-demand file), so it never touches a user's CLAUDE.md/AGENTS.md prose, a
  hand-made settings.json, a sibling skill the user added, or any `.spec` data. **The `arts` name list says
  WHICH path to look at; it never proves the file there is ours.** A live spec node named `distill` and a
  skill the user wrote at `.claude/skills/distill/` are the same path, so the name sweep is stamp-gated too:
  an unstamped file at a live name stays. The cost is that an artifact generated before stamps existed is now
  spared as well — a stale file the human can delete, which is the right side of a trade whose other side is
  deleting their work. [[harness-delivery]] calls it for every
  adapter, so dropping a harness from `harnesses` prunes its local products without deleting project transport. Adding
  a harness adds an adapter (with its `clean`), never a prune branch in materialize.
- **payload accessors** — read `session_id`, the edited-file path (Claude `tool_input.file_path` vs Codex
  `apply_patch` command — Codex has NO `file_path`), and notification type, from a hook's stdin.
- **acting identity** — which id a hook acts on. The payload's `session_id` is the acting thread, so it is
  preferred; the launched `SPEXCODE_SESSION_ID` in the hook's env is the fallback. That preference is
  RESOLUTION-AWARE, never blind: a payload id wins only when a record answers to it (directly, or through the
  `harness_session_id` alias a backend captured at thread start). A harness may re-mint its conversation id
  mid-session — a claude compaction/continuation does — while the record keeps the launched one, and a blindly
  preferred payload id then names no record at all. Every record-dependent hook (the lifecycle gates, the
  freshness stamp, the failure path) would silently no-op and the session would read `working` forever, with no
  error on any surface. So an unresolvable payload id falls back to the launched id, and an unresolvable
  divergence is the only case that costs a store read: when the two ids agree, nothing is read.
- **launch / sessionId** — the launch command and id model: Claude `claude --session-id <uuid> [--worktree]`
  (caller chooses the id); Codex `codex` under the launcher's configured approval/sandbox policy (id is codex-assigned — the backend
  owns it via `thread/start` at launch and resumes by it). The agent-typed CLI resolves its own id via the
  harness's env (`CLAUDE_CODE_SESSION_ID` / …). [[codex-runtime]] owns the project-shared daemon's placement and identity hygiene. `launchEnv(id)`
  owns the transport bootstrap variables too: a rendezvous adapter returns its daemon mode + per-session socket,
  while a transport that needs neither returns no adapter env; the session launcher only composes those values
  with the governed session id and configured home variables. The same id model is exposed as one **exact native
  target identity** capability over the current record: a caller-pinned adapter derives the native conversation id
  from the governed session id even when `harness_session_id` is empty, while a native-assigned adapter derives it
  only from its captured alias and returns no identity before that alias exists. This capability says only which
  exact native conversation the record owns. It says nothing about whether that conversation is live or whether a
  local PID still belongs to it. Leaf ownership is a separate, unified lifecycle proof rather than another adapter id
  model. Before tmux mutation, one target-scoped pane read and one process snapshot must prove the launch-registered
  PID is in that governed session's pane descendant closure, with the PID's process-start token unchanged across the
  observation. Only that proof may atomically mint the session leaf birth receipt
  `{version,kind,sessionId,pid,startToken}`. A strict valid receipt plus the same live PID/start survives process-title
  changes, tmux removal/reparenting, backend crashes, and a retry; every direct signal revalidates the receipt, current
  `agent.pid`, and live start token. A process environment marker is never leaf ownership: it is inheritable by
  unrelated descendants. Missing pane/PID/start, an unreadable process snapshot, ancestry absence, a changed token,
  or a malformed receipt is unknown and refuses before mutation. A valid receipt whose original PID is dead or whose
  start token now differs proves only that the original leaf is gone/PID-reused; the current PID is never signalled.
  The detached-runtime receipt format is not reused because a session leaf is neither a detached process-group root
  nor required to satisfy `PGID == PID` / Linux `SID == PID`. PID/start identity and runtime liveness remain separate
  proofs. Product lifecycle code consumes native-target identity and leaf ownership independently and never
  reconstructs an adapter's id model from record fields or harness names. A shared runtime's ownership proofs — its live control-plane probe, target census, cold archive closure,
  unreadable-record quarantine, generation fence, detached receipt, and post-cold compensation — are declared
  through the adapter and consumed independently by product lifecycle code ([[codex-runtime]]).
  Launch acceptance and launch readiness are separate adapter facts. The
  optional `launchReady` seam returns an adapter-owned readiness fence, not a boolean: its immutable proof names
  the runtime/reference facts that made the launched session addressable, and its validator re-proves those same
  facts after product code crosses a durable internal pending boundary. Public readers project the exact
  pre-resume stopped/offline record throughout that validation; only a successful recheck clears pending and
  publishes `stopped:false`. Adapters without it retain the existing
  bounded liveness proof and recheck. A missing, timed-out, or invalidated fence is a launch failure, never a
  successful handoff. Codex-headless's readiness fence is stated in [[codex-runtime]].
- **worktree** — Claude has a native `--worktree` + `WorktreeCreate`/`WorktreeRemove` hooks; Codex has none
  (SpexCode manages the worktree itself). The adapter exposes whether the harness owns worktrees.
- **pane-title semantics** (`paneTitleIsSelfSummary`) — whether the harness's tmux pane title IS the agent's
  own live task self-summary, so the board headline may derive from it. Claude continuously writes a one-line
  task summary into its OSC title → true; Codex sets the title to a spinner glyph + the cwd FOLDER name (not a
  summary) → false, so its headline falls through to the launch-prompt preview rather than showing the folder.
  Consumed by [[session-activity]]'s headline resolver — this capability field is the ONLY harness branch in
  that path (no `if (codex)`).
- **headless** — whether the adapter launches without an interactive TUI. [[launcher-visibility]] consumes
  this capability to keep headless profiles out of the dashboard picker by default without learning an adapter
  id; the complete launcher registry and explicit CLI selection remain unchanged. Claude, Codex, OpenCode, and
  pi each declare `false`; an actually non-interactive adapter declares `true` on its own row. A one-shot
  headless adapter may also declare `launchOneShot`, which tells the generic
  launcher not to treat its intentional fast exit as a failed boot worth replaying.
- **runtime: liveness + delivery + interrupt + cleanup** — the RUNTIME transport, lifted onto the adapter so product code honours
  `ownsRendezvous` instead of hard-wiring the claude rendezvous socket. `liveness(rec, tmuxAlive, runtimeDir, pane, socketLive)`
  answers "is this session's agent ready?" — from the caller's ONE runtime snapshot, which carries the window
  presence, a per-pane probe (the pane's root pid + one whole-box process table from a single `ps`), AND
  `socketLive` (whether a CONNECT to this session's rendezvous socket found a live listener, probed once for the
  whole list). **claude**'s rendezvous transport — socket name and home, connect-probe liveness, delivery protocol — is
  [[claude-rendezvous]]; **codex**'s app-server transport — descendant-tree liveness, backend-owned thread identity, JSON-RPC delivery — is
  [[codex-runtime]].
  Before a NEW prompt becomes debt, an adapter may report its native input transport as **reachable**,
  **unproven**, or **unreachable**. These are transport facts, not lifecycle verdicts: an unproven probe keeps
  ordinary queue-and-retry behavior, while sessions-core joins a proven-unreachable result with its independent
  live registered-pid witness. Only that combination is a **stranded** session: a live worker whose launch-time
  input address can no longer be rebound, so accepting another message would make unclaimable debt. `send`
  refuses before log append or enqueue, names the stranded rendezvous reason, the current queue count, and the
  `session send <id> --keys "<keys>"` tmux bypass. The board liveness remains `unknown`: a dead transport is
  never permission to call the agent dead. No product path classifies `/tmp`; each adapter proves its own
  native transport. `deliver(rec, text)` after acceptance remains the immediate handover attempt, never a
  second acceptance decision. The log append already made an admissible message durable ([[dispatch]]), so a
  failed handover leaves the same `mid` OWED for the delivery queue to retry. How each transport hands the accepted message over is its own contract: [[claude-rendezvous]] (one atomic reply+repaint chunk, retry-safe by `mid`) and [[codex-runtime]] (`turn/steer`
  into a live turn or `turn/start` on an idle thread, and the exact-native hard interrupt).
  `resumeArg(rec, pendingLaunchPayload)` is the relaunch tail `reopen()` hands `launch()`; each adapter consumes
  that tail its own way — Claude appends `--resume <id>` to its command, Codex branches its bootstrap script on a
  `--resume <thread-id>` marker ([[codex-runtime]]) — and either way it is the SAME conversation.
  An adapter that mints native identity during launch declares `launchPayloadProof`. Product lifecycle then
  retains the authoritative `launch` artifact after transport submission and gates later delivery behind it.
  The adapter stages a narrow shared launch receipt only after it has established the native id plus first prompt
  durability. Codex does so after `thread/start`, confirmed `turn/start`, and rollout discovery; the session
  lifecycle owner validates the exact payload receipt, binds the id, and consumes both artifacts under the
  record lock. Adapter
  rows without this capability keep their existing transport-accepted consumption rule. This is one capability
  seam, not a Codex branch in session or queue policy.
  This receipt is the final identity-plus-first-rollout commit. The generic adapter `launchReady` fence that
  follows it measures post-commit runtime liveness; its failure records a retryable liveness error but never
  restores the first-turn payload or clears the proven identity, so recovery addresses the same native thread.
  The adapter also declares its own **settled launch failures** — the patterns of ITS output for a launch that
  running again cannot fix (claude: a `--resume` id it has no conversation for, a rejected credential; codex: a
  thread id with no rollout on disk). That declaration is the ONLY place a harness's error wording is ever
  matched: the launch transport asks the adapter and consumes the verdict, so a settled failure is spent once
  with the harness's own line left visible instead of retried into silence ([[launch]]), and product code never
  learns a harness's English. A harness that declares none simply keeps the plain bounded retry.
  sessions.ts's `liveness()`/`isOccupying()`/`sendKeys()`/
  `reopen()`/`waitForReady()` all route through these adapter methods — there is no socket hard-wire and no
  `if (codex)` left in the runtime path; the rendezvous-socket path + its `replyViaSocket` optimistic write MOVED into
  `harness.ts` as the claude adapter's `deliver`/`liveness` implementation, while Codex's app-server launch and
  JSON-RPC turn delivery live in the Codex adapter. [[claude-headless]] composes the materialize half from
  `claudeHarness` but replaces this whole runtime half: its intact, non-stopped record is online, active delivery
  writes a native stream-json user event into the resident turn child, idle delivery spawns a
  `claude -p --resume` turn, and hard interrupt writes Claude's native `control_request/interrupt`. Every
  complete native stdout event is forwarded unchanged through the controller's stdout; it is not persisted as
  a second SpexCode conversation record. Launch also registers the interactive agent process in
  `agent.pid`; adapters may use that per-session signal alongside their native transport proof. OpenCode
  prefers its rendezvous listener and falls back to the registered pid, so a plugin-load failure still reads
  honestly. Claude/pi use their live listener, while Codex uses the visible pane's descendant process tree.
  `cleanupRuntime(rec)` is the inverse owned by the same transport: rendezvous adapters unlink their socket,
  claude-headless unlinks its controller socket even when tmux killed the controller before its signal handler
  ran, and Codex leaves its shared project app-server intact. **Their** socket — and the only honest test of
  "theirs" is that the agent this teardown just killed is GONE, so removal waits for a PROVEN-dead listener
  (the same tri-state probe liveness uses) and a path still answering is left in place, loudly. The asymmetry
  is deliberate: a dead-but-unlinked file is harmless residue the next teardown reaps, a wrong unlink strands
  a working agent forever — still bound to a path nothing can reach, undeliverable, and reading as a corpse to
  every prober. The ordinary teardown still leaves zero socket residue, because its agent really is dead — and
  that is the product's job to GUARANTEE before it asks an adapter to sweep: the pane is the agent's home, not
  its leash, so a teardown that finds its own registered pid outliving the pane escalates (SIGTERM, then
  SIGKILL, identity-guarded against a recycled pid) rather than leaving an orphan whose still-live listener the
  adapter would then, correctly, refuse to remove.

  That proof is the second of two defences, and the first is the socket's NAME. A session id alone does not
  identify a session on a box: `SPEXCODE_HOME` scopes the store and `SPEXCODE_TMUX` scopes the tmux server,
  so two worlds can hold one id (a fixture, a migration, a record copied for diagnosis) — and a path derived
  from the id alone made them share the one resource neither scoping covered. An isolated instance's
  `kill-session` then missed while its unlink landed, and delivery would have crossed the same way. So the
  path is derived from the runtime the session belongs to (`runtimeRoot()`, the identity that already scopes
  its store) and is a LAUNCH-TIME FACT: launch stamps it beside the record like `agent.pid`, and every later
  reader — launch env, liveness probe, delivery, teardown — reads the path the agent actually bound instead of
  re-deriving one. A session launched before the stamp existed keeps the unscoped path it really bound, so
  nothing running is disturbed and the fallback retires as sessions turn over.

Headless liveness describes a durable conversation that can accept another delivery; it does not erase the
outcome of the last ephemeral turn. A shared resident adapter such as Codex remains `online` between turns from
its intact record because its project app-server can address the thread without a session process. A session-home
adapter such as Claude headless, OpenCode headless, or pi headless instead owns an exact tmux home and the ordinary
session leaf birth receipt. Its public row remains addressable while that home exists; physical cold proof requires
that the receipt-bound leaf and exact home are gone and every adapter-owned per-session listener rejects a connect
probe. A human `stop` durably records that completed teardown. Archive and close may consume that witness without
inventing a second leaf or native interrupt, but `stopped` alone never proves cold: a live, malformed, unreadable,
or reappeared leaf/home/listener remains a loud refusal. `resume` clears the marker as it relaunches the same
conversation; close needs no marker handling because it removes the whole record. Turn outcomes enter the
session layer through each harness's native signal: Claude's StopFailure hook, a process-backed headless
adapter's non-zero child exit, or the Codex app-server observer inherited by its interactive and headless forms.
Every source reaches the same active-only `markTurnFailure` compare-and-set, changing a live undeclared
`active` lifecycle to `error`; a zero process exit, native completed or interrupted turn, declaration, or
explicit stop that landed first changes nothing. A human interrupt is the one exit that is not a failure: the
backend stamps the interrupt before the abort is sent, and a process-backed headless adapter's non-zero exit
that follows a fresh stamp is projected as the interrupt (`asking`, [[dispatch]]) through this same seam,
never as `error`. Process notes name the harness plus exit code or signal;
Codex notes retain the native error message and native `completedAt`. `online` may remain true
when the adapter's controller, pane home, or shared server can still accept the next delivery; the orthogonal
`error` lifecycle is the honest signal that the previous turn failed.

The runtime's behavior-identical mechanics are shared once across adapter rows: shell arguments use one POSIX
single-quote encoder; resident headless controllers use one newline-delimited JSON socket client and timeout;
socket-backed headless delivery uses one `live` / `unproven` / `absent` gate before its adapter-specific cold
wake; listener-backed, session-home, and shared-record liveness are named predicates; and per-session socket cleanup
uses one unlink helper. Adapter rows retain only the real differences: request payloads, timeout/error labels,
cold-wake spawners, listener-or-pid fallback, delivery refusal text, and the sockets each runtime owns.

The adapter-neutral identity face is one ordered `HarnessIdentity` registry: each harness id and its
`sessionEnvVar` appears once there, and every full adapter projects its identity row from that registry.
`sessionIdentityEnvVars()` and layout's environment lookup consume the same rows. Thus a new adapter cannot
leave a stale session-id env list behind, and a consumer that only needs identity data never loads launcher,
transport, or materialization machinery.

Because the hook handlers are pure shell, they cannot import `harness.ts`; `hooks/harness.sh` is its shell
mirror and owns the harness-divergent payload parse ([[hook-shell-mirror]]).

**Identity is INJECTED where it is known, never inferred later** ([[identity-injection]]): every process we create
is given its own `SPEXCODE_SESSION_ID`, a process that belongs to no single session is given none, and the commit
trailer reads that variable and nothing else.
