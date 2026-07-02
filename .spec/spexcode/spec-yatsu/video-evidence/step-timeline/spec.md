---
title: step-timeline
status: pending
hue: 140
desc: An optional, framework-neutral sidecar that maps a moment in a video to a named step, so an annotation can land on a step. SpexCode owns the tiny format; any emitter writes it.
related:
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/evaltab.ts
---
# step-timeline

For an annotation to land on a *step* ("at the login step the spinner hung"), a video reading
([[video-evidence]]) needs a map from video-time to step. step-timeline is that map: a companion
content-addressed blob — an ordered list of `{tMs, step}` on the clip's own clock. The step at a moment T is
the last event at or before T; that lookup is the whole of "which step is this".

The seam SpexCode owns is the **format**, never a test framework. A small userland emitter (start / mark a
step / flush) stamps each step against the recorder's clock while it records; a Playwright reporter, a
WebDriver listener, or a computer-use hand narrating each action are all just emitters of the one format —
so scripted and ad-hoc measurement share a single contract and no framework is privileged. Aligning the
emitter's clock to the clip is the emitter's own job.

Built **only when a real annotation workflow needs it** — the clip alone is already first-class evidence
without it. Deliberately out of scope: keyframe/highlight markers beyond a plain step, any on-video caption
rendering, any authoring UI, and any lifecycle beyond writing the map.
