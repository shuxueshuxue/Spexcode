---
title: gitlab
status: active
hue: 280
desc: The second read-only forge driver (gitlab), proving the host-agnostic seam — one port covers two hosts behind the same ForgeDriver/IssueRow.
code:
  - spec-forge/src/drivers/gitlab.ts
  - spec-forge/src/seam-proof.ts
---
# gitlab

The **second driver** of [[spec-forge]], and the reason the [[port]] exists: it proves the seam holds.
The whole point of a host-agnostic port is that ONE abstraction covers every forge — a single driver is
only a claim, two interchangeable drivers are the proof.

The non-negotiable contract is unchanged: **git/`.spec` is the single source of truth; a forge is only a
projection and NEVER flows back as authority.** Like the github driver, gitlab reuses spec-cli's
`loadSpecs`, keeps the `pending` nodes, and projects each as an `IssueRow` — read-only, zero network,
mutating nothing.

The seam is the **shared type, not the vendor.** gitlab speaks its own label vocabulary (the `::`
scoped-label convention) but returns the identical `IssueRow` shape, so a caller typed to `ForgeDriver`
drives github and gitlab through one code path without knowing which host it holds. `seam-proof.ts`
demonstrates exactly that: `listVia(driver: ForgeDriver)` lists BOTH hosts via the same function.

Out of scope (later siblings): real GitLab API/network wiring and outbound/inbound gitlab specifics.
