---
title: archive
status: active
hue: 280
desc: Shelving — a third orthogonal axis that files a session out of the working set without stopping, moving, or discarding anything.
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/client.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/session.js
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/sessionCommands.js
  - spec-dashboard/src/sessionToolbar.test.mjs
  - spec-dashboard/src/styles.css
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
it keeps worktree, branch, transcript, and record). Shelving is that same promise made *visible*, not a new
kind of teardown.

## expanded spec

**Archive is a THIRD axis, orthogonal to both [[state]] axes.** A session carries an agent-authored lifecycle
and a runtime-derived liveness; `archived` is neither. It is the **human's filing decision** — one boolean on
the record, meaning *I am not spending attention here right now*. A shelved session may be working, asking,
parked, or dead; it keeps whatever it was. That orthogonality is the whole design, and every surface honors it:
nothing reads `archived` as a status, and shelving never rewrites one.

**It is the attention verb, and it stops nothing.** This is the line that must not blur:

- `stop` is the **resource** verb — give the process back. Reversible by `resume`.
- `archive` is the **attention** verb — give the screen back. Reversible by `unarchive`.
- `close` is the **terminal** verb — give the disk back, destroying the work. Not reversible.

So archiving does not kill tmux, does not touch the worktree or branch, and writes no timeline row. The human
composes the two freely: archive a session that is still running, or stop one and leave it in the ordinary
list. Folding a kill into archive would make a cheap reversible act destructive.

The copy does NOT argue this. "Archive" already means *set aside, not destroyed* in every product a human has
used, so a card that insists nothing was stopped or removed is defending a design choice nobody questioned —
it reads as strange precisely because the reassurance implies a danger that isn't there. Surfaces state the
state and the way out, in the house voice the offline panel already set: one status line, one short sub. What
keeps the meaning honest is that the verb genuinely does nothing else, not that every screen says so.

**The record stays a projection, never a log.** `archived` is a declared field in `session.json`'s closed key
set, written like every other. That key set is rebuilt from the typed record on each write and never merged
over what was read, so the file self-cleans: a field retired from the code leaves disk the next time anything
touches that record, and no migration verb or GC pass is needed. This is the discipline a new field buys into,
not an exception it carves out — which is why shelving adds one boolean rather than a shelf store, a
tombstone list, or an append-only archive log.

**Enumeration is existence; filtering is a view.** The board keeps enumerating shelved records — the store is
the existence truth ([[state]]) and a view preference must never decide what exists. Consumers filter:

- the **spec-delta is skipped** for a shelved row. That per-worktree git-history probe is the board's dominant
  per-row cost, and shelving is precisely the human saying to stop spending it here — so a retained archive
  costs one enumerated record and no git walk. Its cached delta is evicted on the next board read, so the
  cache stays bounded by the working set rather than by everything ever shelved.
- `spex session ls` hides shelved rows; `--all` includes them, and naming one explicitly always shows it —
  an explicit selector is the human already saying which row they mean.
- the console's list shows one population at a time.

**The console gives the archive a door, not a zone.** An archived session still *has* a triage zone (needs-you,
running, offline); folding it into the zone vocabulary would destroy the very information you want back on
restore. So the list splits first and runs **both** populations through the same forest machinery — identical
zones, nesting, folding, and row faces on either side. The door is a star, the third of three equal pills in
the list header beside New and Search, and it is **permanent**: a control that appears only when it has
contents cannot be found when you want it, and its absence would be the only thing telling you the archive
exists at all. The count rides the star when there is one and is simply absent at zero. Reaching an archived
session from outside the list (URL, search, an originator chip) lands the view on the side that holds it, the
same promise the ancestor-unfold makes within a list.

Selecting an archived session shows the **archive card**, which outranks both console surfaces and wears the
offline panel's face — the two are one family of "this session is in a state" cards, each with one way out.
Restore is always the primary action; an archived session whose process also died gets relaunch as the
secondary, so one card answers both questions instead of stacking two panels.

**One vocabulary everywhere.** `/archive` and `/unarchive` are board commands in the shared registry
([[session-console]]), so the typed command, the menu row, and its availability come from one definition;
exactly one of the pair is ever offered, keyed on `archived` alone and never on lifecycle or liveness. The CLI
verbs `spex session archive|unarchive <SEL>` and the `POST /api/sessions/:id/archive` route are the same act
through the other two doors.
