---
title: forge-cli
status: active
hue: 280
desc: Exposes the forge projection on the real `spex` CLI (`spex forge list`/`mirror`) — until now spec-forge was reachable only through standalone proof scripts. Read-only, zero network.
code:
  - spec-forge/src/cli.ts
  - spec-cli/src/cli.ts
---
# forge-cli

The **capstone** of [[spec-forge]]: it makes the projection *usable*. Until now the [[port]] and its
drivers were exercised only by standalone proof scripts; this exposes them on the real product surface as
`spex forge`, so a human or agent reaches the same projection through the CLI they already use.

It introduces **no new direction** — it is the existing read-out wearing a CLI surface. The
non-negotiable contract is therefore unchanged and unweakened: **git/`.spec` is the single source of
truth; a forge is only a projection and NEVER flows back as authority.** Every verb is read-only, performs
zero network, and mutates nothing.

**Surface:**

- `spex forge list [--host github|gitlab] [--json]` — print a host's `listPending()` projection: the
  graph's pending nodes as that host's forge-issue rows. Default host github. The host is selected
  **through the `ForgeDriver` port** (a registry keyed by each driver's own `host`), never a hardcoded
  vendor branch — so a third host is one registry entry, not a new conditional.
- `spex forge mirror <nodeId> [--json]` — project one node OUT as its `MirrorPR` (the outbound twin of
  list). Default output is a clean human table/summary; `--json` emits the raw shape.

The logic lives **in this package**; `spec-cli/src/cli.ts` carries only a thin `forge` route that
delegates to `runForge` and a help-text line — the CLI stays a routing seam, the projection stays here.

Out of scope (later siblings): real forge API/network wiring, and any write back from a host into the graph.
