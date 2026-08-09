---
title: archive
status: active
hue: 280
desc: Cold storage — archive proves and stops the exact session-owned runtime, preserves worktree/branch/conversation identity, and exposes only offline history.
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/client.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/session.js
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/sessionCommands.js
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-cli/src/help.ts
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/src/sessionToolbar.test.mjs
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/archive-shelf.e2e.mjs
  - spec-cli/src/session-archive-cold-close.api.test.ts
  - spec-cli/src/session-close-probe.test.ts
---

# archive

## raw source

The board had two ends and nothing between them. `stop` gives the process back but leaves the row sitting in
the list; `close` clears the row by destroying the work. Neither says the ordinary thing a human means about
most sessions: *not this week, but don't throw it away.* Without that verb the list is where every session
that was ever interesting goes to accumulate, and the cost is attention, not disk.

The instinct is to make shelving mean "delete the worktree, keep the branch" — the files are only ~13MB and a
branch rebuilds them in about a second. That instinct is wrong, and measuring says why: a branch ref carries
**committed** work only. What a retained worktree buys is the **uncommitted** state — the half-finished edit
the human will want exactly as they left it. `stop` already understood this ("step away, come back later" —
it keeps worktree, branch, transcript, and record). Archive is the cold-storage form of that promise: it first
reuses the exact stop/cleanup seam, then files the retained identity.

## expanded spec

**Archive is cold-storage filing with one hard invariant: `archived => offline`.** A session keeps its
agent-authored lifecycle, worktree, branch, transcript, and conversation identity, but an archive may be written
only after the existing exact-instance stop guard has safely stopped that session-owned leaf, tmux, and adapter
transport. The shared project app-server/control plane is never touched; sibling references remain loaded. If
ownership or the stop proof is unprovable, archive fails loudly and leaves the record unarchived and visible.
An app-server's transport-local census refusal may retry its complete target proof within the one bounded archive
operation, but never reuses a prior census or retries a semantic ownership, live-turn, descendant, or generation
refusal. A lasting transport failure is still a loud refusal with the record and retained work unchanged.
Before a shared app-server publishes its exact PID/receipt/socket generation, that incomplete observation is a
transport-local publication interval: close or archive may wait within the same bounded proof budget and begin a
fresh census only once all three witnesses agree. A replacement after an established proof is a generation change,
not publication lag, and remains an immediate refusal.
Native thread ownership is unique whether the target is currently loaded or not. A native descendant collection
is runtime owned by its exact ancestor, not a separate Spex session: archive includes every uniquely-owned active
or already-archived descendant at any depth in the same cold transition, while preserving each native conversation
for later same-thread resume. For adapters whose archive RPC can race native child creation, the complete target
subtree census runs again after the mutation and before success. A new, missing, duplicated, or reassigned member
in that interval refuses and compensates instead of filing a false zero-runtime proof.
Archive eligibility reads the target's live native turn state, not its public lifecycle/status projection: a turn in
flight refuses with zero mutation, while a loaded target the runtime reports idle may archive even if a hook-authored
public status still reads working. That live state comes from the census the ownership proof already performs, so
eligibility never costs a transcript read — a target alive for weeks stays archivable.
That rule is for reversible archive. A human-confirmed terminal `close` first passes the same exact target-ownership
guard, then may invoke the adapter's exact native interrupt for its recorded target turn, wait for that turn to settle,
and then repeat the complete cold proof
before deleting anything. An unsupported, rejected, generation-swapped, unknown, or still-active interrupt is a
loud close refusal; it never substitutes a PID signal, changes a sibling, or skips the ordinary cold proof.

For a shared resident adapter, lifecycle mutation uses a target-scoped proof rather than the resource report's
full projection. It first proves the shared PID/start/detached-receipt/socket generation, obtains the paginated loaded-ID
set, and checks the target's active and archived descendant collections. Ordinary stop reads only the exact target
and still refuses a resident descendant subtree. Archive additionally reads each loaded member of the exact owned
subtree, then archives every member that was initially active under one generation fence; members already in the
archived collection are verified but not mutated. Each member's archive budget follows the work that member's
archive actually does. Only a loaded member's archive flushes that thread's persisted rollout before the runtime
commits, so the wait it is given scales with that rollout's measured size, while a member the runtime already
reports unloaded flushes nothing and keeps the ordinary bounded budget. A rollout not yet persisted is zero work
rather than an unknown, because a thread that has started but written nothing has nothing to flush; a rollout that
exists and cannot be measured is unknown and fails closed before any mutation. One fixed per-request ceiling is not
a bound on this operation at all — it only names the transcript size above which archive stops working — so the
ceiling is derived rather than assigned, at a deliberately pessimistic flush rate whose job is to catch a wedged
runtime rather than to predict a flush. An absent target with no descendants may therefore stop or
archive even while an unrelated loaded or unowned sibling is slow or unresponsive; those sibling IDs still protect
the shared root, which the session mutation never signals. A loaded active subtree member, an unknown exact member read, a
member present in both or neither native collection, changed ancestry, duplicate ownership, or a shared-generation
identity change fails closed. A sent archive request that is never answered leaves commit state unknown for the
same reason a generation change does: the runtime may still be executing it. Compensation is not attempted on an
unknown commit, because an unarchive issued behind work the runtime has not finished is itself starved — that
would turn one slow member into a false compensation failure — so the operation reports the unknown commit and
leaves the recorded recovery token for resume to reconcile. Success requires a post-mutation recensus proving parent plus the identical descendant
closure uniquely archived, every subtree member unloaded, and every pre-existing unrelated loaded sibling retained.
The resource report remains the complete projection and may inspect every loaded reference; its latency or an
unrelated turn-read failure is not mutation authority.
Archive compensation is fenced to that same exact original generation at connection, request, and response
boundaries. If the shared generation changes after the archive request, commit state is reported unknown and no
`thread/unarchive` is sent to the replacement generation; recovery remains explicit rather than borrowing new
authority from a process that was never proved by the original preflight. On an unchanged generation, compensation
restores only members that were active before this attempt; an already-archived descendant is never unarchived.
The same opaque preflight receipt remains available until the session record and final offline proof are committed.
If native cold teardown succeeds but record lookup, final liveness, or filing then fails, outer compensation returns
that exact receipt to the adapter so the complete originally-active subtree is restored on the same generation.
Ordinary later resume carries no receipt and restores only the parent conversation.

**It is the attention verb backed by the resource stop.** This is the line that must not blur:

- `stop` is the **resource** verb — give the process back. Reversible by `resume`.
- `archive` is the **cold-storage attention** verb — first perform the same exact stop, then file the record.
- `close` is terminal destruction, but it first completes that same exact cold-runtime transition for every
  launched session. It never deletes the worktree, record, branch, or Codex generation binding while the
  target native runtime is still live or unproven; a failed cold transition leaves the session visible.

After all cold/queued ownership proof and every refusing Codex generation-binding fence pass, close writes an
append-only `close-authorized` project runtime ledger entry before resource deletion. The entry names the exact
target record and a non-authoritative request source: `user` means no session claim was supplied, while
`unverified-session-claim` preserves a CLI-provided id without asserting that the id exists, owns the target, or
authenticated the request. The close route rejects the authoritative-looking `session` kind rather than silently
upgrading a forged value. The ledger outlives the target session directory, so the request context remains
inspectable after a successful terminal close but never grants deletion authority. A refused close writes no
entry and never changes a Codex generation binding into its record-removing phase. Archive remains reversible
only through `resume`, which unarchives before recreating the runtime. Close is not reversible.

Close has three ownership-proof entries into that one terminal result. A live row first uses the ordinary exact
stop proof, then removes its record, worktree, and branch. A proven-cold archived row must not pretend to be
live again just to retire: it verifies that the record's cold proof still binds the target adapter/thread and
that every target-owned PID, tmux window, rendezvous transport, and loaded thread remains absent, then removes
the record, worktree, and branch directly. That cold retirement path sends no signal and neither probes nor
requires ownership of unrelated references on the shared project app-server; archive already returned the
target's runtime. Any target runtime that has reappeared, stale/swapped target identity, unreadable cold proof,
or ambiguous target ownership fails loudly before deletion and leaves the shelf row intact. A live PID is not
ownership by number alone: the shared leaf-identity seam requires a readable process-start token and harness
owner argv. A live PID whose argv proves a different process is a stale artifact and does not block cold
retirement; malformed or unreadable PID/start/argv evidence remains unknown and fails closed, while an argv
owner match remains live-owned and fails. Continuing-cold proof may list loaded IDs and the target's own native
collection/descendants, but it never `thread/read`s or waits on an unrelated loaded sibling.

A prepared `queued` row that has never launched takes the other target-only retirement path. Close serializes
with the drainer on the same session transition/record lock; if close wins while the record is still queued, it
also holds the exact recorded branch/path create-resource lock and proves any matching private creation receipt
retired before stop or deletion. An unretirable receipt leaves the public row and every resource intact, because
the record is the fence that prevents old create authority from reaching a later collision. Once that proof lands, it
verifies that no harness thread identity, tmux window, live/recycled leaf PID, rendezvous transport, ahead
commit, or dirty work exists, then removes the prepared prompt, record, worktree, and branch before releasing
capacity. It sends no signal and asks nothing of unrelated shared references because no target runtime was ever
created. If the drainer wins first, status is no longer queued and ordinary live close owns teardown. Any
target/runtime/work ambiguity fails loudly with the queued row intact. Close reports success and releases
capacity only after worktree, branch, prompt, and record removal have each been proven complete.

Archiving never removes or moves the worktree/branch and writes no timeline row. Success means the exact leaf is
stopped and the record is archived; a failed stop means no archive field change. An archived record is therefore
always offline and consumes no active slot or loaded-thread reference of its own.

For adapters with a shared resident control plane, the read projection consumes one project-wide exact loaded-ID
census, not one RPC per row. A cold proof is current only when that census is healthy and the exact thread is absent;
an externally reloaded or ambiguous thread projects visible with `archiveHazard` even if its historical proof still
matches. A deliberately absent shared root is a healthy empty census only when its registered PID is dead and its
socket has no live listener; stale files alone never prove absence. Explicit close resolves the all-record store,
including cold rows. For a proven-cold row it judges only the target's continuing cold ownership facts, never
unrelated shared-root references, and succeeds/nonzero only according to whether the record is actually removed.

The copy states the cold result plainly: the retained worktree/branch/conversation can be resumed, while the
session-owned runtime is gone. A failed ownership proof is a visible hazard, never a successful archive.

**The record stays a projection, never a log.** `archived` is a declared field in `session.json`'s closed key
set, written like every other. That key set is rebuilt from the typed record on each write and never merged
over what was read, so the file self-cleans: a field retired from the code leaves disk the next time anything
touches that record, and no migration verb or GC pass is needed. Cold filing carries three deliberate projection
fields: `archived` is the visible filing bit, `cold_proof` is the versioned witness bound to the resolved adapter
and exact session/thread identity and is written only after the full leaf/adapter cold proof, and
`adapter_recovery` records a partial/unknown adapter mutation that resume must reconcile before relaunch. Resume
clears the recovery token only after the active collection is confirmed and clears the cold proof before launch;
a failed reconciliation leaves both visible and retryable. These fields are not redundant metadata or a second
archive store: they are the durable visibility and recovery contract that prevents a live runtime being hidden
by a boolean.

**Enumeration is existence; filtering is a view.** The board keeps enumerating shelved records — the store is
the existence truth ([[state]]) and a view preference must never decide what exists. Consumers filter:

- the **spec-delta is skipped** for a shelved row. That per-worktree git-history probe is the board's dominant
  per-row cost, and shelving is precisely the human saying to stop spending it here — so a retained archive
  costs one enumerated record and no git walk. Its cached delta is evicted on the next board read, so the
  cache stays bounded by the working set rather than by everything ever shelved.
- `spex session ls` hides shelved rows; `--all` includes them, and naming one explicitly always shows it —
  an explicit selector is the human already saying which row they mean. The default API/graph/session
  projections likewise exclude archived rows; an explicit archive/history read is the only way to request them.
- the console's list shows one population at a time.

**The console gives the archive a door, not a zone.** Archived history is a flat cold-storage list: it has no
needs-you/running/offline status partitions, no lifecycle triage, and no active subtree counts. The door is a star,
the third of three equal pills in
the list header beside New and Search, and it is **permanent**: a control that appears only when it has
contents cannot be found when you want it, and its absence would be the only thing telling you the archive
exists at all. New and the archive door are mutually exclusive destinations, so opening the shelf clears New's
visual active treatment without changing the selected tab. The star carries **no numeric count** — the archive is a
destination, not a backlog meter — and stays **live**:
a permanently-visible control that silently does nothing reads as broken, so pressing it at zero opens the
archive and says `nothing archived` rather than swallowing the press. Reaching an archived session from outside the list
(URL, search, an originator chip) lands the view on the side that holds it, the same promise the
ancestor-unfold makes within a list.

**The trap was never the empty room — it was a dead exit.** Everything that can open this view reads a board
snapshot, and a snapshot can be stale: the board serves the pre-write value for close to a second after a
record flips, and a session can be restored from the CLI or another tab while you are looking at it. So you
CAN end up looking at an archive that just emptied. That is harmless as long as the star still works; it was
a trap only while the star was inert, because then the one way out did not respond. Guarding the view instead
of the exit fixed the symptom and produced a worse bug — a visible control that does nothing. The human's
toggle is therefore authoritative, and an emptied archive is simply somewhere you can leave. Replacing the
archive/history rows during a refresh must not override that toggle while the selected session id and that
session's archived state are unchanged. Automatic side selection still follows a real selection change or a
change in the selected session's archived state, so deep links and external archive/resume transitions land on
the side that actually owns the selected row without turning ordinary refreshes into navigation.

Selecting an archived session shows the **archive card**, which is an offline cold-storage card with restore as
its only lifecycle exit. There is no relaunch action while archived; `resume` first clears `archived`, then
follows the normal `starting -> online` state machine and preserves the conversation.

**One vocabulary everywhere.** `/archive` is the filing command and `/resume` is the sole restore action. The
CLI `spex session archive <SEL>` and `POST /api/sessions/:id/archive` perform cold filing; the legacy
`unarchive` spelling is only a loud signpost to `resume` and never a record-only mutation. The dashboard card
uses the same resume endpoint, so every restore observes `starting -> online` and preserves the conversation.

Filing is a **row** decision as much as a console one, so it is also on the session row's right-click menu —
one item that names the move OUT of the row's current state rather than a pair where one is always inert. The
row menu treats archive and close as the same deliberate lifecycle boundary: both live in its danger group and
both open a confirm pop-out. Archive remains reversible, but filing a session out of the active working set is
important enough to make the action explicit; the confirm commits through the existing `/archive` route, never
a record-only shortcut. Resume is the inverse cold-row action and remains outside this danger pair.
