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
functions the CLI calls, adding no dashboard-only capability, and hiding no CLI capability either (write
PARITY: what an agent can do to a remark, a human can do from the dashboard). **Identity is derived by the
surface, never sent by the caller:** the CLI's actor is the governed session id, the server's the `human`
sentinel — never the request body. R3's teeth are identity comparisons, so a caller free to name its own
actor could self-resolve or defeat author-only retract; with the identity pinned by the surface, the SAME
rules run identically on both (LAW L): resolve is any SECOND party's deliberate judgment — a governed
session from the CLI, the human from the dashboard — and `human` is an identity like any other, so it can
never resolve a human-authored remark (self-resolve stays structurally rejected) and retract touches only
the caller's own unresolved remarks.

## Write-visibility

A persisted write must be *visible*, not merely durable: remarks exist to be seen by a second party, so a
write that sits in the store until a ~15s fallback poll is a broken loop. Two legs, one per surface — and
deliberately **no third track**:

- **In-process (the server routes).** Every issue/remark write route ends its success path with the board
  stream's explicit nudge — the board cache is invalidated **atomically with persistence**, before the
  response, so the writer's own post-write refetch can never race an asynchronous fs event into the stale
  cache. The store directory is deliberately NOT in the fs watch set: a watch cannot give that atomicity,
  and two invalidation tracks for one write is the dual-mechanism smell.
- **Cross-process (the CLI verbs).** A store write commits to the trunk, and that commit reaches the board
  through [[graph-stream]]'s existing refs watcher — best-effort like every leaf, healed by the patrol
  within one cold tick (and flagged loud) when the leaf is blind. No new watch, no second track.

Invalidation alone is not visibility: [[graph-delta]] broadcasts only when board bytes move, so the board
carries one top-level freshness stamp over the whole merged issue set (open/thread/reply counts + the
latest activity instant) that **every** thread write moves — a reply, a remark, a resolve, a retract, a
close, on a noded or nodeless thread alike; a scenario-hosted remark moves its reading's thread overlay the
same way. On the client, the resident issues list's throttled refetch *defers* an in-window push to the
throttle edge, never drops it ([[issues-view]]). Measured end to end: a remark landing through
POST /api/remarks shows in a viewing browser within one debounce + rebuild, never the fallback lane.

Out of scope here (later milestones): the freshness/staleness computation that reads the resolved bit,
the server-side overlay join, and any dashboard UI — this node builds only the substrate they stand on.
