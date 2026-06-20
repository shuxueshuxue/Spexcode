---
title: spec-forge
status: active
session: 3def572e
hue: 280
desc: A built host-agnostic forge projection — one ForgeDriver port, per-host drivers, mirror out + triage in; git/.spec stays canonical.
---
# spec-forge

A sibling package (alongside spec-cli, spec-dashboard, spec-yatsu) that bridges the spec graph to
external **forges** — git hosts with issues and code review (GitHub, GitLab, and the like). The
bridge is a single host-agnostic **[[port]]** (`ForgeDriver`) that names the abstraction; **per-host
drivers** sit behind it. Two drivers exist today — `github` and **[[gitlab]]** — and they are proven
substitutable through the one shared type: the same port covers both hosts. The name is the seam,
never the vendor.

The non-negotiable contract: **git/`.spec` is the single source of truth; the forge is only a
projection and never flows back as authority.** SpexCode already *is* the issue/PR system — pending
nodes are issues, `node/*` branches and `--no-ff` merges are PRs — so a forge state (webhook, label,
PR merge) must never mutate a node's version or status. That would reinstate the second source of
truth this project exists to retire.

Integration runs in two bounded, read-only directions, both leaving spec truth upstream:

- **Outbound mirror ([[outbound]]):** `mapStatus` turns a node's status into labels and `mirrorNode`
  projects a node out as a PR-shaped `MirrorPR` (title, `node/<id>` head, `main` base, status
  labels) — so collaborators who haven't adopted SpexCode still see motion.
- **Inbound triage ([[inbound]]):** `importIssues` pure-maps a forge issue to a `PendingNode`
  descriptor (slug, title, desc, provenance) — born outside, then it lives in the graph. Provenance
  is recorded but is never authority, and no node is created here.

The projection is reachable on the real CLI through **[[forge-cli]]** (`spex forge list` / `mirror`),
not just standalone proof scripts.

Out of scope: real network/API wiring to a live host and any write-back *from* a forge. The drivers
are deterministic and zero-network; nothing reaches outward and nothing flows back inward as truth.
