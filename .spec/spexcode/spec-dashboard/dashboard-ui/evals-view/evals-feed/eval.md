---
scenarios:
  - name: feed-current-loss-video-first-title-only
    tags: [frontend-e2e]
    description: >
      With at least one fresh video reading filed (spex eval add --video … --timeline …), open #/evals
      in a real browser (board `f` or the URL). Read the real DOM: the rows' element tag + hrefs, the
      kind dropdown's default value, the rows' media-element count and any row-level human-ok action;
      count /api/graph requests fired by opening the page; open a video row and read where its media
      renders.
    expected: |
      The list is the page itself — the kind dropdown in a sticky head; the dropdown's
      default value is `video` (falling back to `image` when no video reading exists). Rows are the LATEST
      reading per (node, scenario), newest first — title-only ALWAYS: zero <video>/<img>
      elements in the list — and each row is a REAL <a> anchor to its detail address. Opening the page
      fires ZERO extra /api/graph fetches (the group rides the app's one poll via props). Opening a video
      row lands on its detail page — the only place its <video> exists and the only visible human-ok
      write door. Rows carry settled human-ok status only; an un-ok'd row exposes no ok action.
  - name: stale-not-hidden-mixed-by-time
    tags: [frontend-e2e]
    description: >
      With BOTH fresh and stale readings on the board (a node whose governed code changed after some of
      its readings), open #/evals?kind=all in a real browser. Read the real DOM:
      are stale rows (the muted ✓/✗) present in the list, is the order purely by time (a stale reading
      newer than a fresh one sits ABOVE it), and does the sticky head carry ANY control besides the
      dropdowns?
    expected: |
      The list shows fresh AND stale readings together, ALWAYS — a stale row is never hidden, and there is
      NO stale toggle: the head's controls are the kind dropdown and the session scope picker (no `N
      stale` chip exists anywhere on the page). The order is strictly newest-first regardless of
      freshness (a newer stale reading appears above an older fresh one); a stale row's only stale signal
      is its muted ✓/✗ mark. No reading ever silently disappears behind the default view.
  - name: kind-dropdown-video-image-all-only
    tags: [frontend-e2e]
    description: >
      Open #/evals in a real browser against a board that also holds non-media readings (blob-less
      note-only verdicts and/or transcript-only readings). Read the kind dropdown's options from the real
      DOM and compare its element/class with the Issues page's store filter. Pick `image`, recount rows
      against /api/graph; pick `all` and recount; read a blob-less row's kind tag.
    expected: |
      The dropdown offers EXACTLY three options — video · image · all — never note, never transcript; and
      it is the SAME shared control as the issues store filter (one component, same select element and
      `fv-filter` class). `image` claims ONLY rows whose reading holds a real image blob (blob-less count
      under it: zero); blob-less and transcript-only readings surface under `all` alone. A blob-less row
      carries no media tag (never `img`/`vid`), and its detail page renders its verdict note as TEXT —
      no <video>/<img> element and no empty media box.
  - name: filters-live-in-the-url
    tags: [frontend-e2e, desktop]
    description: >
      Open #/evals and record history.length. Pick a non-default kind and read location.hash +
      history.length; toggle the ok chip and re-read; reload the browser at the resulting address and
      read the dropdown/chip state from the DOM; drive browser Back twice and read the state after each
      step.
    expected: >
      Every filter pick REWRITES the address (?kind=…, ok=1, live=1) as a history PUSH — Back walks the
      filter history, GitHub's semantics — and the list re-derives its WHOLE state from the URL on every
      hashchange: a reload at a filtered address renders exactly that state, and each Back step restores
      the previous filter state exactly. No component-local filter state survives that the address
      doesn't name.
---
# evals-feed loss

YATU through the real browser: drive the actual list page over a real backend with a real video
reading and read the DOM the user sees — the dropdown state, the row set, the anchor hrefs, the
media-element count, the request count — never the flatten helper in isolation.
