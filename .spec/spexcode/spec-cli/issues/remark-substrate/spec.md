---
title: remark-substrate
status: active
hue: 210
desc: The remark — one durable interaction primitive that attaches a resolvable concern to a host (an issue OR a scenario reading), authored from the CLI. A remark is a reply that carries a mutable resolved bit and the reading it was measured against; plain replies are untouched. The whole author→resolve→retract loop is CLI-first, so the dashboard adds no capability.
related:
  - spec-cli/src/issues.ts
  - spec-cli/src/proposals.ts
  - spec-cli/src/index.ts
---
# remark-substrate

A **remark** is the universal interaction primitive that lets a human or agent pin a *resolvable*
concern to something they are reading — a running issue, or a scenario's latest measurement. It is the
CLI-first substrate the whole eval/issue/remark refactor stands on: today remarking is a dashboard-only
gesture, so the law that "the dashboard is a thin wrapper over the spex CLI" is simply false for it. This
node makes it true — the whole author → resolve → retract loop holds under pure self-launch, with no
server and no browser.

## What a remark is

A remark is **a reply that carries a mutable `resolved` bit**, plus the codeSha it was authored against.
It is deliberately *not* a new record type and *not* "every reply on a scenario". A plain reply stays
`{by, at, body}` and parses unchanged; a reply becomes a remark exactly when it carries the resolved
bit (and its stable id + target codeSha). That is the simplest shape satisfying the contract: the
invariant says a remark may attach to an issue **or** a scenario, so remark-ness cannot be positional
("scenario replies are remarks") — it must be a property the reply itself carries. The bit is the marker.

- **Host.** A remark attaches to a *host*: a local issue, or a scenario keyed by `(node, scenario)`. The
  scenario track is not a new store — it is the existing lazy eval thread the annotator already uses, one
  local forum thread per pair, keyed by its `eval: <node> · <scenario>` concern. A remark reuses it; it
  never mints a second scenario store. A scenario thread is a pure container: every remark on it — the
  first included — is a reply, never the thread body, so the resolved bit always lives in one place.
- **Pinned to a reading.** A remark records the **codeSha it was authored against** (the worktree HEAD it
  runs in, by default; overridable). This is what later milestones hang the freshness teeth on — a remark
  ages its scenario, and only a fresh reading *after* a resolve clears it — so the remark must remember
  which reading it was a judgment of, never drift onto a later one.
- **Trunk-scoped.** Remarks are not code-bound, so they live in the trunk forum, always visible, never
  branch-scoped and never reconciled per worktree. A human can remark an un-merged worktree eval without
  merging anything: the remark is written to the trunk, overlaid onto the reading at read time.

## The three verbs

Thin wrappers over the existing forum write path, so a remark is an ordinary trunk-committed reply that
also carries the bit:

- **author** — records a remark on a host, stamping the target codeSha and a fresh unresolved bit.
- **resolve** — flips the bit to resolved and stamps who/when. This has *teeth*: it is a **deliberate**
  call (the `spex ack` pattern, never a passive side effect of dispatch or delivery); it is **never the
  author's own** — self-resolve is rejected loudly, resolving is a second party's judgment; and it is
  **monotonic** — there is no un-resolve, a regression is a *new* remark.
- **retract** — the author withdraws their **own** remark, removing it. Only the author may retract; it is
  how a human unsays a remark (resolve being reserved for a deliberate second-party judgment).

**Addressing.** A remark is addressed as `<thread-id>#<rid>`, where `rid` is a short stable id minted per
remark and frozen in the thread. An index would shift as retracts remove replies; a stable id survives
them, so a resolve or retract never lands on the wrong remark.

## One model, two surfaces

The CLI is the whole model. The server exposes the same three actions over the issues API so the
dashboard can do exactly what the CLI does and no more — parity in both directions, no dashboard-only
capability. Everything the endpoints do, they do by calling the same functions the CLI calls.

Out of scope here (later milestones): the freshness/staleness computation that reads the resolved bit,
the server-side overlay join, and any dashboard UI. This node builds only the substrate they stand on.
