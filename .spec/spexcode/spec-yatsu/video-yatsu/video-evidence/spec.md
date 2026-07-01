---
title: video-evidence
status: active
hue: 140
desc: A recorded video is a third yatsu blobKind — evidence with a time axis. The eval CLI, content-addressed cache, lazy blob route, and eval-tab rendering carry it unchanged; only the enum and one render arm grow.
related:
  - spec-yatsu/src/cli.ts
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/evaltab.ts
  - spec-yatsu/src/proof.ts
  - spec-dashboard/src/NodeView.jsx
---
# video-evidence

A yatsu reading's evidence is a content-addressed blob distinguished by `blobKind` ([[yatsu-core]]) —
today `image | transcript`. A video is a screenshot with a time axis: the **same** primitive. video-evidence
adds `video` as the third kind. A measurement filed with a clip stores the bytes in the same shared
common-dir cache, appends one reading carrying `blobKind: video`, and stales on the same three axes as any
other reading. The MIME is sniffed from content, so the blob route streams it with no new branch.

The whole point is that almost nothing changes. The closed union `image|transcript` gains `video`; the
by-content-hash blob route already serves any bytes; the eval tab's evidence pane grows **one arm** — a
video kind renders an inline player beside transcript's block and image's still ([[yatsu-eval-tab]]),
fetched lazily on expand, with the same *miss original file* signal when the blob was pruned. Clips are
heavier bytes, so [[yatsu-core]]'s `clean --keep-latest` is the intended prune — again, nothing new.

Out of scope: anchoring a moment to a step ([[step-timeline]]) and the dispute lifecycle ([[eval-dispute]]).
video-evidence is only the byte channel — the smallest possible collapse that makes "record the loop, file
the clip, watch it in the board" real.
