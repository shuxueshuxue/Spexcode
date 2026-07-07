---
title: session-label
status: active
hue: 290
desc: A session's display name is derived ONCE, server-side — the wire carries label (stable) + headline (live) and hides the bare name/title parts, so no surface can grow its own naming chain.
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
the LIVE line a human reads (name > activity > promptPreview > node > title > branch > id, activity gated
on liveness; see [[session-activity]]). Both ride every session on the wire; every surface — CLI tables,
watch/notify lines, the reply-channel footer, board rows, the @-mention dropdown, search — reads them.

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
three real jobs — the avatar/hover **tooltip**, mobile's handle-line, and search **matching** (search still
matches node/branch/id even where it shows the headline). Which surface reads which is [[session-activity]]'s
"one name, every surface"; naming the doors for their role is what makes that guarantee hold instead of
relying on every author to remember it.
