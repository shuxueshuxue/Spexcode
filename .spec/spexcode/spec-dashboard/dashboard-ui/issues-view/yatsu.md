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
---

# measuring issues-view

YATU through the REAL running dashboard, never the code: a `spex serve` backend seeded with a local thread,
the worktree dashboard pointed at it, and a headless Chromium that opens the console, clicks the Issues
pill, and reads the live DOM (`.fv-thread`, `.fv-store`, `.fv-concern`, `.fv-chip`, `.fv-count`) +
screenshots it. The loss is the gap between that reading and the spec: one merged store-tagged list in API
order, chips that focus the graph, counts as raw data, local-writable / forge-link-out. (This reading style
is what caught the `t(...)` i18n call-convention crash a build could not.)
