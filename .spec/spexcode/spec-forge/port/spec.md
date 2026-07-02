---
title: port
status: active
hue: 280
desc: The host-agnostic forge port (ForgeDriver) that READS a host's issues (open + closed, with their comment threads) and open PRs, and carries the unified Issue port's two write verbs (createIssue, createComment), plus its first real driver — github via the gh CLI.
code:
  - spec-forge/src/port.ts
  - spec-forge/src/drivers/github.ts
---
# port

The seam of [[spec-forge]]: a single **host-agnostic port** naming the abstraction, with **per-host
drivers** behind it. The name is the seam, never the vendor.

Unlike a projection, the port **reads the forge**. Its read verbs fetch a host's work objects —
`listIssues() → ForgeIssue[]` (issues of **all** states, so closed work stays linkable, not just live
issues), `listPRs() → ForgePR[]` (open PRs), and `listComments(number) → ForgeComment[]` (one issue's
comment thread — the targeted read the incremental window and the post-write refresh use). `ForgeIssue`
is the small stable subset an issue collapses to on every host (number, title, body, url, state, labels,
author, createdAt, comments — the body is where the `Spec: <id>` marker lives; author/createdAt/comments
are what lets a forge issue stand beside a forum thread as the same object in the unified Issue port,
spec-cli's [[issues]], with a `by`, a `created`, and `replies[]`; a `ForgeComment` is `{author, body,
createdAt}`, exactly what a forum reply collapses to). `ForgePR` adds `headRefName` (the `node/<id>`
branch = a free structural link)
and `closesIssues` (the issue numbers it closes, for transitive linking). These vendor-neutral shapes are
exactly what lets one port cover GitHub/GitLab/Bitbucket. A driver may also offer the **optional
incremental window** `listIssuesSince(sinceISO)` — only issues updated since that moment — which lets
[[freshness]]'s resident cache merge small deltas instead of full-listing every cycle; a driver without it
is simply always full-listed. A new comment is exactly what bumps an issue's updated-at, so the window
carries each commented issue's fresh thread too (the github driver's REST listing only counts comments and
fetches the window's threads via `listComments` — the window is tiny, so this stays cheap). State casing
is normalized to lowercase **at the driver** — platform
differences (gh's GraphQL `OPEN` vs REST `open`) die at the adapter, never downstream.

A driver is the **only** thing that touches the network/CLI; it does no link resolution (that is
host-agnostic, in [[links]]). The first real driver is **`github`**, which wraps the **`gh` CLI** — reusing
the user's existing auth and `gh`'s repo auto-detection rather than handling tokens itself. It **fails
loud**: an absent or unauthenticated `gh` throws with gh's own message, so a broken `gh` never looks like
an empty forge.

**One caveat, scoped to a single optional field.** `closesIssues` rides GitHub's `closingIssuesReferences`,
a `gh pr list` JSON field that older `gh` builds don't know. Only the **transitive** link needs it; the two
core links (the `node/<id>` PR branch and the `Spec:` issue marker) read baseline fields. So a `gh` too old
for that one field must degrade **only** transitive linking, never take the whole driver down — otherwise
[[freshness]]'s resident cache swallows the throw and the dashboard goes blank ([[dashboard-issues]]). The
driver asks for the field, and **only** on gh's specific "unknown JSON field" rejection retries without it
(`closesIssues` empty) and warns once. Every other failure (no `gh`, no auth, no repo) is a different error
and still throws loud — the degrade is the narrow field-version case alone, not a blanket swallow.

The port carries two **write verbs**, both existing solely so the unified Issue port (spec-cli's
[[issues]]) goes through this same seam — the driver stays the ONLY thing that touches the network,
writes included, rather than a second vendor call-site growing in product code:
`createIssue({title, body}) → {number, url}` for *promotion* (a local thread moving to the forge; `gh
issue create`), and `createComment({number, body}) → {url}` for the store-routed *reply* (a reply to a
forge issue is a REAL comment on it; `gh issue comment`). Both fail loud. The
**tracer** (links/freshness/the board fold) remains read-only end to end, and the deeper contract is
untouched: nothing here ever writes a node's version or status (which stays git-derived) — a created
issue or comment is execution-plane work, never graph state.

Out of scope here: the link resolution itself ([[links]]), the CLI surface ([[forge-cli]]), and any second
driver (gitlab/bitbucket wrapping their own CLI later).
