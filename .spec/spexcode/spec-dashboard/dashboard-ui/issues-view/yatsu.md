---
scenarios:
  - name: renders-merged-issues
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesView.jsx
    description: >-
      Run the dashboard against a backend whose local forum holds a thread (with a signer + a reply). Open
      the session console (Enter), click the Issues pill, and read the rendered DOM; then click the thread
      to expand it.
    expected: >-
      The issues page renders the list in the API's order (no re-sort/rank): the local thread shows a
      `local` store chip, concern, an `open` status badge, author, a clickable node chip, and raw
      "+N signed" / "N replies" counts — never a salience ordering. Expanding it shows its body, each signed
      reply (by · at · body), and a reply composer (local issues are writable in place; a forge item would
      instead carry its permalink and a read-only note). No page errors; the Issues pill sits beside New
      Session in the top row.
  - name: panel-skeleton
    tags: [frontend-e2e]
    code: spec-dashboard/src/FeedSection.jsx
    related: [spec-dashboard/src/IssuesView.jsx]
    description: >-
      On the running issues page, read the section furniture: the pinned section head (title + counts
      summary), the outer container's overflow, and the section body's scroll. Then drive the keys — j/k
      down and up the rows, Enter on the selected row, j deep past the fold — and finally type 'j' inside
      the New-form input.
    expected: >-
      The head is pinned with live counts; the OUTER container never scrolls (overflow hidden) while the
      section body scrolls internally. j/k move a visible selection (net j,j,j,k → row 2); Enter expands
      the selected row in place; deep j keeps the selected row inside the body's viewport (the body
      scrolled, not the panel). A key typed into an input/textarea reaches the input and never moves the
      selection. No page errors.
---

# measuring issues-view

YATU through the REAL running dashboard, never the code: a `spex serve` backend seeded with a local thread,
the worktree dashboard pointed at it, and a headless Chromium that opens the console, clicks the Issues
pill, and reads the live DOM (`.fv-thread`, `.fv-store`, `.fv-concern`, `.fv-chip`, `.fv-count`) +
screenshots it. The loss is the gap between that reading and the spec: one merged store-tagged list in API
order, chips that focus the graph, counts as raw data, local-writable / forge-link-out. (This reading style
is what caught the `t(...)` i18n call-convention crash a build could not.)
