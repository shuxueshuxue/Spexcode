---
title: video-evidence
status: active
hue: 140
desc: A recorded video is a third yatsu blobKind — evidence with a time axis. It folds onto the existing evidence engine; only the enum and one render arm grow.
related:
  - spec-yatsu/src/cli.ts
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/evaltab.ts
  - spec-yatsu/src/proof.ts
  - spec-dashboard/src/NodeView.jsx
---
# video-evidence

A yatsu reading's evidence is a content-addressed blob distinguished by `blobKind` ([[yatsu-core]]) —
`image` | `transcript`. A video is a screenshot with a time axis: the **same** primitive, a third kind. For
a scenario whose loss is a *temporal user loop* (a UI surface), a recording of the loop is the truest
evidence — the author's choice per scenario, routed by its tag, not a forced default.

The whole point is that almost nothing is new. `spex yatsu eval --video <clip>` stores the bytes in the same
shared cache and appends one reading carrying `blobKind: video`; the MIME is sniffed from content (WebM /
MP4) so `/api/yatsu/blob` streams a playable type; the eval tab ([[yatsu-eval-tab]]) and the session proof
([[review-proof]]) grow **one** render arm — an inline `<video>` beside the image and transcript, lazy on
expand, with the same *miss original file* when the blob is pruned; `spex yatsu show` labels it. A clip is
heavier bytes, so [[yatsu-core]]'s `clean` is the intended prune.

An optional refinement — anchoring named steps to moments in the clip so an annotation can land on a step —
is [[step-timeline]], a separate format built only when a real annotation workflow needs it. yatsu still
runs nothing: it records a clip something else recorded, and the measuring hand stays a metadata tag. A
human who disagrees with an agent's verdict simply files their own `manual@1` reading — the existing
supersede-by-a-newer-reading path, not a new lifecycle.
