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
Native thread ownership is unique whether the target is currently loaded or not. For adapters whose archive RPC
can race native child creation, the target descendant census runs again after the mutation and before success;
a descendant appearing in that interval refuses and compensates instead of filing a false zero-runtime proof.
Archive eligibility reads the target's fresh native turn census, not its public lifecycle/status projection: an
`inProgress` turn refuses with zero mutation, while a loaded target whose complete turn census has no
`inProgress` turn may archive even if a hook-authored public status still reads working.

**It is the attention verb backed by the resource stop.** This is the line that must not blur:

- `stop` is the **resource** verb — give the process back. Reversible by `resume`.
- `archive` is the **cold-storage attention** verb — first perform the same exact stop, then file the record.
  Reversible only through `resume`, which unarchives before recreating the runtime.
- `close` is the **terminal** verb — give the disk back, destroying the work. Not reversible.

Close has three ownership-proof entries into that one terminal result. A live row first uses the ordinary exact
stop proof, then removes its record, worktree, and branch. A proven-cold archived row must not pretend to be
live again just to retire: it verifies that the record's cold proof still binds the target adapter/thread and
that every target-owned PID, tmux window, rendezvous transport, and loaded thread remains absent, then removes
the record, worktree, and branch directly. That cold retirement path sends no signal and neither probes nor
requires ownership of unrelated references on the shared project app-server; archive already returned the
target's runtime. Any target runtime that has reappeared, stale/swapped target identity, unreadable cold proof,
or ambiguous target ownership fails loudly before deletion and leaves the shelf row intact. Continuing-cold
proof may list loaded IDs and the target's own native collection/descendants, but it never `thread/read`s or
waits on an unrelated loaded sibling.

A prepared `queued` row that has never launched takes the other target-only retirement path. Close serializes
with the drainer on the same session transition/record lock; if close wins while the record is still queued, it
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
exists at all. The star carries **no numeric count** — the archive is a destination, not a backlog meter — and stays **live**:
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
toggle is therefore authoritative, and an emptied archive is simply somewhere you can leave.

Selecting an archived session shows the **archive card**, which is an offline cold-storage card with restore as
its only lifecycle exit. There is no relaunch action while archived; `resume` first clears `archived`, then
follows the normal `starting -> online` state machine and preserves the conversation.

**One vocabulary everywhere.** `/archive` is the filing command and `/resume` is the sole restore action. The
CLI `spex session archive <SEL>` and `POST /api/sessions/:id/archive` perform cold filing; the legacy
`unarchive` spelling is only a loud signpost to `resume` and never a record-only mutation. The dashboard card
uses the same resume endpoint, so every restore observes `starting -> online` and preserves the conversation.

Filing is a **row** decision as much as a console one, so it is also on the session row's right-click menu —
one item that names the move OUT of the row's current state rather than a pair where one is always inert. It
acts immediately, with no confirm: `close` earns its prompt by destroying work, while a prompt guarding a
reversible act is friction pretending to be care. It sits with the row's other non-destructive actions, never
grouped with close, so a mis-aimed right-click can cost you a moment's confusion but never the work.
