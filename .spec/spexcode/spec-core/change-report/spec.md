---
title: spec change report
status: active
desc: Deterministic change reports for spec notifications.
code:
  - packages/spec-core/src/change-report.ts
related:
  - .spec/spexcode/session-topology/spec.md
  - packages/spec-core/src/index.ts
---
# spec change report

`buildChangeReport({ repoRoot, rev | range, note?, maxHunkLines?, parentSessionId? })` reads only the named Git
tree and revision window. It emits stable text with one section per changed `.spec/.../spec.md` node: the node id,
one-line description, status, additions/removals in `code:` and `related:` frontmatter (and status changes), and
body diff hunks capped at `maxHunkLines`, with an explicit `git show` path when truncated. Non-spec files are shown
with Git numstat and the governing node resolved from the tip tree's `code:` claims. A change touching only ack
stamps or `evals.ndjson` emits one line stating `仅 ack/eval，正文未变 (empty=true)`. The report ends with the
fixed parent-session reread request; `note` is copied verbatim, or `发送者未说明原因` when absent. No semantic
interpretation or generated explanation is added.

The porcelain `spex spec report` is a thin projection of this function. It names the report node on the CLI
surface, defaults to `HEAD`, and preserves the function's note and parent-session fields. The CLI may suppress
the body for an ack/eval-only diff unless `--always` is requested; the underlying function remains deterministic
and always returns its complete text.
