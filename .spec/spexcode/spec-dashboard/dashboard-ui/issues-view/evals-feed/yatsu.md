---
scenarios:
  - name: feed-current-loss-video-first-title-only
    tags: [frontend-e2e]
    description: >
      With at least one fresh video reading filed (spex yatsu eval --video … --timeline …), open #/forum
      in a real browser (board `f` or the URL). Read the real DOM: the evals group leads the LEFT list,
      its default kind chip, the rows' media-element count; count /api/board requests fired by opening the
      page; select a video row and read where its media renders.
    expected: |
      The evals group is the left list's FIRST group with its chips in a sticky head; the default kind
      filter is `video` (falling back to `image` when no fresh video reading exists). Rows are the LATEST
      reading per (node, scenario), fresh only, newest first — title-only ALWAYS: zero <video>/<img>
      elements in the list. Opening the page fires ZERO extra /api/board fetches (the group rides the
      app's one poll via props). Selecting a video row renders it in the RIGHT detail pane as the
      annotator — the only place its <video> exists.
---
# evals-feed loss

YATU through the real browser: drive the actual left-list group over a real backend with a real video
reading and read the DOM the user sees — the chip state, the row set, the media-element count, the
request count — never the flatten helper in isolation.
