---
scenarios:
  - name: annotate-seek-circle-file
    tags: [frontend-e2e]
    description: >
      On #/forum, select a video reading (carrying a step-timeline sidecar) in the left list. In the
      RIGHT detail pane: click a step on the ruler and read video.currentTime; drag on the paused frame
      and read the created mark's step label; type a comment, file an issue, then file a fail reading;
      switch selection to another row and back.
    expected: |
      The eval detail IS the annotator — full pane height, no modal. The step ruler renders one button per
      timeline event; clicking one SEEKS the video to its tMs (the blob route answers byte ranges —
      without them the browser clamps to 0). A drag creates a circled region whose mark is named by the
      ≤T step and prefilled with the step's owning node. Filing the issue lands a thread on /api/issues
      on the responsible node with typed evidence[] = [clip hash, timeline hash] and the marks as body.
      Filing the reading appends a manual@1 line (verdict + report transcript) to the scenario's sidecar.
      Switching selection resets the working marks — an annotation binds to one reading.
  - name: eval-comments
    tags: [frontend-e2e]
    description: >
      On #/forum select an eval. In the detail pane's comments section under the media: send a first
      comment; send a second; look for the thread in the issues group; send a third containing '@new'.
      Read /api/issues between sends.
    expected: |
      The first comment lazily CREATES a local issue bound by concern 'eval: <node> · <scenario>'
      (nodes:[node], the comment as body) and it renders in place under the media. The second comment
      APPENDS to that same thread — /api/issues holds exactly ONE local issue with that concern (no
      duplicate thread), now with one reply. The thread lists in the issues group like any local issue
      (store chip local, the concern-key row). The '@new' comment dispatches a fresh worker through the
      same write path — the one-line outcome ('@ new→<session>') echoes on the page.
---
# annotator loss

YATU through the real browser over a real backend: the seek, the mark naming, the issue with typed
evidence[], and the manual reading are all read from live surfaces (DOM, /api/issues, the sidecar file) —
never asserted from the component code.
