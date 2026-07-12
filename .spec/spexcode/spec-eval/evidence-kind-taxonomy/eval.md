---
scenarios:
  - name: json-result-files-as-data
    tags: [cli]
    description: >-
      Through the real `spex eval add` CLI: file one reading whose `--result` is a genuine JSON export
      (e.g. a hyperfine `--export-json` object) and another whose `--result` is free-form terminal text.
      Read the appended lines in `evals.ndjson` and confirm the stored evidence kind. Then fetch each
      blob through the shared blob route and read its Content-Type.
    expected: >-
      The JSON result is stored with `kind: "data"`, the plain-text result with `kind: "transcript"` — the
      kind is derived from the bytes, not from the flag. The JSON blob's route serves `application/json`
      while the text blob serves `text/plain`, so the stored kind and the served content-type agree.
      `--image` and `--video` filings are unchanged (still `image` / `video`).
    code: spec-eval/src/cli.ts
    related:
      - spec-eval/src/sidecar.ts
      - spec-eval/src/evaltab.ts
  - name: data-renders-as-block
    tags: [frontend-e2e]
    description: >-
      File a reading whose evidence is a structured `data` entry (a JSON export), then drive a real browser
      to the reading's evidence surface and read the actual DOM. Confirm the data renders as a labelled,
      pretty-printed data block (a `.eval-data` region under a `.eval-datahead` header), NOT as a raw
      `.eval-transcript`. In the same view, a sibling transcript/image/video entry must still render as its
      own element.
    expected: >-
      The `data` entry shows as a structured data block — a header labelling it structured data (JSON) above
      a pretty-printed, monospace, validatable body — distinct from a plain transcript. Existing
      image (`<img>`), video (`<video>`), and transcript (`<pre class="eval-transcript">`) evidence render
      exactly as before. An invalid-JSON data blob shows the raw bytes with an "invalid JSON" marker rather
      than silently reading as prose.
    code: spec-dashboard/src/Evidence.jsx
    related:
      - spec-dashboard/src/EventDetail.jsx
      - spec-dashboard/src/EvalsFeed.jsx
---
# evidence-kind-taxonomy loss

Two truths to keep honest. First, through the real CLI: a structured export files as `data`, free-form
output as `transcript`, and the stored kind matches the content-type the blob route serves — one sniff, no
drift. Second, through a real browser: the `data` kind renders as a validatable data block, visibly
different from a scrolling transcript, while image/video/transcript keep rendering as they always did. The
render kind follows the bytes; the floor under the old kinds is never removed.
