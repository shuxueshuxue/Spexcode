---
title: remark-substrate
status: active
hue: 210
desc: The remark — one durable interaction primitive that attaches a resolvable concern to a host (an issue OR a scenario reading), authored from the CLI. A remark is a reply that carries a mutable resolved bit and the reading it was measured against; plain replies are untouched. The whole author→resolve→retract loop is CLI-first, so the dashboard adds no capability.
related:
  - spec-cli/src/issues.ts
  - spec-cli/src/localIssues.ts
  - spec-cli/src/index.ts
---
# remark-substrate

A **remark** is the universal interaction primitive that lets a human or agent pin a *resolvable*
concern to something they are reading — a running issue, or a scenario's latest measurement. It is the
CLI-first substrate the whole eval/issue/remark refactor stands on: today remarking is a dashboard-only
gesture, so the law that "the dashboard is a thin wrapper over the CLI" is false for it; this node makes it
true — the whole author → resolve → retract loop holds under pure self-launch.

## What a remark is

A remark is **a reply that carries a mutable `resolved` bit**, plus a stable id and the codeSha it was
authored against. It is *not* a new record type and *not* "every reply on a scenario": a plain reply stays
`{by, at, body}`; a reply becomes a remark exactly when it carries the bit. Because a
remark may attach to an issue **or** a scenario, remark-ness can't be positional — it is a property the reply
carries. The bit is the marker.

- **Host.** A remark attaches to a *host*: a local issue, or a scenario keyed by `(node, scenario)`. The
  scenario track is not a new store — it reuses the existing lazy eval thread (one local issue thread per
  pair, keyed by its `eval: <node> · <scenario>` concern); every remark on it — the first included — is a
  reply, never the thread body, so the resolved bit lives in one place. That one-thread-per-pair guarantee is
  **atomic**: find-or-create runs inside the store lock, so a concurrent burst of first-remarks on a fresh
  pair (normal, with parallel workers) can't mint two threads — a duplicate would be invisible to the concern
  key and never fire its teeth (R4).
- **Pinned to a reading.** A remark records the **codeSha it was authored against** (the worktree HEAD by
  default; overridable). Later milestones hang the freshness teeth on this — a remark ages its scenario until
  a fresh reading *after* a resolve clears it — so it must remember which reading it judged.
- **Trunk-scoped.** Remarks are not code-bound, so they live in the trunk issue store, always visible, never
  branch-scoped. A human can remark an un-merged worktree eval without merging — it is overlaid onto the
  reading at read time.

## The three verbs

Thin wrappers over the store write path — a remark is a trunk-committed reply that also carries the bit:

- **author** — records a remark on a host, stamping the target codeSha and a fresh unresolved bit.
- **resolve** — flips the bit to resolved and stamps who/when. This has *teeth*: it is a **deliberate**
  call (the `spex ack` pattern, never a passive side effect of dispatch/delivery); it is **never the
  author's own** — self-resolve is rejected loudly, resolving is a second party's judgment; and it is
  **monotonic** — no un-resolve, a regression is a *new* remark.
- **retract** — the author withdraws their **own** remark, but only **while unresolved**. Once a second
  party has resolved it, the remark and that judgment are part of the record: R3's monotonicity is
  **two-sided** — retract can't back-door an un-resolve by deleting a resolved remark.

**Addressing.** A remark is addressed as `<thread-id>#<rid>`, where `rid` is a short stable id minted per
remark and frozen in the thread — an index would shift as retracts remove replies, so a stable id keeps a
resolve or retract from landing on the wrong remark.

## One model, two surfaces

The CLI is the whole model; the server exposes the same three actions — every endpoint calls the same
functions the CLI calls, adding no dashboard-only capability. **Identity is derived by the surface, never
sent by the caller:** the CLI's actor is the governed
session id, the server's the `human` sentinel — never the request body. R3's teeth are identity comparisons,
so a caller free to name its own actor could self-resolve or defeat author-only retract. Hence resolve is
unreachable from the dashboard (agent-only) and retract touches only the human's own remarks — identical on
both surfaces (LAW L).

Out of scope here (later milestones): the freshness/staleness computation that reads the resolved bit,
the server-side overlay join, and any dashboard UI — this node builds only the substrate they stand on.
