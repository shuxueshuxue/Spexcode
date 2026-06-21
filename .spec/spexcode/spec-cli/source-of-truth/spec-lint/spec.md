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
still matches what the spec *says* is the LLM judge's job, async, not in the commit path. The linter
also flags a body that has slid **below contract altitude** into an implementation dump, so specs stay
intent, not mechanics.

## expanded spec

`spex lint` (the `spex` CLI, `cli.ts` → `lint.ts`, over `loadSpecs()` from `specs.ts`) checks five
rules:

- **integrity** (error): every file a spec lists in `code:` exists — broken links block.
- **living** (error): a body stays current-state, with no `## vN` changelog headings — version history
  is read from git (recent/history tabs), not duplicated in prose. The check is fence-aware so a
  `## v2` inside a ``` block is sample text, not a violation.
- **coverage** (warn): every governed source file (under the governed roots) is claimed by ≥1 spec —
  no orphan code.
- **drift** (warn): a governed file has commits newer than its spec's latest version → maybe stale.
- **altitude** (warn): a body still describes *intent and contract*, not a re-narration of the
  implementation. It can't be judged deterministically, so the rule fires on cheap proxies of a
  mechanics dump — a body grown long (non-blank lines / chars over a soft budget), or thick with code
  identifiers per line, or written as step-by-step how-to. Budgets default to values tuned so today's
  concise specs pass and only a genuine dump warns; identifiers/steps are counted from prose only (a
  fenced code sample inflates length, not density). A WARN, like coverage/drift — lint stays 0 errors.

What makes this a reusable **product**, not a SpexCode-only script: every project-shaped value — the
governed roots, the source and code-identifier extensions, the altitude budgets — is read from an optional
**`spexcode.json`** (`lint` key), defaulting to values tuned to this tree. A repo with a different layout
or language overrides what fits; absent the file, lint is unchanged.

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
