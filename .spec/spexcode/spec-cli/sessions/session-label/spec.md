---
title: session-label
status: active
hue: 290
desc: A session's display name is derived ONCE, server-side — the wire carries one visible title plus a stable search handle and hides the bare name/title parts, so no surface can grow its own naming chain.
code:
  - spec-cli/src/sessionLabel.test.ts
related:
  - spec-cli/src/sessions.ts
  - spec-dashboard/src/session.js
  - spec-dashboard/src/mentions.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/SessionPicker.jsx
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/test/session-note-title.e2e.mjs
  - spec-dashboard/test/session-label-one-name-everywhere.e2e.mjs
---

# session-label

## raw source

A session's name kept rendering wrong somewhere — the @-mention dropdown showed the bare launch-prompt
truncation (even a raw URL) while the list beside it showed the live pane summary. The derivation existed in
two parallel fields (backend `label`/`headline`, frontend twins), so surfaces could disagree while each was
internally consistent. The cure is one visible `title` computation; every surface reads that field.

## expanded spec

**One computation site.** `toSession` is the single place the visible title is derived. Its precedence is
`name` (a human name supplied by CLI creation or rename) > live `activity` (pane self-summary, while online) > the first meaningful line of
`note` > the first non-URL line of the launch prompt > node > stored prompt title > branch > id. A prompt
whose first line is a bare URL therefore uses the next prose line when one exists. The wire carries this
derived `title`; every surface — CLI tables, watch/notify lines, the reply-channel footer, board rows, the
@-mention dropdown, search, review, and tooltips — reads the same field. `label` remains only as the stable
search handle for compatibility with selectors and historical matching.

`note` remains full-fidelity in the timeline, review output, JSON, and the CLI's explicit NOTE column. Its first
meaningful line participates only after there is no rename or live activity, giving a parked/asking session a
useful current description without losing the declaration itself. The complete note is never truncated in its
own state surfaces.

The stable `label` is retained only for matching and selector compatibility. It is not a second visible name:
CLI tables, `show` and `review` headers, selector ambiguity candidates, watch/notify lines, tabs, lock hints,
dropdowns, and menus all render `title`. Search accepts the stable handle, the current title, and retained raw
rename/prompt/activity/note candidates so a renamed or re-narrated session remains findable under text the human
already saw.

The review/merge `ReviewPayload` retains its precomputed `label` (`deriveLabel` over the record's
name/node/title/branch/id) for machine compatibility, but it is not a display identity. `spex session review`
already resolves its target to a full current Session before it fetches the cockpit payload, so it renders that
Session's `title` rather than re-deriving or borrowing the payload label. This keeps a review title on the same
wire-derived path as every other visible surface without an extra liveness probe. The @-mention `sub` line and
the board's worktree-overlay attribution are a different concept (a spec-op source badge, not the session's
identity), and the eval/proof headline is deliberately node-spec-title anchored with no agent-authored claim —
those stay as they are.

**The bare parts don't ride the wire.** There is no top-level `name`; the raw parts remain under
`raw: { name, title }`, whose only sanctioned consumer is an explicitly raw surface (the rename prefill must
edit the override itself, [[session-rename]]). The derived top-level `title` is the only visible name. The
wire-shape unit test asserts it exists, the precedences hold, and `headline` is absent.

**The frontend has one visible-name door.** `session.js`'s `sessionHeadline` (and its `sessionTitle` alias)
reads the wire `title`; the legacy client-side chain survives only inside that function for an old backend.
Every component imports the door — none re-derives. `sessionHandle` remains the matching/tooltip compatibility
door and never paints a row title.

**The doors are named for their role.** `sessionHeadline`/`sessionTitle` is the only visible-name door;
`sessionHandle` is confined to matching and tooltip surfaces. This keeps a new surface from grabbing a stable
handle by reflex and recreating the old split.
