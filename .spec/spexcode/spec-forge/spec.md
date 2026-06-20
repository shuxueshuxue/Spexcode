---
title: spec-forge
status: pending
session: 3def572e
hue: 280
desc: A host-agnostic forge integration — projects spec nodes out to GitHub/GitLab issues & PRs, git stays canonical.
---
# spec-forge

A pending sibling package (alongside spec-cli, spec-dashboard, spec-yatsu). It bridges the spec
graph to external **forges** — git hosts with issues and code review (GitHub, GitLab, and the like).
The bridge is a single **host-agnostic port** that names the abstraction; **per-host drivers**
(`github`, `gitlab`, later Bitbucket/Gitea) sit behind it. The name is the seam, never the vendor.

The non-negotiable contract: **git/`.spec` is the single source of truth; the forge is a
projection, never canonical.** SpexCode already *is* the issue/PR system — pending nodes are issues,
`node/*` branches and `--no-ff` merges are PRs. So integration flows in two bounded directions,
both leaving spec truth upstream:

- **Inbound (triage):** a forge issue becomes a `pending` spec node — born outside, then it lives in
  the graph.
- **Outbound (mirror):** a node's branch/status projects out as a mirror PR + labels, so
  collaborators who haven't adopted SpexCode still see motion.

What it must never do: let a webhook, label, or PR merge mutate a node's version or status. The
forge state never flows back as authority — that would reinstate the second source of truth this
project exists to retire. The port's surface is roughly `importIssues → PendingNode[]`,
`mirrorNode(node)`, `mapStatus(status) → labels`; the small, stable common subset (issue / PR↔MR /
labels / author) is what makes one port cover every host.
