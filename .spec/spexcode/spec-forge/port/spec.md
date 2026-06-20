---
title: port
status: active
hue: 280
desc: The host-agnostic forge port (ForgeDriver) + its first read-only github driver projecting pending nodes as issue rows.
code:
  - spec-forge/src/port.ts
  - spec-forge/src/drivers/github.ts
  - spec-forge/src/proof.ts
---
# port

The seam of [[spec-forge]]: a single **host-agnostic port** naming the abstraction, with **per-host
drivers** behind it. The name is the seam, never the vendor — a driver maps the port's vendor-neutral
shape onto its host (`github` here; `gitlab`, Bitbucket later).

The non-negotiable contract holds at the port: **git/`.spec` is the single source of truth; a forge is
only a projection and NEVER flows back as authority.** Every port method is therefore a one-way read
OUT of the graph — nothing mutates a node's version or status.

**Port surface (this slice):** `listPending() → IssueRow[]`. `IssueRow` is the small, stable common
subset a forge issue collapses to on every host — `title`, `body`, `labels` — which is exactly what
lets one port cover GitHub/GitLab/Bitbucket.

**First driver — `github` (read-only):** reuses spec-cli's `loadSpecs` (it does NOT reimplement the
`.spec` reader), keeps the nodes whose derived status is `pending` — the graph's native "open issues" —
and projects each as an issue-shaped row. Strictly read-only: it returns objects, performs zero network
calls, and writes nothing.

**Proof:** `npm run proof` drives the driver and prints the projection. The listing is the first proof
the abstraction holds end-to-end.

Out of scope for this slice (later siblings): outbound mirror, inbound triage, gitlab, and any real
network or CLI/API wiring.
