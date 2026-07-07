---
title: step-timeline
status: active
hue: 140
desc: An optional, framework-neutral sidecar that maps a position on a piece of evidence's own axis to a named step, so an annotation can land on a step. Modality-agnostic — a video is just the time axis. SpexCode owns the tiny format; any emitter writes it.
code:
  - spec-yatsu/src/timeline.ts
  - spec-yatsu/src/timeline.test.ts
related:
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/cli.ts
  - spec-yatsu/src/evaltab.ts
---
# step-timeline

For an annotation to land on a *step* ("at the login step the spinner hung"), a reading needs a map from a
position on the evidence to a step. step-timeline is that map: a companion content-addressed blob — an
ordered list of `{at, step}` on the evidence's OWN axis, filed beside the evidence (`spex yatsu eval …
--timeline <json>`, validated LOUD, the reading carrying only its hash as `timelineBlob`). The step at a
position P is the last event at or before P; that lookup (`stepAt`) is the whole of "which step is this",
and it is axis-agnostic.

**The axis is the evidence's, not the clock's.** Each map is tagged by an `axis`: `time` (ms, a video —
[[video-evidence]]), `line` (a transcript by line number), `frame` (a still SEQUENCE by index), `index` (a
bare action ordinal). The set is OPEN by convention — an unknown axis is legal and a reader renders its
positions as bare numbers. So the format is modality- and tool-neutral: a video is not welded in, it is
simply the time-axis instance. A step-map accompanies ANY axis-bearing evidence, and its `axis` must MATCH a
present evidence entry's kind (the CLI's `AXIS_FOR_KIND` gate — a `line` map needs a transcript, a `time`
map a clip); a map for an axis nothing in the reading carries is a misfiling, rejected.

**Lossless back-compat is a hard contract.** The legacy schema `{ v: 1, events: [{ tMs }] }` is forever
accepted — it IS the time axis, read (`normalizeTimeline`) as `{ axis: 'time', at: tMs }`, byte-identical to
a new `{ v: 2, axis: 'time' }`. So an old video step-map and its consumer surface (the review-track's step
bands + m:ss ruler) are undisturbed by the generalization; only the label formatter grew axis cases
(time→m:ss, frame→#123, line→L42, index→3/N).

The seam SpexCode owns is the **format**, never a test framework. A small userland emitter (start / mark a
step / flush) stamps each step at its position on the evidence's axis while the run produces it; a Playwright
reporter, a WebDriver listener, a computer-use hand narrating each action, or a CLI harness stamping line
numbers are all just emitters of the one format — so scripted and ad-hoc measurement share a single contract
and no framework is privileged. Aligning the emitter's positions to the evidence is the emitter's own job.

Its consumer has arrived: the [[event-detail]]'s step RAIL reads this map to name (and, on a video, seek to)
the step an annotation lands on — and, no longer video-welded, the rail renders under a non-video reading
too. A step may carry an **optional owning-node id**, so a finding at that position routes to the node
actually responsible — not necessarily the node under measure. Deliberately out of scope: keyframe/highlight
markers beyond a plain step, any on-evidence caption rendering, any authoring UI, and any lifecycle beyond
writing the map. The scrubber's **extent** (a label denominator / span) is read from the evidence at render
time (a clip's duration, a sequence's count), never stored on the asset — the map stays minimal.
