---
scenarios:
  - name: video-plays-in-eval-tab
    tags: [frontend-e2e]
    description: >
      File a reading whose evidence is a recorded clip (`spex eval add <node> --scenario <s>
      --pass --video clip.webm`), then open that node's Eval tab in the dashboard and expand the
      reading. Read the real DOM, not the helper: the evidence must render as an inline HTML5
      `<video controls>` (class `eval-video`) whose `src` is `/api/evidence/<hash>`, and that blob
      response must carry a playable video Content-Type. A sibling image/transcript reading in the same
      tab must still render as an `<img>` / `<pre>`, and a legacy scalar-blob reading (no blobKind)
      still as an image.
    expected: |
      The expanded reading shows a `<video class="eval-video" controls>` element that plays the clip
      (not an `<img>`, not a download link). `GET /api/evidence/<hash>` returns Content-Type
      `video/webm` (or `video/mp4`) — the MIME sniffed from the bytes, so the browser plays it inline.
      The reading round-trips through the sidecar as an evidence-list entry `kind: "video"` and rides
      `/api/graph` like any other reading; `spex eval ls <node>` labels its evidence `video <hash>…`.
      Image and transcript evidence are unchanged.
    code: spec-dashboard/src/NodeView.jsx
    related:
      - spec-eval/src/cli.ts
      - spec-eval/src/evaltab.ts
      - spec-eval/src/sessioneval.ts
  - name: evidence-url-ext-suffix
    tags: [backend-api]
    description: >
      Against a live backend holding a video evidence blob, GET /api/evidence/<hash>.webm (a trailing
      extension suffix on the hash), the same URL with a WRONG suffix (.png), the bare-hash URL, and a
      Range request on the suffixed URL. Also probe a garbage name with a suffix (foo.webm).
    expected: |
      The suffixed URL answers exactly like the bare hash: 200 with the STORED Content-Type (video/webm —
      the sniffed MIME, regardless of what the suffix claims, so <hash>.png still serves video/webm), and
      a Range request on the suffixed URL answers 206 with Content-Range. The suffix is decoration only —
      stripped before lookup, never trusted for the MIME. A non-hash name keeps failing loud (400 invalid).
      This is what lets a GitLab/GitHub MR note embed the clip as a real <video> player
      (![d](…/api/evidence/<hash>.webm)), since those renderers pick the player by URL extension and strip
      raw <video> HTML.
    related:
      - spec-cli/src/index.ts
---
# video-evidence loss

YATU through the real product: file a real `--video` measurement, then drive a browser to the node's Eval
tab and read the actual element the reading renders as — an inline `<video>` served from
`/api/evidence` with a video MIME — not the `blobKind` branch in isolation. The MIME sniff
(`sniffBlobMime`) and the CLI filing are the units under it; the measured truth is the clip the browser
actually plays.
