---
title: governed-related
status: active
hue: 200
desc: Two relations on a node — GOVERN (the ONE source of truth; drives drift/eval/ack; ≤1 file, >1 errors) and RELATED (everything referenced; carries coverage AND a soft drift warn). Three signal tiers govern > related > uncovered. A file governed by more than maxOwners nodes warns "split it".
related:
  - spec-cli/src/specs.ts
  - spec-cli/src/lint.ts
  - spec-eval/src/cli.ts
---

# governed-related

## raw source

A node's link to code carries two relations, told apart by one question: **does a change to this file
force me to re-examine this node's intent?** If yes, the file is what the node is the SOURCE OF TRUTH
for — that is **govern**, and there is exactly **one** of it, so drift, eval freshness and ack have a single
unambiguous subject and the author is forced to decide what this node is really the truth *of*. If no —
the file realizes or is referenced by the intent, but moving it does not move the intent — it is
**related**: the coverage net, many, carrying a *soft* liveness signal, never the verdict.

## expanded spec

Three signal tiers, strongest to none — **govern > related > uncovered**:

- **govern** (`code:`) — the **one** file the node is source of truth for. **At most one**: `spex lint`
  ERRORS on a node governing more than one file — pick the true subject, demote the rest to related.
  Zero is fine (a grouping, config or scenario-only node is source of truth for no source file). Govern
  drives the HARD signals: drift that counts to the commit gate, the `Spec-OK` ack floor, and eval
  attribution. **Many nodes may still govern the same file** — a change fans drift to each, which is
  correct; ownership is many-to-one on the file side, bounded only by too-many-owners below.
- **related** (`related:`) — every file referenced but not the single truth: the full-stack **face** (a
  thin frontend over a CLI/backend engine — restyle it and the intent does not move), shared substrate,
  and plain dependencies. It carries **coverage** (most files are reached here, not by govern) and a
  **soft drift warn**: when a related file moves ahead of the node's version, lint WARNS — a nudge that a
  dependency shifted, worth a glance — but it NEVER blocks a commit, needs no ack, and feeds no eval staleness.
  This soft signal is why related is worth maintaining: it is a live-but-quiet dependency edge, not a
  dead pointer. A related row may narrow its ear with a selector (`path#symbol`, [[code-anchor]]):
  then only a commit moving that unit warns — misses are silent — and the never-block/never-ack/no-eval
  nature is unchanged.

Both relations may scope entries to named units ([[code-anchor]]): a `code:` file may carry any number
of selectors (still ONE base file — one-govern counts distinct paths), and a selector-scoped governor
claims units, not the file, so it stays out of too-many-owners below while `spex owner` still shows it
as a scoped claim.

**`spex owner <path>` reports both**, distinctly: the governor as the verdict, referencers as an "also
referenced by … (related)" line. The per-edit `--actionable` hook still stays SILENT for a related-only
file — a soft edge is not worth interrupting an edit for.

**too-many-owners** — the file-rotated bound (the deterministic twin of [[doctor]]'s advisory breadth): a file governed by
more than `maxOwners` nodes (default 3) fires one summary warning at `spex lint` (the commit gate blocks
on drift only, never on ownership). It blames the file's size, not its ownership — three moves, split first:

- **split the file** so each governing node reclaims its own module — the honest fix a monolith awaits;
- **merge the nodes** when the separate specs are really one concern;
- **single foundation owner** + relate the rest, when the file is a genuine shared substrate.

The model holds on **both** axes — spec nodes and eval scenarios (a eval.md owns nothing; only its
scenarios `code`-govern ≤1 file and `related`-reference the rest, and a file governed by too many
scenarios is the `eval-owners` smell). A node whose intent genuinely spans several source files is a
**split-the-file candidate** ([[sessions-core]], [[dashboard-shell]]): its one truth stays govern, the
rest sit in related until each reclaims its own node.
