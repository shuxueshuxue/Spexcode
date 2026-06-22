---
title: session-activity
status: active
hue: 260
desc: Every session row shows the worker's own live one-line summary of what it's doing now — read free from its tmux pane title.
code:
  - spec-cli/src/sessions.ts
  - spec-dashboard/src/SessionWindow.jsx
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
is **identity** — avatar · name · status word (or 🔒) · op tally — the stable spatial anchor that keeps a
session's slot. Row 2 is the **activity line**: the worker's own summary in a smaller, dimmer font
that spans the **whole row width** (wrapping below the avatar too), single-line with an ellipsis, omitted
when there's no activity. Identity stays put while activity changes each turn, so the two never fight —
the same separation the rename override keeps over the derived label ([[session-rename]]). The face is
shared, so the top-right window and the Enter session tabs show the identical activity.
