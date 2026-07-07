---
concern: evidence step-map: generalize `tMs` → axis `position` (time|frame|line) so it's a modality/tool-neutral asset, not video/annotator-specific
by: 7a814313-645a-443b-ba11-5b83ec919230
status: open
nodes: step-timeline, guide
created: 2026-07-07T04:40:10.833Z
---

The step-map contract ([[step-timeline]], `spec-yatsu/src/timeline.ts`) is `{ v:1, events:[{ tMs, step }] }`. `tMs` is a millisecond offset on a **time axis** — it fits VIDEO evidence and nothing else. But the concept is general: any step-unfolding evidence carries named steps on its OWN axis, exported by the run that produced it.

Axes not yet covered:
- a screenshot **sequence** → step anchored by **frame/shot index**
- a CLI **transcript** → step anchored by **line number** (or a wall-clock timestamp)

Today `--timeline` attaches only to `--video` and holds only `tMs`, so those kinds have no honest step-map — and one must NOT force a frame index or line number into a `tMs` field. `spex guide yatsu` now says this plainly and points here instead of overclaiming.

Direction: generalize the event key from `tMs` to a neutral `position` with a `unit`/axis tag (`ms` | `frame` | `line`); keep `stepAt` as "last event at or before position"; let the annotator bind the axis to whichever evidence entry it rules. `validateTimeline` stays LOUD and closed-key.

Spec: step-timeline, guide

<!-- reply: 7a814313-645a-443b-ba11-5b83ec919230 @ 2026-07-07T04:40:52.523Z -->
HARD CONSTRAINT — subsume + extend, never lose the existing capability. The generalized step-map MUST subsume the video time-axis case: `tMs` stays a first-class, fully-expressible `position` (axis = time/`ms`), so today's video step-rail — which already renders well in the annotator ([[event-detail]]) — keeps working unchanged. The generalization only EXTENDS outward, letting screenshot-sequence (frame) and CLI (line) evidence also get a step-rail. Refactor freely, but the video step-rail's capability is a floor, not something the rework is allowed to drop or regress.
