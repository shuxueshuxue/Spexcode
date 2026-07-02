---
concern: forge replies unify: comment on a GitHub issue FROM the forum page [[issues]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: landed
nodes: issues
created: 2026-07-02T17:05:07.159Z
---

User-ordered design (原话:'GitHub issue 也可以在上面做评论…replay 之后 GitHub 会把评论数据也加到 GitHub issues 里面,这种统一才是真正的统一。都只是对于数据源的一种显示罢了').

READ half: forge issue comments become the Issue's replies[] — the driver gains listComments (or comments ride listIssues via gh --json comments; watch rate cost — resident cache TTL covers), mapped {by: author, at, body} — the SAME Reply shape local threads have. The detail pane then renders both stores' threads identically (it already renders replies[] — zero view change for display).

WRITE half: replying to a forge issue posts a REAL GitHub comment — ForgeDriver gains createComment({number, body}) (gh issue comment), the port's second write verb, same seam discipline as createIssue (driver = only network toucher; tracer stays read-only). /api/issues/:id/reply routes by store: local → forumReply (unchanged), github#N → createComment then refresh. The composer stops being local-only; the 'forge read-only' hint dies.

@-mention semantics stay uniform: an @session/@new in ANY reply dispatches (mentions.ts already store-agnostic — it fires on the reply TEXT, not the store); that is the user's 'assign an issue to an agent/session/new session' — no new assign machinery, the mention IS the assign.

MEASUREMENT: real gh round-trip (comment lands on a probe issue + shows back in spex issues --json replies[]), detail-pane browser YATU both stores, @new dispatch from a forge reply.

<!-- reply: aebad800-9402-454c-b0b2-2a5e10133e28 @ 2026-07-02T18:03:31.096Z -->
Landed on node/issues-aeba (fd7763b, merge proposed). Built exactly per the design. READ: ForgeIssue carries comments riding the SAME list reads (gh --json comments on the full list; the REST incremental window fetches commented updated issues' threads alongside — rate cost stays a handful of calls, TTL covers), mapped {by,at,body} into replies[] at the adapter — both stores render as one thread. WRITE: ForgeDriver.createComment (gh issue comment) is the port's second write verb; ONE store-routed replyIssue serves both /api/issues/:id/reply AND spex propose reply — local commits to the forum, github#N posts a real comment; the detail pane's composer now serves both stores and the 'forge read-only' hint is deleted (i18n keys removed). @-mentions verified store-agnostic, not rebuilt — an @new in a forge reply dispatched a real session bound to the issue's node (then closed). Measured per plan on probe github#28: CLI + API + browser-composer legs all round-tripped (comment on GitHub via gh issue view, back in spex issues --json replies[]); browser YATU of both stores' threads filed; probe comments deleted + issue closed. One find-and-fix along the way: the post-write resident read-back had a watermark race (a lagging REST since-read could advance past the just-posted comment, hiding it until the 30-min full reconcile) — the forced refresh now does a FULL re-list. Also restored the issues yatsu's malformed degrade scenario and gave it its first reading.
