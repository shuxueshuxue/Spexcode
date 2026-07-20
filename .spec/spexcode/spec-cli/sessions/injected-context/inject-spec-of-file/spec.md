---
title: inject-spec-of-file
status: active
hue: 280
desc: A per-edit PostToolUse annotation that fires only when ACTIONABLE — the first edit of an over-owned (> maxOwners) or uncovered file flags it at the edit; a sanely-owned file is left silent.
code:
  - .spec/spexcode/.plugins/core/spec-of-file/spec-of-file.sh
related:
  - spec-cli/templates/spec/project/.plugins/core/spec-of-file/spec-of-file.sh
---

# inject-spec-of-file

## raw source

[[inject-spec-first]] grounds a session once, at its first code access — but on a long session that single nudge
scrolls away, and a file's actual owner is invisible at the moment you change it. Keep the contract in view
*at the edit*: when a session edits a file, tell it which spec governs that file. The danger is noise — a
per-write announcement over a 50-edit refactor is exactly the signal agents learn to tune out — so it must
fire **once per file, never per write**, and never block.

## expanded spec

A PostToolUse hook (`spec-of-file.sh`) consumes the harness adapter's complete code-mutation path list. Like
[[inject-spec-first]], it is NOT gated on `governed` — spec-awareness serves any agent. For every file in one
tool call, including every path in a Codex multi-file patch, it resolves actionable ownership and combines the
messages into one **non-blocking** `additionalContext`; a ledger dedupes so each file is annotated **once per
session**. That ledger is a sibling file in the session's GLOBAL store dir
(resolved from the payload's `session_id`, [[runtime]]) — the worktree holds no SpexCode state any more. The
ledger key is the repo-relative path after normalization, so an absolute path and a relative path to the same
file do not double-speak. Spec files are skipped — not governed code.

The hook only speaks for **Git-relevant files inside the current repo**. A path outside the repo (for example a
tool's `/tmp/...` transcript), `.git`, `.spec`, and ignored untracked files are silent. A tracked file is always
eligible, and a new untracked-but-not-ignored repo file is eligible so a brand-new source module can still be
told to get a spec home before it drifts. This keeps the annotation from treating shell scratch paths,
node_modules, build output, or other ignored artifacts as product files while preserving the uncovered-source
warning that matters.

The file→spec resolve is **`spex owner <path> --actionable`** (a thin verb in cli.ts, resolver `specOwners`
in specs.ts), a light read of frontmatter `code:` only — no git walk. `--actionable` is the discipline: it
speaks ONLY when there is something to act on, so the annotation stays rare instead of chatty.

- **over-owned** (> maxOwners governors) → "this file does too much — SPLIT it so each governor owns its own
  module (or merge the nodes, or give it a single foundation owner + relate)." The [[governed-related]]
  guardrail, surfaced live the moment an over-owned file is touched.
- **uncovered** (no owner) → give it a home before it drifts.
- **sanely owned** (1..maxOwners) → **silent**. [[inject-spec-first]] and the [[spec-pointer]] already grounded the
  agent; re-announcing a known owner on every edit is exactly the noise this annotation must not become —
  the lesson that an earlier always-on version of this hook taught.

Non-blocking and once-per-file by design: a pervasive signal earns its keep only by staying rare and
precise, or it becomes the noise it was meant to cure. The enforcer is still the Stop gate; this annotates.

The live `.plugins` handler is the single authoring source. [[init-preset]] projects it into the checked-in
`spex init` template, whose parity gate makes the behavior a user installs match what SpexCode runs.
