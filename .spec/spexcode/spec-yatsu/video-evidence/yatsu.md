---
scenarios:
  - name: video-plays-in-eval-tab
    tags: [frontend-e2e]
    description: >
      File a yatsu reading whose evidence is a recorded clip (`spex yatsu eval <node> --scenario <s>
      --pass --video clip.webm`), then open that node's Eval tab in the dashboard and expand the
      reading. Read the real DOM, not the helper: the evidence must render as an inline HTML5
      `<video controls>` (class `eval-video`) whose `src` is `/api/evidence/<hash>`, and that blob
      response must carry a playable video Content-Type. A sibling image/transcript reading in the same
      tab must still render as an `<img>` / `<pre>`, and a legacy reading (no blobKind) still as an image.
    expected: |
      The expanded reading shows a `<video class="eval-video" controls>` element that plays the clip
      (not an `<img>`, not a download link). `GET /api/evidence/<hash>` returns Content-Type
      `video/webm` (or `video/mp4`) — the MIME sniffed from the bytes, so the browser plays it inline.
      The reading round-trips through the sidecar as `blobKind: "video"` and rides `/api/graph` like any
      other reading; `spex yatsu show` labels its evidence `video <hash>…`. Image and transcript
      evidence are unchanged.
    code: spec-dashboard/src/NodeView.jsx
    related:
      - spec-yatsu/src/cli.ts
      - spec-yatsu/src/evaltab.ts
      - spec-yatsu/src/proof.ts
---
# video-evidence loss

YATU through the real product: file a real `--video` measurement, then drive a browser to the node's Eval
tab and read the actual element the reading renders as — an inline `<video>` served from
`/api/evidence` with a video MIME — not the `blobKind` branch in isolation. The MIME sniff
(`sniffBlobMime`) and the CLI filing are the units under it; the measured truth is the clip the browser
actually plays.
