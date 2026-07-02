---
concern: forge replies unify: comment on a GitHub issue FROM the forum page [[issues]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: issues
created: 2026-07-02T17:05:07.159Z
---

User-ordered design (原话:'GitHub issue 也可以在上面做评论…replay 之后 GitHub 会把评论数据也加到 GitHub issues 里面,这种统一才是真正的统一。都只是对于数据源的一种显示罢了').

READ half: forge issue comments become the Issue's replies[] — the driver gains listComments (or comments ride listIssues via gh --json comments; watch rate cost — resident cache TTL covers), mapped {by: author, at, body} — the SAME Reply shape local threads have. The detail pane then renders both stores' threads identically (it already renders replies[] — zero view change for display).

WRITE half: replying to a forge issue posts a REAL GitHub comment — ForgeDriver gains createComment({number, body}) (gh issue comment), the port's second write verb, same seam discipline as createIssue (driver = only network toucher; tracer stays read-only). /api/issues/:id/reply routes by store: local → forumReply (unchanged), github#N → createComment then refresh. The composer stops being local-only; the 'forge read-only' hint dies.

@-mention semantics stay uniform: an @session/@new in ANY reply dispatches (mentions.ts already store-agnostic — it fires on the reply TEXT, not the store); that is the user's 'assign an issue to an agent/session/new session' — no new assign machinery, the mention IS the assign.

MEASUREMENT: real gh round-trip (comment lands on a probe issue + shows back in spex issues --json replies[]), detail-pane browser YATU both stores, @new dispatch from a forge reply.
