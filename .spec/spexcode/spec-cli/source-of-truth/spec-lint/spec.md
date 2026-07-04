---
title: spec-lint
status: active
session: sess-cmdline
hue: 175
desc: Keep the spec↔code graph honest — every code file is claimed by a spec; `spex lint` enforces it.
code:
  - spec-cli/src/lint.ts
  - spexcode.json
---
# spec-lint

## raw source

A spec is the ground truth for the code it governs, but nothing tied the two together, so code could
drift from its spec silently. The missing edge is a `code:` list in each node's frontmatter naming the
files it owns, plus a linter over that graph. Keep the spec↔code **graph** honest; whether the code
still matches what the spec *says* is the LLM judge's job, async, not in the commit path. It also flags a
body slid **below contract altitude** into a mechanics dump, and a node fanned out into too many direct
children — one comprehensibility ceiling, on depth and breadth.

## expanded spec

`spex lint` (the `spex` CLI, `cli.ts` → `lint.ts`, over `loadSpecs()` from `specs.ts`) checks seven
rules:

- **integrity** (error): every file a spec lists in `code:` exists — broken links block.
- **living** (error): a body stays current-state, with no `## vN` changelog headings — version history
  is read from git (recent/history tabs), not duplicated in prose. Fence-aware: a `## v2` inside a ```
  block is sample text, not a violation.
- **coverage** (warn): every source file is claimed by ≥1 spec via `code:` **or** `related:`. Source is
  enumerated from **git-tracked** files (`git ls-files`), so `governedRoots: ["."]` safely means the whole
  project (node_modules/build/nested-worktrees are never in the index). **`lint.testGlobs`** (default
  `**/*.test.*`) drops tests; roots matching no tracked file warn "governing nothing".
- **drift** (warn): a governed file has commits not reachable from its spec's latest version — true git
  ancestry ([[drift-by-ancestry]]), never a log-position/date guess → maybe stale. A file
  governed by several nodes drifts **every** owner — shared governance is ordinary, and each has a stake.
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
(`Spec-OK: A` quiets only A). `spex ack <node>… --reason "<why>"` stamps it onto HEAD (`--amend`); the
reason is **required but not stored** — it forces the agent to articulate why the spec still holds before
quieting it. A shared file drifts every governor, so `Spec-OK:` accepts several ids — one ack per co-owner.
