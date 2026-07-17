---
title: video-evidence
status: active
hue: 140
desc: A recorded video is a third evidence kind — evidence with a time axis. It folds onto the existing evidence engine; only the enum and one render arm grow.
related:
  - spec-eval/src/cli.ts
  - spec-eval/src/sidecar.ts
  - spec-eval/src/evaltab.ts
  - spec-eval/src/sessioneval.ts
  - spec-dashboard/src/Evidence.jsx
  - spec-cli/src/guide.ts
  - spec-cli/src/help.ts
  - spec-cli/src/index.ts
---
# video-evidence

A eval reading's evidence is a **list** of content-addressed entries, each typed by its `kind` ([[eval-core]],
[[evidence-kind-taxonomy]]) — `image` | `transcript` | `video` | `data`. A video is a screenshot with a time
axis: the **same** primitive, one more kind of entry. For a scenario whose loss is a *temporal user loop* (a UI surface), a recording of the loop is
the truest evidence — the author's choice per scenario, routed by its tag, not a forced default — and it can
ride in the same reading as N stills of the same run.

**When to record is taught, not left to taste** — a capability nobody is told to use decays into a dead
enum (every re-measure quietly files an `--image`, and the video pipeline starves). The routing rule is
one sentence, stated where every measuring agent actually reads: *behaviour that MOVES or is timed*
(terminal scroll/redraw, an animation or transition, media playback, a multi-step interaction flow,
keyboard timing) *records a `--video`* — a still of a moving thing proves the wrong thing; a *static end
state* (layout, an icon, copy, one frame) screenshots `--image`; *backend/CLI* files a `--result`
transcript. The rule lives on three surfaces that must agree: `spex guide eval`'s MEASURING AND FILING
section (the manual, with the full flag row — repeatable `--image`, `--result`, `--video [--timeline]`),
`spex help eval`'s usage block (the map), and the `.plugins/core` system prompt's eval paragraph (the
always-on clue every dispatched or self-launched agent carries). Guide and help must show `--video` in
the eval usage they print — a manual that only teaches `--image` is how the gap happened.

The whole point is that almost nothing is new. `spex eval add --video <clip>` stores the bytes in the same
shared cache and pushes one `video` entry onto the reading's evidence list (`spex blob put` is the same
transport WITHOUT a reading, [[evidence-put]]); the MIME is sniffed from content
(WebM / MP4) so `/api/evidence` streams a playable type — and answers **byte ranges**, without which a browser
clamps every seek to 0. The endpoint also accepts an **ignored trailing `.<ext>`** on the hash
(`/api/evidence/<hash>.webm`): third-party markdown renderers (GitLab, GitHub) decide image-vs-video by the
URL's extension and sanitize raw `<video>` HTML away, so a suffix is the only way an MR note embeds a
playable clip — the suffix is pure decoration, stripped before lookup, and never influences the served
bytes or MIME (a wrong suffix still serves the true content); every dashboard home renders the `<video>` inline through the ONE shared evidence
renderer ([[event-detail]]'s `Evidence.jsx` — the eval tab [[eval-tab]], the session proof
([[session-eval]]), and an issue/eval thread's blob links alike), lazy on
expand, with the same *miss original file* when the blob is pruned; `spex eval ls` labels it. A clip is
heavier bytes, so [[eval-core]]'s `clean` (which walks every evidence entry) is the intended prune.

An optional refinement — anchoring named steps to positions on the evidence so an annotation can land on a
step — is [[step-timeline]], a separate format built only when a real annotation workflow needs it. It
OUTGREW this node: a step-map anchors to the evidence's own axis, and a video is merely its `time`-axis
instance — the same map rides a transcript (`line`) or a still sequence (`frame`) just as well, so
step-timeline is modality-neutral and no longer welded to the clip (a video step-map's legacy `{ tMs }` shape
still reads losslessly as the time axis). eval still runs nothing: it records a clip something else
recorded, and the measuring hand stays a metadata tag.

A human who disagrees with **this** node's verdict simply files their own `manual@1` reading — the existing
supersede-by-a-newer-reading path, not a new lifecycle. A finding that is *not* this node's clean fail — a
cross-cutting problem, or one belonging to **another** node — is instead a **concern raised on the
responsible node** (a local or forge issue through the unified Issue port — [[local-issues]]'s one Issue
type, whose typed `evidence[]` carries the hash), pointing at the
clip by its evidence hash — and the thread PLAYS that clip inline through the same shared renderer, so the
concern's evidence is watchable where the concern is read; not a hedged verdict here. So video keeps eval's
verdict binary and routes the "needs another look" elsewhere it belongs.
