---
scenarios:
  - name: feed-current-loss-video-first-title-only
    tags: [frontend-e2e]
    description: >
      With at least one fresh video reading filed (spex yatsu eval --video … --timeline …), open #/evals
      in a real browser (board `f` or the URL). Read the real DOM: the evals feed IS the LEFT list,
      its kind dropdown's default value, the rows' media-element count; count /api/board requests fired by
      opening the page; select a video row and read where its media renders.
    expected: |
      The evals feed is the page's LEFT list with its kind dropdown in a sticky head; the dropdown's
      default value is `video` (falling back to `image` when no video reading exists). Rows are the LATEST
      reading per (node, scenario), newest first — title-only ALWAYS: zero <video>/<img>
      elements in the list. Opening the page fires ZERO extra /api/board fetches (the group rides the
      app's one poll via props). Selecting a video row renders it in the RIGHT detail pane as the
      annotator — the only place its <video> exists.
  - name: stale-not-hidden-mixed-by-time
    tags: [frontend-e2e]
    description: >
      With BOTH fresh and stale readings on the board (a node whose governed code changed after some of
      its readings), open #/evals in a real browser with the kind dropdown on `all`. Read the real DOM:
      are stale rows (the muted ✓/✗) present in the list, is the order purely by time (a stale reading
      newer than a fresh one sits ABOVE it), and does the sticky head carry ANY control besides the one
      dropdown?
    expected: |
      The feed shows fresh AND stale readings together, ALWAYS — a stale row is never hidden, and there is
      NO stale toggle: the head's only control is the kind dropdown (no `N stale` chip exists anywhere on
      the page). The order is strictly newest-first regardless of freshness (a newer stale reading appears
      above an older fresh one); a stale row's only stale signal is its muted ✓/✗ mark. No reading ever
      silently disappears behind the default view.
  - name: kind-dropdown-video-image-all-only
    tags: [frontend-e2e]
    description: >
      Open #/evals in a real browser against a board that also holds non-media readings (blob-less
      note-only verdicts and/or transcript-only readings). Read the kind dropdown's options from the real
      DOM and compare its element/class with the Issues page's store filter. Pick `image`, recount rows
      against /api/board; pick `all` and recount; read a blob-less row's kind tag.
    expected: |
      The dropdown offers EXACTLY three options — video · image · all — never note, never transcript; and
      it is the SAME shared control as the issues store filter (one component, same select element and
      `fv-filter` class). `image` claims ONLY rows whose reading holds a real image blob (blob-less count
      under it: zero); blob-less and transcript-only readings surface under `all` alone. A blob-less row
      carries no media tag (never `img`/`vid`), and selecting it renders its verdict note as TEXT in the
      detail pane — no <video>/<img> element and no empty media box.
  - name: filter-pick-is-never-overridden
    tags: [frontend-e2e, desktop]
    description: >
      Open #/evals with a media reading selected (the default selection). Pick a dropdown kind that HIDES
      the selected row (e.g. `image` while a video-only reading is selected). Read the dropdown value and
      the row set immediately after, and again over the next seconds. Then separately deep-load a
      canonical #/evals/<node>/<scenario> address whose eval the default filter hides, and read the
      dropdown value.
    expected: >
      A human's pick always wins: the dropdown keeps the picked kind and the list narrows to it — the
      selection falls to the first visible row; the filter is NEVER snapped back to `all` because the
      previous selection went hidden (the mustShow widen is one-shot, for a deep-link ARRIVAL only). The
      deep-link case still widens: loading an address the filter would hide flips the dropdown to `all`
      and renders that eval.
---
# evals-feed loss

YATU through the real browser: drive the actual left-list group over a real backend with a real video
reading and read the DOM the user sees — the dropdown state, the row set, the media-element count, the
request count — never the flatten helper in isolation.
