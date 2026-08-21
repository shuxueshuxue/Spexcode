---
title: sessions-core
status: active
hue: 280
desc: The shared session module every session feature builds on — the global per-session record I/O, worktree/branch/node resolution, and the launch/state/dispatch plumbing the lifecycle and comms nodes each specialize.
code:
  - spec-cli/src/sessions.ts
related:
  - packages/session-core/src/record-lock.ts
  - packages/session-core/src/message.ts
  - spec-cli/src/sessionSlug.test.ts
  - spec-cli/src/session-create-cli.test.ts
  - spec-cli/src/sessions-hot.test.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/session-public-projection.api.test.ts
  - spec-cli/src/session-record-integrity.test.ts
  - spec-cli/test/session-record-integrity-fixture.ts
---
# sessions-core

## raw source

The session subsystem's features — lifecycle state, launch, dispatch, comms, the live graph, selectors,
the spec-pointer — all read and write ONE module, `sessions.ts`. It is shared substrate with no single
feature as its owner, so per-feature drift on it fanned the same change across a dozen nodes. Give it a
foundation owner: the features govern their own surfaces and REFERENCE this module via `related:`.

## expanded spec

sessions-core owns `sessions.ts` — the common session layer: the global per-session record read/write
(`session.json` keyed by session_id, [[runtime]]) with the record-integrity rules below, session↔worktree↔node resolution, the launch-script
assembly (the rendezvous env + the harness's own command + the spec-pointer/prompt tail — carrying NO
`--append-system-prompt`/`--settings` flag, since the contract and hooks reach the agent by worktree
auto-discovery, see [[harness-delivery]]), the shared resolution of a raw `surface: command` invocation into
the prompt that [[launch]] or [[dispatch]] delivers, and the launch queue's drain loop. [[session-follow]]'s
durable watch relation is stored once as a target-owned `watchers.json` here because a target's record writer
is the only hot path that must find its watchers. After a state record commits, it snapshots that small list
and uses the existing send queue to notify each watcher only after releasing the target's lock; no monitor
loop, second transport, or bidirectional index enters the shared layer. `wait` remains the cursor-backed
reader fallback for callers with no governed delivery address. A watcher identity owns a small independent
source set: `manual` comes from the explicit watch command and `parent` comes from the tree relationship.
The entry persists while either source exists, and the transition path projects the source set to one watcher
id, so overlapping parent/manual supervision yields one delivery rather than duplicates. Source installation and
reparenting directly dispatch the current state, except that creation installs its parent source with one durable
initial-snapshot debt. The launch queue resolves that debt exactly once: a real capacity decision publishes the
still-queued snapshot, while an admitted launch publishes only after its adapter readiness fence has established
that the existing active/resource publication is observably working. A launch attempt that fails readiness keeps
that resource contract and its loud failure note, but retires the debt without fabricating working. A synchronous
launch/preflight failure likewise retires the debt rather than misreporting its queued record as capacity backlog;
only the queue's proven full-capacity branch may publish queued. Only a later state write consults the source
policy. A retryable launch error retains the same debt for the next queue attempt, and a restarted supervisor may
reclaim readiness observation for an already-active launch without launching or replaying its prompt. Each accepted
snapshot is keyed by the debt token and authored state; before clearing the token, delivery compares the latest state
under the record lock and accepts any raced actionable state with its own key. A crash before that compare therefore
replays neither an accepted initial snapshot nor an accepted catch-up, while still delivering an authored asking,
review, or error that raced acceptance. Parent-only `active`/working is the suppressed terminal of that comparison;
manual includes it. Thus creation ordering does not weaken routine-working suppression, and manual+parent yields the
complete later-state feed without a duplicate or a second mechanism.
Creation and
[[session-reparent]] change only `parent`; watch cancellation changes only `manual`. Legacy rows with no
source set are read compatibly: the present parent edge proves `parent`, otherwise they are manual intent.
The manager's merge dispatch prompt owns the post-landing handoff: once the verified base branch has advanced,
it names `spex session done --propose close` as the final action only when the task is settled, its worktree is
no longer needed, and no human decision or follow-up remains; otherwise the agent declares the state that is true.
The merge dispatch itself is intentionally a plain prompt: the server does not accept review-generation OIDs,
epochs, or idempotency headers and never mutates `main`; the worker re-syncs and re-runs proof in its own worktree
before the one no-ff landing.
[[session-reparent]] uses that same target ownership: it takes the ordinary record locks while changing a
child's parent pointer and watcher list, then delegates the current-state snapshot to the existing dispatch path.
The core never asks a former watcher to participate in its own removal. A null replacement parent is the
same transaction's top-level detach: it removes the former relation and its pending delivery without creating
a root record, new watcher, or notification.
A launch record carries the selected launcher name, its resolved harness, and the exact pinned
`launch_cmd`; session lifecycle and comms call that one interactive adapter directly rather than routing on a
second product dimension. The session's node is derived only from the raw prompt's first `[[id]]` topic
mention ([[mentions]]) — no caller-supplied node argument exists at the CLI, HTTP, or function boundary.
That one visible mention drives the record attribution and the node part of the branch/worktree slug; without
one the session stays node-agnostic and falls through to its prompt-derived title. The branch/worktree slug
and that title are the session's OWN identity: derivation strips actor mentions (`@session`, [[mentions]]) and
UUID-shaped tokens first — a prompt that mentions another session must never name this one after it, or a
worker sent to clean that session can match its own worktree — and the slug keeps unicode letters/numbers,
so a CJK prompt survives as the readable name its author typed (git refs take unicode; transliteration
would trade that for a dependency and a name nobody wrote). Worst case the slug falls back to `session`,
kept unique by the session short-id suffix. Worktree
prep also copies the machine-local `spexcode.local.json` snapshot from the main checkout into every fresh
session worktree — the one source git cannot deliver, since the tracked spec data arrives by checkout and
the materialized artifacts by re-materialize (the transport-by-kind policy and its helper module belong
to [[residence]];
here it is followed by the ONE creation-owned materialize). `git worktree add` still fires Git's normal
post-checkout hook, but the create command passes a child-only defer marker so that hook does not render before
the local snapshot exists; the explicit post-seed materialize is the transaction's sole render owner. The
session objects it assembles carry their display strings pre-derived (`label`/`title`), a current `files`
projection read from the session-owned `files.json`, and hide the
bare name parts under `raw` — that naming seam's contract (chains, wire shape, enforcement) is
[[session-label]]'s. **A row in a LIST carries the originating ask only as its one-line preview.** The full
text is served by the id-addressed record detail, which reads the stored prompt itself; a create response is
a receipt for one ask and keeps it whole. So the list body stays proportional to the NUMBER of sessions
rather than to the total length of what was asked — otherwise one long ask outweighs the entire rest of the
board, on every poll and in the last-known-row cache, to serve a field no list reader consults.
Close retains that record as the one archived session source and records its `closedAt` beside the archived bit in
the same atomic record publication. The public projection carries the timestamp without a timeline read, so a
complete archive index remains proportional only to record count. Older archived records with no timestamp project
`null`; creation time, manual sort order, and filesystem metadata never impersonate the missing close fact.
An archived record is a retained, read-only fact: lifecycle writers reject it with an explicit closed/read-only
reason rather than attempting to read its removed worktree and leaking a materialization error.
The sibling `launch` artifact is the authoritative resolved first-turn payload, not a best-effort prompt cache.
The shared layer preserves it across queue drain and failed launch, blocks later delivery debt behind it, and
hands it back only through the resolved adapter's no-native-identity recovery seam. The adapter completes launch
with one receipt call carrying the exact payload and native id; under the record lock the shared layer rejects a
missing/changed artifact or changed identity, persists the identity, and only then consumes the artifact. Raw
originating `prompt` bytes remain a separate display/audit artifact and never participate in recovery.
The receipt is atomically no-replace and consumption is record-first, payload-second, receipt-last: every
crash boundary is retryable without forgetting or replaying the first turn, while malformed or cross-bound
receipts fail rather than repairing themselves from weaker input.
Cross-feature defaults that must be read by the backend at runtime live here as the
shared implementation seam — for example [[launch]]'s `sessions.maxActive` fallback value — while the feature
node still owns the user-facing policy and slot semantics. Each session feature ([[state]], [[launch]], [[dispatch]], [[session-follow]],
[[session-selectors]], [[agent-reply-channel]], [[spec-pointer]]) specializes a slice of it and lists it
under `related:`, so a change here attributes its drift and eval staleness to this one owner instead of all of them
(see [[governed-related]]). That several features hold no code of their own is the honest signal that
`sessions.ts` is a monolith — a future code split into per-feature modules would let each reclaim ownership.

The shared layer also reconciles each live governed record with its adapter's optional native turn-failure
subscription. It owns subscription lifetime across backend replacement and record stop/archive/retirement,
with bounded backoff after a transport disconnect, but no
product protocol: subscription and failure mapping remain adapter work ([[harness-adapter]]). Every reported
failure reaches one record-locked compare-and-set that changes only a live, undeclared `active` record to `error`.
A declaration that landed first is authoritative, so a late process close, delayed native completion, or
restart reconciliation cannot overwrite it.

The record's existing `name` is the one human display override: CLI creation may set it once with `--name`, and
rename later replaces or clears that same field. It affects only the shared label/title projection;
the prompt-derived node, branch, worktree slug, and stored prompt title retain their own responsibilities.

**Public session creation has one lightweight backend-authority decision before it can use the legacy local
path.** The CLI asks only `GET /api/instance`, never the board-shaped settings projection: this identity route
does not enumerate governed records or derive worktree overlays. An explicit target runs that same availability
probe but skips project comparison and normally owns the one keyed `POST /api/sessions`; an implicit target
does so after the instance identity canonically matches. The sole exception for either route is an exact
no-listener failure whose entire transport cause chain is `ECONNREFUSED`: only then may the existing in-process
fallback run. The raw instance root is not compared directly: both the caller and served roots pass through the
shared main-root resolver, which follows linked worktrees to their common checkout and applies configured
`main`. That preserves project identity without rebuilding layout. An HTTP response of any status proves
ownership; the project-match check runs only when a usable instance identity is available and still refuses a
proven mismatch. Timeout, reset, DNS, and every other transport result fail without local creation; an already
received HTTP response is never relabelled `backend_availability_indeterminate`. The instance authority wall
remains its independent 1500ms budget: the optional recorded-endpoint health read is discovery only and never
consumes that budget.

**A create may pin its fork point.** Creation accepts an optional `base` — any commit-ish the main checkout can
resolve. Absent, the session forks from the auto-detected source-of-truth branch, i.e. from whatever that branch
has drifted to at the moment the worktree is made; that is right for ordinary work but leaves a run against a
frozen commit inexpressible, so an evaluation, a bisect, or a replay could not name the code it actually ran on.
A supplied `base` is resolved during target resolution, BEFORE any Git mutation: one that names no commit fails
the request with a 400 and leaves no half-made worktree, branch, store, or private candidate receipt behind. A
resolved pin becomes the `git worktree add` start point and is stored on the record, so a later reader can tell
a pinned run from an unpinned one. It also joins the idempotency payload hash — a retry that changes the pin is
a different request, not the same one — while an unpinned create keeps its exact legacy record bytes and
receipt hash, so nothing that never pinned gains a field.

**Exclusion lives in the lock, never in a privileged process.** The per-session record lock implementation is
shared from `@spexcode/session-core`: a filesystem lock with a PID liveness check, held across processes, so a session operation may run in whatever process
takes it — a backend is the convenient owner of the launch environment and a shared cache, not the holder
of the invariant, and a read that takes no lock needs no permission from anyone. That is what lets this
layer be a brick an external system can drive rather than a service it must be granted access to.

A text send delegates its record-locked append-plus-queue acceptance to `@spexcode/session-core`; an
agent-attributed send also fences its named sender in sorted order. Before a new append, sessions-core asks the resolved adapter's optional
transport witness. Its proven-unreachable answer becomes a stranded refusal only when this layer's independent
registered-pid witness still proves the worker alive; an unproven transport remains queue-retryable and does not
change liveness. Close keeps the sender lock while it publishes the retained archived record, so a stale process
cannot append after close returns. Both locks release
before the adapter poke: a native turn can synchronously invoke lifecycle hooks that re-enter the record writer,
so no record lock spans the handover. The delivery queue's own lock is what makes a handover exactly-once and
recognizes revoked unhanded debt, while normal adapter/runtime guards remain the authority for concurrent
lifecycle operations. Direct close asks the resolved adapter whether the current record derives one exact native
target identity. That adapter capability, not the presence of the storage alias `harness_session_id`, selects the
ordinary exact cold-stop/close path; no lifecycle branch names a harness or treats lifecycle status or
liveness as identity. A record with no derivable native target remains on the narrower unbound-residue retirement
path and fails closed while any local worker ownership is live or unproven.

Close may carry an opaque adapter cold-preflight receipt across its exact leaf/tmux stop, into the same adapter's
cold commit, and through archive-ref publication. This shared layer forwards that one in-memory
object without inspecting it, persisting it, or exposing a recursive/public option; the adapter revalidates its own
receipt before the stop guard may admit a known native descendant collection. If publication fails after cold commit,
the same object authorizes adapter compensation of the original collection. A missing, forged, stale, or changed
receipt retains the ordinary descendant refusal before shared-runtime mutation and cannot authorize compensation.

### Record integrity — one writer, three readings, no revival

**Every SpexCode-managed field of `session.json` is produced by ONE writer here**, by serializing the typed
record and landing it by atomic replace, and NOTHING else may compose or edit that file's text — not a hook,
not a shell, not a route. A record whose `runtime_owner` names an external controller is instead written by
[[runtime-session]] under the same record lock and is `governed:false`; this module may read it but never launch,
stop, or rewrite it. Its opaque `runtime_state` and idempotency `runtime_revision` extend the canonical disk
format without turning ZCode state into SpexCode lifecycle policy. The reason for a single typed writer per
ownership mode is the `note`: it is arbitrary human/agent prose, so any writer that substitutes it into
existing JSON eventually meets a quote, a backslash, or a newline and leaves a record nothing can parse. Both
note-carrying entries — the agent's typed declaration and the hook's capture of an asked question — therefore
land through the same call, and a note round-trips byte-for-byte on every surface. The shell hooks keep the
cheap half: the one-field-per-line shape lets them READ ("already active, nothing stale to clear?") with
exact-line greps and no jq, and every WRITE goes back through the CLI to this writer ([[state]]).

A published create record is also the durable fence for any private pre-publication candidate receipt whose
best-effort retirement failed after the atomic record write. Terminal close holds the session record lock and
the exact recorded branch/path resource lock, retires a valid matching receipt, and proves it absent before
stopping or removing any public resource. After its target tmux kill, it also proves that exact session has no
pane left before accepting adapter cold proof or deleting durable resources. Failure preserves the row, store,
worktree, and branch; deleting the record first would let the old receipt regain cleanup authority over a later
name collision.

Launch readiness is the one durable internal publication fence within that record. Its pending value freezes
the exact pre-resume lifecycle/proposal/note/stopped/archived and offline projection while the raw candidate is
available to the adapter's post-launch validator. The record/layout boundary owns one public-record parser:
list/API/graph, resource owners and shared references, resolved-layout settings, and the timeline observer all
consume that same three-way projected entry rather than raw candidate fields. A successful fence clear
publishes the final record and its lifecycle event once; failure or stale recovery restores the original and
emits nothing. Malformed pending bytes are a corrupt/unknown public entry everywhere, never a reason to reuse a
last-known online row, perform a git walk, or infer an owner from candidate lifecycle fields. "Malformed"
includes a structurally complete original whose lifecycle or proposal string is outside the same closed enums
the typed session reader accepts. While the fence exists, the compact public display is pinned offline rather
than reconciled from candidate runtime evidence, even if the frozen original says `stopped:false` with an
`active`/`idle` lifecycle and a candidate process is live.

Reading a record has **three** outcomes and collapsing them is what once made a live session answer "no
session record". **Absent** is the legitimate nothing. **Corrupt** — present but unparseable — is a fact about
a session that EXISTS: it keeps its row (naming the file and the parse error, liveness `unknown` since nothing
was probed), and every writer refuses on it rather than repairing it into a plausible empty shell. A corrupt
record cannot prove the adapter, session leaf, worktree, or branch owner, so `close` may quarantine the original
bytes as control-plane evidence but then refuses loudly: it sends no signal and preserves the session runtime,
worktree, and branch, reporting those residues instead of guessing. Retiring only the corrupt row requires a
future record-only control-plane seam; it must not be approximated by skipping the runtime guard or by adding a
second process terminator. Any other read failure still throws:
a transient fault must read as neither. **Retired** is the third integrity reading, derived not stored: the
recorded worktree is gone, so there is nothing left to be active *in*. It is terminal — no lifecycle writer may
put it back to `active`/`idle`, and no delayed launch-readiness observer may replace its frozen note after the
worktree disappears. No launch is assembled for it; only `close` remains.

The leaf-ownership guard that gates every stop distinguishes **a dead leaf from an unprovable one**. Both look
alike from the recorded pid — neither yields a start identity — but they call for opposite answers. A pid that
names no live process has nothing to signal and nothing a signal could hit by mistake, so the leaf is already
in the state stop wants and teardown proceeds record-only, exactly as for an explicitly stopped record. A pid
that IS alive while refusing to prove its identity is the case the guard exists for, and it still refuses
loudly, because signalling it could kill whatever now wears that number. Collapsing the two into one refusal is
what made a session impossible to retire: a launcher that dies before readiness leaves a dead pid on the
record, and `stop` and `close` then both refused it forever — the row could be neither run nor closed, and
`quarantine` does not apply because the record is perfectly readable. Liveness is asked with the same probe the
escalation path already uses to tell a vanished leaf from a replaced one, so one question has one answer here.

The prompt seam carries ONE invariant for every harness: **the text handed to an agent never begins with `-`**.
Human prompts legitimately do — a pasted browser-console line, a diff hunk, a quoted flag — and downstream that
first character decides whether the text is read as a prompt or as machinery. Each harness parses its own argv
by its own rules (one honours an end-of-options `--`, one silently drops a detached value starting with `-`,
one has no end-of-options branch at all), and the launch scripts additionally recognize their resume/continue
markers by comparing the tail to a literal flag. Answering that per harness would mean an escape per adapter
plus a refusal for whichever harness has none — several answers to one question, and still nothing covering a
prompt that IS the literal marker. So the guarantee is made once, here, where every launch and every send
already passes through, and everything downstream hands over one plain quoted operand knowing nothing about
who parses it. The cost is a single leading space on the prompts that would otherwise be undeliverable, with
the human's own words following byte-for-byte; the alternative was refusing to carry them at all. This is why
no `if (harness)` and no per-adapter prompt escape exists in the launch path ([[harness-adapter]]).

A launch is likewise refused **before** a window opens when the transport can already settle it: no worktree,
no branch, no resolvable launcher command, or a rendezvous owner's derived socket pathname at/over its OS byte
limit. Those are facts about this machine that no number of attempts can change, so each is one loud refusal
carrying its own code — never a launch that fast-exits and is retried on a wall clock ([[launch]]). The
rendezvous check is a generic `ownsRendezvous` preflight and the adapter owns its derivation; it runs during
creation before any candidate resource exists and again before its launch-time stamp. What the transport cannot
settle stays with the bounded readiness retry, and what only the harness can recognize is the harness's to
declare ([[harness-adapter]]).

An unreadable governed record has one separate recovery control: **quarantine** is neither `close` nor a
repair. The caller supplies the exact former adapter/thread (or explicitly no native thread), tmux session,
worktree path, and branch it extracted from the opaque incident. The thread field is an adapter-native
conversation id, never the SpexCode session id: CLI omission explicitly sends no native thread, which is the
required witness for an adapter such as Claude that has none to archive. The shared layer then re-proves, at execution
time, that the session's registered leaf process is absent, that exact tmux session/worktree/branch are absent,
and that the named adapter is healthy. A named native thread must either be absent, or be an exactly-unowned,
idle, descendant-free native thread that its own adapter archives and re-censuses as unloaded; every live,
active, owned, ambiguous, descendant-bearing, changed-generation, malformed, or unknown control refuses before
the record moves. The operation never sends an OS signal, removes a worktree or branch, guesses an adapter, or
turns opaque bytes into a lifecycle record. On success it atomically moves only `session.json` out of the active
session directory to a per-project quarantine bundle, preserving its byte-exact payload plus the supplied claim
and the independently observed absence proof. The ordinary record enumeration then removes the corrupt row from
the session list, graph, and resource projection without a special hide list. `restore` is the explicit reverse:
it atomically moves the byte-identical record back only while no active record exists, making the corrupt row
visible again; it does not resurrect a runtime or infer lifecycle. CLI, HTTP, and the dashboard context control
all call this one operation and surface refusal details.
