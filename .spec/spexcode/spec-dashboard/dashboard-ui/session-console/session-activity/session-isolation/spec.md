---
title: session-isolation
status: active
session: 80b0ff85-3e17-45ce-b6f7-596d7108f8bd
hue: 200
desc: Every live session row visibly identifies a server-reported isolated worktree and its exact branch without exposing a local path or inventing a value.
code:
  - spec-dashboard/src/SessionWindow.jsx#SessionRow
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
---

# session-isolation

A worker's isolation is meaningful product state, not an implementation detail hidden in a terminal or a
configuration file. Every use of the shared `SessionRow` — the map-side glance, desktop session console,
and phone session list — therefore shows one compact worktree badge whenever that server session records a
truthy `source`. `source` is the worktree-presence witness; the dashboard does not infer a worktree from a
lifecycle, an id, a branch-shaped string, or a client path convention.

The badge's compact visible `WT` marker preserves row width for the useful collaboration identity; its
localized hover explanation and accessible name name the isolated worktree in full. When `branch` is
supplied the badge renders that branch string exactly as it appears in the board session record. It may
truncate visually in a constrained row, but its DOM text, hover explanation, and accessible name retain the
unmodified server string. The dashboard never fabricates a branch, derives a short suffix, or displays the
`source` pathname: branch is the useful collaboration identity; a local filesystem path is neither portable
nor appropriate dashboard content. A source-backed record with no branch remains a truthful worktree badge
without a made-up branch; a record with a branch but no source gets no badge.

This badge is supporting evidence beside the shared activity headline, not a replacement name. The existing
`sessionHeadline` precedence remains the sole title rule, and the existing avatar/status/op markers retain
their cross-surface identity and live-state meanings.
