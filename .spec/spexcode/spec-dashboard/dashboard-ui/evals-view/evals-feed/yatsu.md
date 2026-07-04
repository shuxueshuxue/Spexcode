---
scenarios:
  - name: feed-current-loss-video-first-title-only
    tags: [frontend-e2e]
    description: >
      With at least one fresh video reading filed (spex yatsu eval --video … --timeline …), open #/evals
      in a real browser (board `f` or the URL). Read the real DOM: the evals feed IS the LEFT list,
      its default kind chip, the rows' media-element count; count /api/board requests fired by opening the
      page; select a video row and read where its media renders.
    expected: |
      The evals feed is the page's LEFT list with its chips in a sticky head; the default kind
      filter is `video` (falling back to `image` when no video reading exists). Rows are the LATEST
      reading per (node, scenario), newest first — title-only ALWAYS: zero <video>/<img>
      elements in the list. Opening the page fires ZERO extra /api/board fetches (the group rides the
      app's one poll via props). Selecting a video row renders it in the RIGHT detail pane as the
      annotator — the only place its <video> exists.
  - name: stale-not-hidden-mixed-by-time
    tags: [frontend-e2e]
    description: >
      With BOTH fresh and stale readings on the board (a node whose governed code changed after some of
      its readings), open #/evals in a real browser with the kind chip on `all`. Read the real DOM: are
      stale rows (the muted ✓/✗) present in the default list, and is the list ordered purely by time
      (a stale reading newer than a fresh one sits ABOVE it)? Then click the `N stale` chip and re-read
      the rows.
    expected: |
      By DEFAULT the feed shows fresh AND stale readings together — a stale row is NOT hidden — and the
      order is strictly newest-first regardless of freshness (a newer stale reading appears above an older
      fresh one). The `N stale` chip is an opt-in NARROWING, not a hide: with it OFF every latest-per-scenario
      reading shows; clicking it ON leaves ONLY the stale rows (the fresh ones drop out); clicking again
      restores the mixed list. No reading ever silently disappears behind the default view.

  - name: blobless-reading-honest-note-kind
    tags: [frontend-e2e]
    description: >
      With blob-less readings on the board (spex yatsu eval … --note only, no --image/--video/--result),
      open #/evals in a real browser. Cross-check /api/board: readings with no blob vs the rows each kind
      chip claims. Click the `note` chip, read the rows' kind tags; click `image`, recount; select a
      note row and read what the detail pane renders.
    expected: |
      A blob-less reading's row tag reads `note` — never `img`/`vid`. The `image` chip claims ONLY rows
      whose reading has a real image blob (blob-less count under it: zero); `note` claims exactly the
      blob-less rows. Selecting a note row renders its verdict note as TEXT in the detail pane — no
      <video>/<img> element and no empty media box.
---
# evals-feed loss

YATU through the real browser: drive the actual left-list group over a real backend with a real video
reading and read the DOM the user sees — the chip state, the row set, the media-element count, the
request count — never the flatten helper in isolation.
