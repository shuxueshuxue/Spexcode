---
title: video-yatsu
status: pending
hue: 140
desc: Video verification as a first-class yatsu evidence path — a recorded user-loop clip, step-anchored and human-annotated; the default measuring surface for UI-surface scenarios.
related:
  - spec-yatsu/src/cli.ts
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/evaltab.ts
  - spec-dashboard/src/NodeView.jsx
---
# video-yatsu

## raw source

For a scenario whose loss is a *temporal user loop* — a UI surface tagged `frontend-e2e` / `desktop` /
`mobile` — the truest evidence is a **video of the loop**, not a still. video-yatsu makes that a
first-class yatsu path. It is not a new engine: it is three collapses onto [[yatsu-core]], each chosen so
one yatsu invariant stays intact.

## expanded spec

- **[[video-evidence]]** — a recorded clip is a third `blobKind`, nothing more. The content-addressed
  cache, the lazy blob route, git-derived freshness, and `clean` are reused whole. (Holds: *evidence is a
  content-addressed blob.*)
- **[[step-timeline]]** — a normalized, framework-neutral timeline sidecar anchors any moment in the clip
  to a named step, so an annotation lands *on a step*. SpexCode owns the **format**, never a framework:
  Playwright and the computer-use "stupid user" are equal userland emitters of it. (Holds: *the agent
  measures; yatsu runs nothing.*)
- **[[eval-dispute]]** — a human's annotation does **not** overrule the agent's verdict; it opens a
  *dispute* that **locks** the scenario until an agent or human files a *revision*. Human review of the
  loss is thereby **binding**, not advisory. (Holds: *git is the database — the lock is derived from an
  append-only log, never a stored status.*)

The thesis-level boundary: video is the *default* evidence only for UI-surface scenarios; a backend / cli
scenario's best evidence stays a transcript, chosen by the scenario's tag ([[yatsu-core]]). The measuring
hand stays a metadata tag. yatsu still runs nothing — it records a clip something else recorded and
refuses an action when something else raised a dispute. Tracking an evaluator's *accuracy over time* is a
further edge, deliberately out of scope (see [[eval-dispute]]).
