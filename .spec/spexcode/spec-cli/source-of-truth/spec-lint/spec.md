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
- **coverage** (warn): every governed source file is claimed by ≥1 spec (no orphan code); and roots
  matching no files at all are flagged as "governing nothing", so an adopter who never set
  `lint.governedRoots` isn't shown a falsely-clean board.
- **drift** (warn): a governed file has commits newer than its spec's latest version → maybe stale.
- **altitude** (warn): a body still describes *intent and contract*, not a re-narration of the
  implementation. It can't be judged deterministically, so the rule fires on cheap proxies of a
  mechanics dump — a body grown long (non-blank lines / chars over a soft budget), or thick with code
  identifiers per line, or written as step-by-step how-to. Budgets default to values tuned so today's
  concise specs pass and only a genuine dump warns. A WARN, like coverage/drift — lint stays 0 errors.

What makes this a reusable **product**, not a SpexCode-only script: every project-shaped value — the
governed roots, the source and code-identifier extensions, the altitude budgets — is read from an optional
**`spexcode.json`** (`lint` key), defaulting to values tuned to this tree. A repo with a different layout
or language overrides what fits; absent the file, lint is unchanged.

No file hashes are stored — git is the hash database, so drift is derived live from git ancestry. When
drift exists, `spex lint` prints **remediation guidance**: drift can't be auto-fixed, so the agent must
diagnose which link of intent→spec→link→structure→code broke and apply its one honest remedy — *never
patch the symptom*. **Gated with no flag:** `spex lint` reads the staged index — nothing staged (CI, see
[[ci-gate]], and manual audit) keeps drift advisory so the build never reddens on the backlog; mid-commit
it applies a **commit-local gate**, blocking a commit whose staged files belong to a node `≥
lint.driftErrorThreshold` (default 3) behind. Errors always block; bypass with `SPEXCODE_SKIP_LINT=1`.

### Spec-OK — acknowledging an implementation-only change

Not every commit ahead of a spec means the spec is stale — a refactor or perf tweak can change a
governed file while the spec stays true. Such a commit may carry a **`Spec-OK: <node-id>`** trailer
(*"this change keeps `<node>`'s spec valid"*); `git.ts`'s drift count skips a commit that acknowledges
the node whose version drift is measured from, so `Spec-OK: A` only quiets A's drift, never B's.

`spex ack <node-id>… --reason "<why>"` (`cli.ts`) stamps the trailer onto **HEAD** (`git commit --amend
--trailer`, beside `Session:`), taking **several nodes** in one amend so a commit to a shared file acks
every co-owner at once. `--reason` is **required but not stored** — git keeps only `Spec-OK: <node>`; it
forces the agent to *articulate* why each spec still holds before quieting it.

A sharp edge: git calls from inside the hook must route through `git.ts`'s `git()` helper, which strips
the inherited `GIT_DIR`/`GIT_INDEX_FILE`; otherwise repo discovery resolves to the cwd and lint silently
sees zero specs (caught only by testing through the real hook, not by running `spex lint` by hand).
