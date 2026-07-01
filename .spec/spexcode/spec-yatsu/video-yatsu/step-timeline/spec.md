---
title: step-timeline
status: pending
hue: 140
desc: A normalized, framework-neutral timeline sidecar that anchors any video moment to a named step. SpexCode owns the format plus the annotator that reads it; Playwright and computer-use are equal userland emitters.
related:
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/evaltab.ts
  - spec-dashboard/src/NodeView.jsx
---
# step-timeline

## raw source

For an annotation to land on a *step* ("at the login step the spinner hangs"), the clip needs a map from
video-time to step. step-timeline is that map: a tiny companion blob of the video reading — an ordered list
of `{tMs, step, kind}` events aligned so t=0 is the clip's first frame, where the emitter **always plants a
boundary at t=0** so no moment falls before the first step. Given a moment, its step is the last boundary
event at or before it — a total lookup, not a heuristic. This is the whole of "auto-locate the step".

## expanded spec

The seam SpexCode owns is the **format**, never a test framework. An emitter is a small userland helper —
start, mark-a-step, flush — that stamps each step against the recorder's own clock while a recorder
captures the same clock, so timeline-time equals video-time by construction. A Playwright reporter, a
WebDriver listener, and the computer-use / human hand narrating each action it drives are all just
emitters of the one format. So a *single* contract carries scripted and ad-hoc measurement; the emitter,
not SpexCode, owns clock-alignment (pin t=0 to the recording's first frame; declare any lead-in offset).
This is what keeps the mechanism framework-generic and folds the "stupid user" in as one more emitter,
not a special case.

The on-clip caption and title context render from the step labels **plus the scenario's own `expected`**,
read live from the yatsu.md scenario ([[yatsu-core]]) — so there is no hand-maintained step-metadata file
to fall out of sync. The timeline rides as a second content-addressed blob on the reading (like the video
blob itself), never a new ndjson column.

Out of scope: the annotation authoring surface and the dispute it can raise ([[eval-dispute]]); the video
byte channel ([[video-evidence]]).
