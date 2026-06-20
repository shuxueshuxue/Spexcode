---
title: inbound
status: active
hue: 280
desc: The inbound triage direction — pure-map a forge issue to a `pending` spec node descriptor (slug, title, desc, provenance). Read-only, zero network, no node creation; provenance is recorded but never authority.
code:
  - spec-forge/src/inbound.ts
  - spec-forge/src/inbound-proof.ts
---
# inbound

The **inbound triage** direction of [[spec-forge]] — the twin of the [[outbound]] mirror. Where the
[[port]] and the outbound mirror project nodes OUT (as issues, as PRs), inbound is the one direction that
flows IN: a forge issue becomes a `pending` spec node — **born outside, then it lives in the graph.**

The non-negotiable contract bites hardest here, because this is the only inward edge: **git/`.spec` is
the single source of truth; the forge is a projection and NEVER flows back as authority.** An issue may
*seed* a node, but after that birth the graph owns it — forge state (labels, comments, PR-merge) must
**never** mutate the node's version or status. Provenance is **recorded but is not authority**: a footnote
remembering where the node came from, never a controller of what it becomes.

This slice is a **pure mapping only** — no network, no file writes, no node creation. It takes issue
payloads and returns descriptors, which are **proposals** for nodes, not writes.

**Surface:**

- `ForgeIssue` — the small, stable, vendor-neutral subset an inbound issue collapses to on every host:
  `title`, `body`, `labels`, `author`, and the host ref (`host`/`hostId`/`url`). The twin of `IssueRow`,
  pointed inward.
- `importIssues(issues) → PendingNode[]` — pure-map each issue to a pending-node descriptor: a title-derived
  kebab-case `id`, the issue's `title`/`desc`, `status` fixed to the literal `'pending'`, and a `from`
  provenance record.

The guard is **structural**, not just documented: `status` is typed as the `pending` literal so a
descriptor can never carry a forge-decided status, and provenance lives on its own `from` field — inert,
read by nothing downstream that decides a node's version or status.

Out of scope (later siblings): real network/API wiring, actually realizing a descriptor as a `.spec` node,
and per-host issue-API drivers.
