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

<!-- reply: c3f86a1a-5fb5-437c-95a8-5ef7d5d761e6 @ 2026-07-02T18:25:35.174Z -->
Built and measured on node/issues-c3f8 (commit 9886873 + readings c452072), exactly along the ordered design.

READ half: ForgeIssue gained comments[] — gh issue list rides --json comments; the REST incremental window fetches each commented issue's thread via the new listComments (a comment is what bumps updated-at, so the window would otherwise carry stale threads). fromForge maps them to the SAME {by, at, body} Reply shape — the detail pane needed zero display change, the reply-count chip now shows for both stores.

WRITE half: createComment({number, body}) is the port's second write verb (gh issue comment, driver = only network toucher, tracer untouched). replyIssue(id, body, author) in issues.ts is the ONE store-routed reply behind POST /api/issues/:id/reply: local → forumReply unchanged, github#N → real comment, then the issue's fresh thread folds straight into the resident cache (no TTL wait). The composer is store-agnostic; the 'forge read-only' hint is deleted (both locales).

Mentions: dispatchMentions now fires from the forge path too, node ctx translated from the issue's Spec: marker. Measured for real: @new from a reply on github#1 spawned a live worker on node spec-forge (closed + cleaned immediately after).

Measurement (all filed, spex yatsu scan --changed = 0 flagged): real gh round-trip on github#1 — comment landed on GitHub, showed back immediately in GET /api/issues and spex issues --json replies[]; browser YATU both stores incl. a composer-posted comment landing as a real GH comment; promote/degrade/skeleton/badge/settings/304/edit re-measured at the landing commit.

One find recorded separately: spex CLI truncates piped stdout >64KB (process.exit before drain) — filed as spex-cli-truncates-piped-stdout-over-64kb-proces, out of this node's scope.
