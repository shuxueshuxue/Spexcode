---
title: sessions-core
status: active
hue: 280
desc: The shared session module every session feature builds on — the global per-session record I/O, worktree/branch/node resolution, and the launch/state/dispatch plumbing the lifecycle and comms nodes each specialize.
code:
  - spec-cli/src/sessions.ts
related:
  - spec-cli/src/session-record-lock.ts
  - spec-cli/src/delivery-lock.ts
  - spec-cli/src/session-lock.test.ts
  - packages/session-protocol/src/engine.ts
  - spec-cli/src/sessionSlug.test.ts
  - spec-cli/src/session-create-cli.test.ts
  - spec-cli/src/sessions-hot.test.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/session-public-projection.api.test.ts
  - spec-cli/src/session-managed-watch-realtime.yatu.test.ts
  - spec-cli/src/session-record-integrity.test.ts
  - spec-cli/test/session-record-integrity-fixture.ts
---
# sessions-core

## raw source

The session subsystem's features — lifecycle state, launch, dispatch, comms, the live graph, selectors,
the spec-pointer — all compose one shared session layer, with record I/O in `session-record.ts` and the remaining
plumbing in `sessions.ts`. It is shared substrate with no single
feature as its owner, so per-feature drift on it fanned the same change across a dozen nodes. Give it a
foundation owner: the features govern their own surfaces and REFERENCE this module via `related:`.

## expanded spec

sessions-core owns `sessions.ts` — the common session layer around the global per-session runtime/worktree envelope;
`session-record.ts` owns that envelope's typed read/write and quarantine controls, while lifecycle, proposal, note, event,
queue, and topology facts live only in the canonical session application. The common layer owns session↔worktree↔node resolution, the launch-script
assembly (the rendezvous env + the harness's own command + the spec-pointer/prompt tail — carrying NO
`--append-system-prompt`/`--settings` flag, since the contract and hooks reach the agent by worktree
auto-discovery, see [[harness-delivery]]), the shared resolution of a raw `surface: command` invocation into
the prompt that [[launch]] or [[dispatch]] delivers, and the launch queue's drain loop.
Lifecycle writes have one typed entry point, `markState`; the retired `markError` convenience export is not part of
the module surface, so callers name the state transition they are making instead of adding a second error mechanism.
Creation authority is checked before any fresh-project canonical store is initialized: rejected, abandoned, fenced,
or ambiguous requests leave no SQLite, migration marker, or fence behind. Only a successfully admitted fresh create
may initialize the empty canonical store; an existing legacy store is opened only through the one-time importer.
That importer is the sole legacy-tree → SQLite path. During migration, the durable `.json-migration.lock` fence
makes legacy writers fail closed before they can publish `session.json` or `watchers.json`; after the SQLite marker,
any residue is absorbed and retired on the first canonical access ([[production-cutin]]). The application service is
the only state/event/topology authority, and callers have no legacy read or write branch.
[[session-follow]] owns the durable watch relation and what its `manual` and `parent` sources mean; this layer
supplies the transport. A committed state record projects its watcher edges, notifies each through the existing
send queue, and invokes ONE post-commit wake callback so each recipient's queue drains in the originating
runtime. That callback is a wake, not a second queue or a second truth: a missing runtime, a crash, or a failed
handover leaves the row pending for the normal retry. No monitor loop, second transport, or bidirectional index
enters the shared layer; `wait` stays the cursor-backed fallback for a caller with no governed delivery address,
and a rendered state message names the watched SUBJECT, never its recipient. Creation, [[session-reparent]], and
watch cancellation each move exactly one source through that same handoff — no snapshot token, no deferred debt,
no second delivery protocol — and a null replacement parent is one transaction's top-level detach, removing the
relation and its pending delivery without minting a root record, a watcher, or a notification.

The runtime envelope remains metadata-only for governed sessions. The `.json-migration.lock` fence blocks any
legacy writer during the one-time import; after the marker, residue is retired and governed metadata writes omit
`status`, `proposal`, `note`, and `parent`, while non-governed external runtime records keep their own contract.
An active Claude session without a native harness identity may still drain through its adapter-owned rendezvous
transport; every other binding problem stays fail-closed. No caller reads or writes lifecycle facts in JSON.

A retired protocol address is not delivery debt — the sweep drops that impossible lookup instead of polling it
forever — and a queue with no bound runtime is retained but not polled, since binding or resume is what makes it
drainable. Acceptance there is still success: the caller is told `delivery: queued` after the message commits,
never a false append failure because the post-commit drain refused an unbound runtime.

The manager's merge dispatch prompt owns the post-landing handoff: once the verified base branch has advanced,
it names `spex session done --propose close` as the final action only when the task is settled, its worktree is
no longer needed, and no human decision or follow-up remains; otherwise the agent declares the state that is true.
The merge dispatch itself is intentionally a plain prompt: the server does not accept review-generation OIDs,
epochs, or idempotency headers and never mutates `main`; the worker re-syncs and re-runs proof in its own worktree
before the one no-ff landing.
[[session-reparent]] uses that same target ownership: it takes the ordinary record locks while changing a
child's parent pointer and watcher list, then enqueues the current-state notification through the existing dispatch
path. There is no deferred snapshot debt to reconcile.
The core never asks a former watcher to participate in its own removal. A null replacement parent is the
same transaction's top-level detach: it removes the former relation and its pending delivery without creating
a root record, new watcher, or notification.
A launch record carries the selected launcher name, its resolved harness, and the exact pinned
`launch_cmd`; session lifecycle and comms call that one interactive adapter directly rather than routing on a
second product dimension. A session record carries no spec node: nothing about the session is bound to one.
The raw prompt's first `[[id]]` topic mention ([[mentions]]) is read at create time for exactly two
throwaway purposes — it names the branch/worktree slug, and when that id exists it selects the
[[spec-pointer]] line — and is never retained. Without a mention the slug falls through to the
prompt-derived title. The branch/worktree slug
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
Close preserves its ordering fence: dirty work is committed to `refs/spex-archive/<id>` before the worktree is
touched. Once that ref and the archived record are published, the linked tree is atomically renamed on the same
volume from `.worktrees/<name>` into `.worktrees/.trash/wt-<epoch>-<nonce>`, then `git worktree prune` invalidates
the old registration. The close path never recursively removes the renamed tree. A process-local serial reaper
does that work asynchronously; it scans `.trash` when the backend starts so a crash leaves a retryable residue.
Each removal failure is logged with its path and retained for the next startup rather than being swallowed.
The archive index has its own lean projection, following [[graph-lean]]'s summary-first pattern: one archived-only
read returns only `id`, visible `title`, stable search `label`, and `closedAt`. It never enumerates live
rows, reads the prompt into a public object, or carries files, web resources, notes, or lifecycle state; id-addressed
session detail remains the demand path for a selected row. Title derivation is lazy at the prompt-file boundary:
records with a name or usable note do not read their prompt at all; a prompt is read only when those earlier title
sources are absent and the prompt can affect the visible title.
An archived record is a retained, read-only fact: lifecycle writers reject it with an explicit closed/read-only
reason rather than attempting to read its removed worktree and leaking a materialization error.
The sibling `launch` artifact is the authoritative resolved first-turn payload, not a best-effort prompt cache.
The shared layer preserves it across queue drain and failed launch, blocks later delivery debt behind it, and
hands it back only through the resolved adapter's no-native-identity recovery seam. The adapter completes launch
with one receipt call carrying the exact payload and native id; under the record lock the shared layer rejects a
missing/changed artifact or changed identity, persists the identity, and only then consumes the artifact. Raw
originating `prompt` bytes remain a separate display/audit artifact and never participate in recovery.
The receipt is atomically no-replace, and consumption is record-first, payload-second, receipt-last, so every
crash boundary is retryable without forgetting or replaying the first turn while a malformed or cross-bound
receipt fails rather than repairing itself from weaker input.

Readiness is a bounded launch transaction, and this layer owns the one record-locked decision inside it: when
the receipt or the post-receipt liveness fence misses its deadline, the launch owner re-reads the record and asks
the real agent/adapter liveness witness before deciding anything. A live process or online resource is never
terminalized by a timeout — it keeps `active`/online truth, restores `stopped:false` if a racing timeout already
wrote a terminal projection, takes a loud non-terminal warning, and replays neither receipt nor binding — while
only a proven-dead one publishes the terminal record, through the ordinary transition/watch path so a parent
watcher is notified and the row cannot sit queued while claiming a launch is in progress. Witness and recovery
write are ONE locked decision. A readiness diagnostic is launch-phase evidence only until a later authored
lifecycle event lands; after that event it is moot and must not overwrite the declaration's note. [[launch]] owns
the window and the terminal reason.

An explicit successful `session resume` is a new runtime attempt, not a continuation of a terminal launch or turn
failure: it clears the prior `error` lifecycle and its failure note, publishes the resumed conversation as `idle`
until a real activity hook makes it `active`, and never leaves an online worker represented as `error`. Waiting
declarations (`asking`, `parked`, or an `awaiting` proposal) remain waiting declarations when resumed; only the
terminal error state is reset by this explicit recovery operation.
During the one-time JSON-to-application cutover, a legacy active record may still lack a native harness session
identity and runtime binding. Dispatch does not strand that record behind a false `ok`: the record's adapter-owned
rendezvous transport remains its exact legacy identity, so the canonical queue may drain through that transport and
then dequeue the delivered message. This exception is limited to Claude records missing the harness session id;
new records and other records with a binding problem remain fail-closed until their runtime binding is repaired.
Cross-feature defaults that must be read by the backend at runtime live here as the
shared implementation seam — for example [[launch]]'s `sessions.maxActive` fallback value — while the feature
node still owns the user-facing policy and slot semantics. Each session feature ([[state]], [[launch]], [[dispatch]], [[session-follow]],
[[session-selectors]], [[agent-reply-channel]], [[spec-pointer]]) specializes a slice of it and lists it
under `related:`, so a change here attributes its drift and eval staleness to this one owner instead of all of them
(see [[governed-related]]). That several features hold no code of their own is the honest signal that
`sessions.ts` remains a monolith outside the record seam; future code splits can let each feature reclaim ownership.

The shared layer also reconciles each executing governed record (`status: active`) with its adapter's optional
native turn-failure subscription. Waiting states (`asking`, `awaiting`, and `parked`) have no native turn and do
not hold an observer. It owns subscription lifetime across backend replacement and record stop/archive/retirement,
admits native subscriptions one at a time during reconciliation so a backend restart cannot fan out expensive
resume handshakes, with bounded backoff after a transport disconnect, but no
product protocol: subscription and failure mapping remain adapter work ([[harness-adapter]]). Every reported
failure reaches one record-locked compare-and-set that changes only a live, undeclared `active` record to `error`.
A declaration that landed first is authoritative, so a late process close, delayed native completion, or
restart reconciliation cannot overwrite it.

The record's existing `name` is the one human display override: CLI creation may set it once with `--name`, and
rename later replaces or clears that same field. It affects only the shared label/title projection;
the branch, worktree slug, and stored prompt title retain their own responsibilities.

**Exclusion lives in the lock, never in a privileged process.** The per-session record lock implementation lives at
`spec-cli/src/session-record-lock.ts`: a filesystem lock with a PID liveness check, held across processes, so a session operation may run in whatever process
takes it — a backend is the convenient owner of the launch environment and a shared cache, not the holder
of the invariant, and a read that takes no lock needs no permission from anyone. That is what lets this
layer be a brick an external system can drive rather than a service it must be granted access to.

A text send delegates its record-locked append-plus-queue acceptance to the canonical application and the local record lock; an
agent-attributed send also fences its named sender in sorted order. Before a new append, sessions-core asks the resolved adapter's optional
transport witness. Its proven-unreachable answer becomes a stranded refusal only when this layer's independent
registered-pid witness still proves the worker alive; an unproven transport remains queue-retryable and does not
change liveness. Close keeps the sender lock while it publishes the retained archived record, so a stale process
cannot append after close returns. Both locks release
before the adapter poke: a native turn can synchronously invoke lifecycle hooks that re-enter the record writer,
so no record lock spans the handover. The delivery queue's own lock is what makes a handover exactly-once and
recognizes revoked unhanded debt, while normal adapter/runtime guards remain the authority for concurrent
lifecycle operations. A successful dequeue of a human-originated prompt is the wake boundary: it reopens a
waiting (`parked`, `asking`, or `awaiting`) lifecycle to `active` immediately, even when later delivery debt
remains queued; an accepted-but-undelivered message stays waiting. Direct close asks the resolved adapter whether the current record derives one exact native
target identity. That adapter capability, not the presence of the storage alias `harness_session_id`, selects the
ordinary exact cold-stop/close path; no lifecycle branch names a harness or treats lifecycle status or
liveness as identity. A record with no derivable native target remains on the narrower unbound-residue retirement
path and fails closed while any local worker ownership is live or unproven.
The unbound-residue close guard is time- and liveness-bounded. It may refuse only while readiness is still within
its recorded deadline, or while a host process/transport is live or unproven. Once that deadline has passed, or
the exact host process/transport is proven absent, `close` proceeds through the normal archive and worktree
cleanup path even when the first-turn payload or launch artifact remains for audit/retry.

Close may carry an opaque adapter cold-preflight receipt across its exact leaf/tmux stop, into the same adapter's
cold commit, and through archive-ref publication. This shared layer forwards that one in-memory
object without inspecting it, persisting it, or exposing a recursive/public option; the adapter revalidates its own
receipt before the stop guard may admit a known native descendant collection. If publication fails after cold commit,
the same object authorizes adapter compensation of the original collection. A missing, forged, stale, or changed
receipt retains the ordinary descendant refusal before shared-runtime mutation and cannot authorize compensation.

A launch is likewise refused **before** a window opens when the transport can already settle it: no worktree,
no branch, no resolvable launcher command, or a rendezvous owner's derived socket pathname at/over its OS byte
limit. Those are facts about this machine that no number of attempts can change, so each is one loud refusal
carrying its own code — never a launch that fast-exits and is retried on a wall clock ([[launch]]). The
rendezvous check is a generic `ownsRendezvous` preflight and the adapter owns its derivation; it runs during
creation before any candidate resource exists and again before its launch-time stamp. What the transport cannot
settle stays with the bounded readiness retry, and what only the harness can recognize is the harness's to
declare ([[harness-adapter]]).

Session records may also carry `diff_comments`, the durable review conversation for the branch diff document
([[diff-document]]). Each row has a file path, an inclusive line range, the diff identity it was authored against,
body text, and nullable `sent_at`. The record writer owns this array under the ordinary session lock. Editing a row
replaces its body/range/identity and clears `sent_at`; sending uses the existing `sendText` channel and marks the
selected rows sent only after acceptance, so a changed comment cannot be silently replayed.

**Four of this module's concerns are big enough to answer for themselves.** How the record file is written and
what reading it can mean are [[record-integrity]]'s; the one recovery control for a record that cannot be parsed
is [[record-quarantine]]'s; the authority question a public create asks before it may use the local path, and the
fork point it pins and records, are [[session-create-authority]]'s; and the invariant that keeps a human's prompt
from being read as machinery is [[prompt-operand]]'s. Each anchors on the function in `sessions.ts` that
implements it, so its drift is its own.
