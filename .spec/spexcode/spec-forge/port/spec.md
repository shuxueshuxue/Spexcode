---
title: port
status: active
hue: 280
desc: The host-agnostic forge port (ForgeDriver) that READS a host's issues (open + closed) and open PRs, plus its first real driver — github via the gh CLI.
code:
  - spec-forge/src/port.ts
  - spec-forge/src/drivers/github.ts
---
# port

The seam of [[spec-forge]]: a single **host-agnostic port** naming the abstraction, with **per-host
drivers** behind it. The name is the seam, never the vendor.

Unlike a projection, the port **reads the forge**. Its two verbs fetch a host's work objects —
`listIssues() → ForgeIssue[]` (issues of **all** states, so closed work stays linkable, not just live
issues) and `listPRs() → ForgePR[]` (open PRs). `ForgeIssue` is the small stable subset an
issue collapses to on every host (number, title, body, url, state, labels — the body is where the
`Spec: <id>` marker lives); `ForgePR` adds `headRefName` (the `node/<id>` branch = a free structural link)
and `closesIssues` (the issue numbers it closes, for transitive linking). These vendor-neutral shapes are
exactly what lets one port cover GitHub/GitLab/Bitbucket.

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

The contract holds at the port: it is **read-only**. A driver fetches and returns objects and writes
nothing — not to the forge, and never to a node's version or status (which stays git-derived).

Out of scope here: the link resolution itself ([[links]]), the CLI surface ([[forge-cli]]), and any second
driver (gitlab/bitbucket wrapping their own CLI later).
