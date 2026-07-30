---
title: session-label
status: active
hue: 290
desc: A session's display name is derived ONCE, server-side — the wire carries label (the stable handle, facts that cannot go stale) + headline (the live line, where a standing declaration outranks every byproduct) and hides the bare name/title parts, so no surface can grow its own naming chain.
code:
  - spec-cli/src/sessionLabel.test.ts
related:
  - spec-cli/src/sessions.ts
  - spec-dashboard/src/session.js
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
---

# session-label

## raw source

A session's name kept rendering wrong somewhere — the @-mention dropdown showed the bare launch-prompt
truncation (even a raw URL) while the list beside it showed the proper derived label. The derivation
existed, consistently, in FOUR places (backend sessionLabel/sessionHeadline, frontend twins), yet any new
surface could still reach for `s.title` and grow a fifth, wrong chain — and repeatedly did. The cure is
not another convention but an impossibility: make the bare parts unreachable, so future code CANNOT touch
the raw name and can only consume the derived one.

## expanded spec

**One computation site.** `toSession` is the single place display strings are derived: `label` — the
STABLE handle (name > node > title > branch > id; tables, selectors, tooltips, search) — and `headline` —
the LIVE line a human reads (name > note > activity > promptPreview > node > title > branch > id, activity
gated on liveness; see [[session-activity]]). Both ride every session on the wire; every surface — CLI tables,
watch/notify lines, the reply-channel footer, board rows, the @-mention dropdown, search — reads them.

**A standing declaration outranks every byproduct.** The headline chain is not "the first non-empty part"; it
is ordered by whether a part is something *said about* this session or merely something the session *left
behind*. Only the top two are statements: `name`, the human's rename, and `note`, the word the session itself
declared. Everything under them is a **byproduct** — a pane title tmux happens to be holding, a truncation of
the launch ask, the topology git happened to name. A byproduct goes on occupying the slot long after the
session stopped producing new ones, and that is the entire defect. An agent that has stopped working stops
updating its pane title, so that title freezes on its last task and outranks the note the agent wrote as it
stopped — the board then shows a correctly-parked agent as one still chasing something it finished hours ago.
And when the launch ask was a pasted URL, `promptPreview`, `title` and `branch` are three copies of that URL,
so every cell below `activity` carries nothing while a detailed note sits unread beside them. Those are one
defect, not two, and one precedence answers both: the session's current word outranks its residue. Neither
half yields to a smaller move — appending `note` to the END of the chain changes nothing, because
`promptPreview` always hits first; and the `liveness === 'online'` gate on `activity` cannot help either, since
it withholds a DEAD session's title while the failure is a LIVE session's title that stopped moving.

`note` may sit that high because it is **never stale**: every lifecycle write replaces it (`markState` stores
`note: opts.note ?? null`), so a stored note always belongs to the state the record currently declares —
mark-active's hot path even reads a leftover note as "stale to clear" ([[state]]). That invariant, not a
per-status whitelist, is what keeps this ONE precedence rather than a branch per lifecycle: there is no state in
which a note is present but obsolete, so nothing needs to ask which state we are in. Draining a queued session
into `active` therefore clears the launch-blocker note it may have stamped — that message was the queued
state's word, not the working session's, and leaving it behind would be the only way to falsify the invariant
the precedence rests on. A note enters as the same one-line preview a prompt gets (first non-empty line,
`HEADLINE_PREVIEW_COLUMNS`): the headline is one line, and the author's full note stays readable where it
already was. That preview is a display **cut of the author's own prose**, so it is owed the same transparency
the table's NOTE column already owed — the declaration echo names it, and names it by the size this constant
actually is ([[state]]). Giving the note a second display surface without saying so would have left a promise
the author was already trusting quietly incomplete.

**Two chains, deliberately — merging them would cost something.** They differ in kind, not merely in content.
Every cell of `label` is a fact that cannot go stale: a rename only a human unwrites, and node/title/branch/id
are fixed at creation. That is exactly what its consumers need — search MATCHING (a handle that renarrated on
every declaration would stop finding a session under the name its human remembers), the avatar/hover tooltip,
mobile's handle-line, `spex review`'s identity line, and `spex ls`'s NODE column, a table that already carries
PROMPT and NOTE in columns of their own. `headline` is the opposite kind of value — what this session has to
say right now — so it is the only chain where a staleness ordering means anything, and the only one a note
enters. A URL-shaped label is thus not the same defect as a URL-shaped headline: for a session launched from a
pasted URL, that truncation IS the identity its human typed and will type again to find it. The repair belongs
to the live line alone; the stable chain has no staleness to repair.

The narrower payloads that are NOT a full session on the wire carry the derived identity too, from the
same seam: the review/merge `ReviewPayload` includes a precomputed `label` (`deriveLabel` over the record's
name/node/title/branch/id), so `spex review` renders THAT — not a re-inlined `node||branch||id` chain that
would skip the rename and the prompt title. This was a real divergence: a node-less session showed its
prompt-derived `name` under `spex ls` but its `branch` under `spex review` — two identities for one session.
The rule is a single seam, not a shared convention: any surface naming who a session is reads a
`deriveLabel`-produced field; none re-derives from the raw parts. The @-mention `sub` line and the board's
worktree-overlay attribution are a different concept (a spec-op source badge, not the session's identity),
and the eval/proof headline is deliberately node-spec-title anchored with no agent-authored claim — those
stay as they are.

**The bare parts don't ride the wire.** There is no top-level `title` or `name` on a session: the parts
live under `raw: { name, title }`, whose only sanctioned consumer is an explicitly raw surface (the rename
prefill must edit the override itself, [[session-rename]] — a derived value there would freeze as a fake
rename). Reaching for `s.raw.title` reads as deliberate in review; reaching for `s.title` returns
undefined and fails visibly. The wire-shape unit test is the executable half of this contract: it asserts
the derived fields exist, the precedences hold, and the bare fields are ABSENT — a future field
"helpfully" re-exposed fails the test before any surface can grow a bypass chain on it.

**The frontend has two doors and no windows.** `session.js`'s `sessionHandle`/`sessionHeadline` read the
wire fields; the legacy client-side chain survives only INSIDE those two functions as the old-backend
fallback, so during a mixed-version window labels degrade gracefully instead of blanking. Every component
imports the doors — none re-derives. The backend keeps `sessionLabel`/`sessionHeadline` as the same two
doors over the precomputed fields for its own display sites.

**The two doors are named for their ROLE, so the wrong one can't be grabbed by reflex.** The stable-handle
door is `sessionHandle`, deliberately NOT `sessionName`: a "name" reads like "the thing to display", and a
dev reaching for it by intuition kept wiring the stable label into a visible one-line title — the divergence
that recurred (the node-menu overlay list showed the label while the board beside it showed the live
headline). Renaming the door removes the trap at its source: `sessionHeadline` is now the only intuitively
"the name" door, so every human-visible one-line title lands on it, and `sessionHandle` is confined to its
three real jobs — the avatar/hover **tooltip**, mobile's handle-line, and search **matching** (the label —
a rename name or the prompt truncation — is the match body even where the headline is shown; raw
id/node/branch fragments are not promised searchable). Which surface reads which is [[session-activity]]'s
"one name, every surface"; naming the doors for their role is what makes that guarantee hold instead of
relying on every author to remember it.
