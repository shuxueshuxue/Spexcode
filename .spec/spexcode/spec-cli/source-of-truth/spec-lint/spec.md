---
title: spec-lint
status: active
session: sess-cmdline
hue: 175
desc: Keep the spec↔code graph honest — every code file is claimed by a spec; `spex lint` enforces it.
code:
  - spec-cli/src/lint.ts
---
# spec-lint

## raw source

A spec is the ground truth for the code it governs, but nothing tied the two together, so code could
drift from its spec silently. The missing edge is a `code:` list in each node's frontmatter naming the
files it owns, plus a linter over that graph. Keep the spec↔code **graph** honest; whether the code
still matches what the spec *says* is the LLM judge's job, async, not in the commit path.

## expanded spec

`spex lint` (the `spex` CLI, `cli.ts` → `lint.ts`, over `loadSpecs()` from `specs.ts`) checks four
rules:

- **integrity** (error): every file a spec lists in `code:` exists — broken links block.
- **living** (error): a body stays current-state, with no `## vN` changelog headings — version history
  is read from git (recent/history tabs), not duplicated in prose. The check is fence-aware so a
  `## v2` inside a ``` block is sample text, not a violation.
- **coverage** (warn): every governed source file (under the governed roots) is claimed by ≥1 spec —
  no orphan code.
- **drift** (warn): a governed file has commits newer than its spec's latest version → maybe stale.

No file hashes are stored — git is already the hash database, so drift is derived live from git
ancestry (commits a governed file moved ahead of the spec's latest version). The pre-commit hook is a
thin shim over `spex lint`, blocking on **errors only** (bypass with `SPEXCODE_SKIP_LINT=1`); the same
command runs in CI for real enforcement — local hooks are advisory.

### Spec-OK — acknowledging an implementation-only change

Not every code commit ahead of a spec means the spec is stale. A refactor, a rename, a perf tweak can
change a governed file while the spec it lives under stays exactly true. To stop those from reading as
false drift, a code commit may carry a **`Spec-OK: <node-id>`** commit trailer, meaning *"this change
keeps `<node>`'s spec valid — no spec edit needed."* `git.ts`'s drift count (`driftIndex`/`driftFor`)
reads that trailer: a commit newer than `<node>`'s latest version that acknowledges `<node>` is skipped
and does **not** count toward its drift. The acknowledged node is matched against the node whose latest
version is the `sinceHash` drift is measured from, so `Spec-OK: A` only quiets A's drift, never B's.

`spex ack <node-id>` (in `cli.ts`) stamps the trailer onto **HEAD** via `git commit --amend --trailer`
— the workflow is: land the implementation-only commit, then `spex ack <node>` to record that it was a
deliberate no-spec-change. The trailer sits in the same trailer block as `Session:`; both coexist. This
is the explicit, auditable counterpart to drift: drift flags *maybe stale*, `Spec-OK` answers *checked,
still valid*.

A sharp edge: anything calling git from inside the hook must route through `git.ts`'s `git()` helper,
which strips the inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`; otherwise git's repo discovery
resolves to the cwd and the lint silently sees zero specs — it did once, caught only by testing through
the real hook, not by running `spex lint` by hand.

## current state

### description

`lint.ts`'s `specLint()` returns `Finding[]` over `loadSpecs()`: it builds a file→owners map while
emitting **integrity** errors for missing `code:` paths, scans each body (fence-aware `VER_HEADING`)
for **living** errors, walks `GOVERNED_ROOTS` (`spec-dashboard/src`, `spec-cli/src`; `SRC` extensions,
skipping `node_modules`/`dist`/`.vite`) for **coverage** warnings on unclaimed files, and turns each
node's `driftFiles` (computed in `specs.ts`) into **drift** warnings. This node now governs **only
`lint.ts`** — the lint logic itself. The files the lint *flow* passes through are owned where their
primary concern lives: the `spex lint`/`spex ack` dispatch sits in `cli.ts` ([[sessions]], which owns the
shared CLI dispatcher), `loadSpecs()`/`driftFiles` in `specs.ts` ([[source-of-truth]]), and the
`scripts/hooks/pre-commit` shim that runs `spex lint` and blocks on errors only (honoring
`SPEXCODE_SKIP_LINT=1`, routing git through the `GIT_DIR`-stripping helper) in [[main-guard]]. Keeping
those out of this node's `code:` is the point: a change to a session subcommand or the loader no longer
reads as drift on the lint graph. The LLM judge over this graph is not yet built.

### verdict — not drifted

The sole governed file, `lint.ts`, sits at this node's latest version. The phantom drift this node used
to show came entirely from the shared files it co-claimed — `cli.ts` and `specs.ts` advanced for session
and loader work that was never *this* node's behavior. Making ownership exclusive (only `lint.ts`) is
what removes that phantom: the lint graph is now scoped to its own code. The raw source (a `code:` edge
plus a linter over the graph; content-correctness left to the judge) still holds.
