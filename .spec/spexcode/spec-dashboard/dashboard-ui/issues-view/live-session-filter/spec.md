---
title: live-session-filter
status: active
hue: 200
desc: One "N live" toggle chip on the review pickers' chip row — the issues list and the evals feed each narrow to the entries a LIVE session is behind (issue originator/reply authors; a reading's filer), reusing the originator chip's one liveness join (session.js liveSession), never a second aliveness judgment.
code:
  - spec-dashboard/src/session.js#liveSession
related:
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/EvalsFeed.jsx
  - spec-dashboard/src/Thread.jsx
---

# live-session-filter

## raw source

A reviewer triaging the drain often wants the subset an agent is still BEHIND — an issue whose
originating session is alive can still be steered or asked, while an orphaned one is archaeology. The
human asked for a small chip that narrows the issues list — and, as the same feature's second surface,
the evals feed — to exactly those entries, using the aliveness the originator chip already shows.

## expanded spec

- **One chip, two surfaces, one judgment.** Both the [[issues-view]] list and the [[evals-feed]] carry an
  **"N live"** toggle chip on their head's CHIP row (second row — the control row is for filters/New).
  Same `ef-chip` grammar and toggle interaction as the concluded-count chip: click narrows, click again
  releases; the chip hides itself when nothing is live (N = 0), like every self-hiding filter control on
  these bars — **but self-hiding is gated on the filter being OFF**. A live filter drives its own liveness
  count toward zero (the very sessions it keeps close normally right after their merge), so a chip that
  vanished at N = 0 *while the filter was on* would strand the surface empty with no way to release it —
  the one control that clears the filter is the chip itself. So while the filter is on the chip stays
  mounted even at N = 0 (it may read "0 live"), always releasable; it only disappears once the filter is
  off. A filter must never be able to hide its own off-switch.
- **Live means: a session behind the entry is still alive.** For an issue, that is its originator
  (`issue.by`) or any reply author; for a reading, its filer (`by`). Aliveness is the ONE join the
  originator chip already renders — `session.js`'s `liveSession` (listed on the board and not offline,
  [[state]]'s zones) — so the chip-filtered list and the detail's liveness dots can never disagree; this
  node owns that shared helper, and no surface grows a second aliveness judgment. A non-session author
  ('human', a github login) is honestly not live.
- **N counts what the chip would keep** among the rows the other filters already show, so the label reads
  as "this many of these are live", not a global stat.
