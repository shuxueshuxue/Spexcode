---
title: session-activity
status: active
hue: 260
desc: Each session row's headline IS the worker's own live one-line self-summary (its tmux pane title), overriding the launch-prompt placeholder; the status word and spec-op count drop to a quieter second line.
related:
  - spec-cli/src/sessions.ts
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
---

# session-activity

## raw source

Each worker already narrates itself: Claude Code keeps its terminal title set to a short summary of the
task in front of it, updated every turn. That signal sits unused in tmux. Surface it on every session row
so a glance answers **what is each agent doing right now**, not merely *which* session this is — the way a
terminal tab renames itself to fit the work.

## expanded spec

**Capture (free, one call).** Claude Code sets its terminal title via an OSC escape; tmux records it as
the **pane title** (never the window name — OSC titles don't touch it). Our worker runs one pane per
session named with the session id, so `listSessions` reads every pane title in a single `list-panes`
snapshot (`paneTitles`) — same shape and cost as the liveness snapshot — and hangs a cleaned summary on
`Session.activity`. The leading status glyph (`✳` idle, braille spinner while working) is stripped: the
dashboard draws its own status, and a frozen spinner frame is noise. Activity is **live and never
persisted** — `null` for any session that isn't up (offline / starting / queued), so a dead or booting row
never shows a stale line. A tmux hiccup drops the line for one tick, never the session.

**Render (two-row face).** The shared session face ([[session-console]]'s `SessionRow`) is two rows. Row 1
is the **headline** — the avatar followed by the one best description of what this session is *about*,
single-line with an ellipsis. The headline prefers the worker's own live self-summary: once the pane title
exists, the agent-generated `activity` line **is** the headline — it tracks what the agent is doing *now*,
sharper than any launch-time label. Before it exists (booting / queued / offline) the headline shows the
first words of the launch prompt (`promptPreview`) as a **placeholder** that the smart label overrides the
moment it arrives, so the human's initial wording disappears once the agent has named its own task. A human
**rename (`name`) still wins** over both — the [[session-rename]] override stays authoritative everywhere.
The avatar (seeded by id) is now the fixed spatial anchor, so the headline is free to renarrate each turn
without the row losing its slot.

Row 2 is the **status line** — the small state badges that used to crowd the headline, moved off it: the
colour-coded status word and the op tally (how many spec nodes this session is changing, e.g. `~2`), in a
smaller, dimmer font spanning the **whole row width** (the face's flex row wraps and the line takes a
full-width basis, so it drops below the avatar too). It is the parking spot for any further at-a-glance
metadata we add later. When this row is the **locked** selection a 🔒 sits at the end of Row 1, and the
status word **stays** on Row 2 (locking no longer hides it). The face is shared, so the top-left window, the
Enter session tabs, and the mobile list all show the identical headline + status line.

**The console header reads the same headline.** The Enter interface's **big-title bar** above the live
terminal ([[session-console]]'s `si-th-name`) renders the SAME `sessionHeadline`, not the stable node name —
so the agent's live self-summary that renarrates the rows renarrates the header in lock-step, and the title
over the terminal never disagrees with the row that opened it. The data source and the content are one
shared line across both surfaces; the **only** difference is room: the header is a wide bar, so it gives the
headline `flex:1` of that width and ellipsises far **later** than the compact rows — less truncation where
there is space for more. The stable `sessionName` is not the displayed title here; it stays the fixed handle
behind tooltips, the lock hint, and search, which must not move turn-to-turn.

This node's slice of the shared `styles.css` is the Row-2 status line (`.sess-meta`, the full-width dimmer
wrap), the Row-1 headline ellipsis, and the console header big-title's room-to-expand (`.si-th-name`'s
`flex:1` + ellipsis — the same headline, more width); classes other surfaces add there — like the yatsu eval
tab's `.eval-*` verdict/transcript rules from the measure-and-score reframe — are those features' churn, not
session-activity's drift.
