---
scenarios:
  - name: feed-current-loss-video-first-title-only
    tags: [frontend-e2e]
    description: >
      With at least one fresh video reading filed (spex yatsu eval --video … --timeline …), open the
      dashboard in a real browser and open the evals feed (hud ▶ until the issues-view skeleton hosts it).
      Read the real DOM: the default kind chip, the row list, and the count of media elements in the list
      at rest; expand a video row; press Escape.
    expected: |
      The default kind filter is `video` (falling back to `image` when no fresh video reading exists).
      Rows are the LATEST reading per (node, scenario), fresh only, newest first — and title-only at rest:
      zero <video>/<img> elements in the list. Expanding a video row reveals the scenario's expected and an
      "open & annotate" button — still no <video> in the feed (the annotator owns the only one). Escape
      closes the overlay.
---
# evals-feed loss

YATU through the real browser: drive the actual feed over a real backend with a real video reading and
read the DOM the user sees — the chip state, the row set, the media-element count — never the flatten
helper in isolation.
