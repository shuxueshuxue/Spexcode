---
scenarios:
  - name: renders-the-forum
    tags: [frontend-e2e]
    code: spec-dashboard/src/ForumView.jsx
    description: >-
      Run the dashboard against a backend whose forum holds a proposal (with a signer + a reply) and a note.
      Open the session console (Enter), click the Forum pill, and read the rendered DOM; then click a thread
      to expand it.
    expected: >-
      The info page renders both threads in the API's order (no re-sort/rank): each shows its kind tag
      (proposal | note), concern, an `open` status badge, author, a clickable node chip, and raw
      "+N signed" / "N replies" counts — never a salience ordering. Expanding a thread shows its body and each
      signed reply (by · at · body). No page errors; the Forum pill sits beside New Session in the top row.
---

# measuring forum-view

YATU through the REAL running dashboard, never the code: a `spex serve` backend seeded with a proposal and a
note, the worktree dashboard pointed at it, and a headless Chromium that opens the console, clicks the Forum
pill, and reads the live DOM (`.fv-thread`, `.fv-concern`, `.fv-chip`, `.fv-count`) + screenshots it. The
loss is the gap between that reading and the spec: threads in API order, both kinds, chips that focus the
graph, counts as raw data. (This is the reading that caught the `t(...)` i18n call-convention crash a build
could not.)
