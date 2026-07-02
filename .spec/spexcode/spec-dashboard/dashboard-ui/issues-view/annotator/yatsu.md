---
scenarios:
  - name: annotate-seek-circle-file
    tags: [frontend-e2e]
    description: >
      Open a video reading (carrying a step-timeline sidecar) from the evals feed in a real browser.
      Click a step on the ruler and read video.currentTime; drag on the paused frame and read the created
      mark's step label; type a comment, file an issue, then file a fail reading; press Escape twice.
    expected: |
      The step ruler renders one button per timeline event; clicking one SEEKS the video to its tMs (the
      blob route answers byte ranges — without them the browser clamps to 0). A drag creates a circled
      region whose mark is named by the ≤T step and prefilled with the step's owning node. Filing the
      issue lands a thread on /api/issues on the responsible node with typed evidence[] = [clip hash,
      timeline hash] and the marks as body. Filing the reading appends a manual@1 line (verdict + report
      transcript) to the scenario's sidecar. The first Escape peels only the annotator (the feed stays);
      the second closes the feed.
---
# annotator loss

YATU through the real browser over a real backend: the seek, the mark naming, the issue with typed
evidence[], and the manual reading are all read from live surfaces (DOM, /api/issues, the sidecar file) —
never asserted from the component code.
