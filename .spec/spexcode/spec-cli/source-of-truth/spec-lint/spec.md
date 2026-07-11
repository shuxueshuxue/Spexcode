---
title: spec-lint
status: active
session: sess-cmdline
hue: 175
desc: Keep the spec↔code graph honest — every code file is claimed by a spec; `spex lint` enforces it.
code:
  - spec-cli/src/lint.ts
related:
  - spexcode.json
---
# spec-lint

## raw source

A spec is the ground truth for the code it governs, but nothing tied the two together, so code could
drift from its spec silently. The missing edge is a `code:` list in each node's frontmatter naming the
files it owns, plus a linter over that graph. Keep the spec↔code **graph** honest; whether the code
still matches what the spec *says* is the LLM judge's job, async, not in the commit path. It also flags a
body slid **below contract altitude** into a mechanics dump, and a node fanned out into too many direct
children — one comprehensibility ceiling, on depth and breadth. The graph's NAMES are part of
its honesty too: an id is an unambiguous coordinate, a `[[mention]]` must resolve, and a retired
vocabulary must stay retired.

## expanded spec

`spex lint` (the `spex` CLI, `cli.ts` → `lint.ts`, over `loadSpecs()` from `specs.ts`) checks the graph.
Errors block; warns advise. The full registry (every rule, its level, its one-line meaning) is printed by
`spex help spec` and `spex guide spec` — the manual lists ALL rules, always:

- **integrity** (error): every file a spec lists in `code:` exists — broken links block.
- **one-govern** (error): a node governs (`code:`) at most ONE file, so drift/eval/ack have one
  unambiguous subject; keep the true subject, demote the rest to `related:` ([[governed-related]]).
- **living** (error): a body stays current-state, with no `## vN` changelog headings — version history
  is read from git (recent/history tabs), not duplicated in prose. Fence-aware: a `## v2` inside a ```
  block is sample text, not a violation.
- **id-format** (error): a node's id — its leaf dir basename — is lowercase url-safe ascii
  (`[a-z0-9-]`, one optional leading dot for the reflexive `.plugins` root) and **unique tree-wide**.
  Uniqueness keeps the leaf THE id: on a collision the mint ([[id-url-safe]]) must parent-qualify, and
  every surface suddenly speaks a longer id than the dir name. The charset is the authored norm — an id
  also names a `node/<id>` branch and a URL segment, so it must need no escaping anywhere; the resolve
  machinery stays script-agnostic underneath.
- **mention** (error): every `[[id]]` in body PROSE names a real node — a dangling mention is a broken
  edge in the very graph the tree keeps honest. Retarget it or drop it; a placeholder (`[[node]]`,
  `[[<id>]]`) belongs in a fence or inline code span, which the rule exempts as sample text.
- **coverage** (warn): every source file is claimed by ≥1 spec via `code:` **or** `related:`. Source is
  enumerated from **git-tracked** files (`git ls-files`), so `governedRoots: ["."]` safely means the whole
  project (node_modules/build/nested-worktrees are never in the index). What counts as source is the
  **`lint.sourceExtensions`** knob (default ts/tsx/js/jsx) — the SAME setting eval lint's `eval-coverage` reuses
  (one knob, both coverage axes: a Rust/Go/Python tree sets it once), so there is no second web-only allowlist.
  **`lint.testGlobs`** (default `**/*.test.*`) drops tests; roots matching no tracked file warn "governing nothing".
- **drift** (warn): a governed file has commits not reachable from its spec's latest version — true git
  ancestry ([[drift-by-ancestry]]), never a log-position/date guess → maybe stale. A file
  governed by several nodes drifts **every** owner — shared governance is ordinary, and each has a stake.
- **related-drift** (warn): the SOFT tier — a `related:` file moved ahead of the node; one summary line,
  never the commit gate, never eval freshness.
- **altitude** (warn): a body states *intent and contract*, not a re-narration of the implementation.
  The rule can't judge meaning, so it fires on cheap proxies of a mechanics dump — grown long (lines /
  chars over a soft budget), thick with code identifiers, or step-by-step how-to. Budgets default so
  concise specs pass and only a dump warns.
- **breadth** (warn): a node with **≥ `lint.maxChildren`** direct children (default 8) — altitude's
  structural twin, the same "hold it in your head" limit on tree breadth, so passing altitude can't relocate
  sprawl into a flat fan-out. Advisory: a flat list of true peers is sometimes right, so it asks, not mandates.
- **owners** (warn): one summary line counting files governed by **> `lint.maxOwners`** nodes (default 3) —
  breadth's mirror on the file (too many owners, not too many children; below the cap is ordinary). Remedy
  blames the FILE: **split** it so each governor owns a module, or merge the nodes, or give it a single
  foundation owner + **`related:`**. See [[governed-related]].
- **confusable-id** (warn): two leaf ids exactly one edit apart read as the same word — a typo in either
  reaches a real, wrong node. Deliberately conservative (distance 1 only): hierarchy naming like
  graph/graph-delivery and verb pairs like evidence-put/evidence-get never warn — better to miss a
  borderline pair than to nag legitimate siblings.

Beside the graph rules sits the **vocabulary backstop**, [[dead-words]]: a CI grep gate over the RENAMED
concepts' old names, scoped to product surfaces (strings, file names, node dir names) with prose exempt —
lint keeps the graph honest, dead-words keeps its language from regressing.

Reusable as a **product**, not a SpexCode-only script: every project-shaped value (roots, extensions,
budgets, the breadth limit) is read from an optional **`spexcode.json`** (`lint` key), defaulting to values
tuned to this tree; a different layout or language overrides what fits. `loadConfig` reads it through the
shared fail-loud `readJsonConfig` ([[portable-layout]]): an ABSENT file defaults silently, but a MALFORMED
one throws LOUD rather than quietly reverting the author's tuned budgets to defaults — a typo that
green-washes the very altitude/coverage warnings they meant to enforce is a config error they must see.

No file hashes are stored — git is the hash database, so drift is derived live. When
drift exists, `spex lint` prints **remediation guidance**: drift can't be auto-fixed, so the agent must
find which link of intent→spec→link→structure→code broke and fix THAT — *never patch the symptom*.
**Gated with no flag:** `spex lint` reads the staged index — nothing staged (CI, see [[ci-gate]], and
manual audit) keeps drift advisory; mid-commit it applies a **commit-local gate**, blocking a commit
whose staged files belong to a node `≥ lint.driftErrorThreshold` (default 3) behind. Errors always
block; bypass with `SPEXCODE_SKIP_LINT=1`.

### Spec-OK — acknowledging an implementation-only change

A commit ahead of a spec isn't always staleness — a refactor can change a governed file while the spec
stays true. Such a commit carries a **`Spec-OK: <node-id>`** trailer; drift skips the node it acknowledges
(`Spec-OK: A` quiets only A). `spex ack <node>… --reason "<why>"` stamps the trailer on an **empty commit
above HEAD** (`--allow-empty --only`, so a dirty index never rides along) — never an amend: drift's read
side quiets every drift commit *reachable* from an ack, so a child stamp covers exactly what amending
would, and it works on a trunk merge commit, where an amend re-authors the merge after `MERGE_HEAD` is
gone and [[main-guard]] rightly rejects it (the guard passes the stamp through its tree-unchanged door;
the same door waives this node's commit-local drift gate for the stamp — a no-content commit can't
introduce drift, and gating it on the REAL index would block an ack on the very drift it acknowledges
whenever unrelated work is staged).
The reason is **required but not stored** — it forces the agent to articulate why the spec still holds
before quieting it. A shared file drifts every governor, so `Spec-OK:` accepts several ids — one ack per
co-owner.
