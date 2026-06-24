---
title: spec-of-file
status: active
hue: 280
desc: A per-edit PostToolUse annotation that fires only when ACTIONABLE — the first edit of an over-owned (> maxOwners) or uncovered file flags it at the edit; a sanely-owned file is left silent.
code:
  - spec-cli/hooks/spec-of-file.sh
---

# spec-of-file

## raw source

[[spec-first]] grounds a session once, at its first code access — but on a long session that single nudge
scrolls away, and a file's actual owner is invisible at the moment you change it. Keep the contract in view
*at the edit*: when a session edits a file, tell it which spec governs that file. The danger is noise — a
per-write announcement over a 50-edit refactor is exactly the signal agents learn to tune out — so it must
fire **once per file, never per write**, and never block.

## expanded spec

A PostToolUse hook (`spec-of-file.sh`), wired on PostToolUse via `settingsJson`. On the first `Edit` /
`Write` / `NotebookEdit` of a given file it emits **non-blocking** `additionalContext` naming the file's
governing spec; a `.session` ledger dedupes so each file is annotated **once per session**. Spec files and
runtime state are skipped — not governed code.

The file→spec resolve is **`spex owner <path> --actionable`** (a thin verb in cli.ts, resolver `specOwners`
in specs.ts), a light read of frontmatter `code:` only — no git walk. `--actionable` is the discipline: it
speaks ONLY when there is something to act on, so the annotation stays rare instead of chatty.

- **over-owned** (> maxOwners governors) → "this file does too much — SPLIT it so each governor owns its own
  module (or merge the nodes, or give it a single foundation owner + relate)." The [[governed-related]]
  guardrail, surfaced live the moment an over-owned file is touched.
- **uncovered** (no owner) → give it a home before it drifts.
- **sanely owned** (1..maxOwners) → **silent**. [[spec-first]] and the [[spec-pointer]] already grounded the
  agent; re-announcing a known owner on every edit is exactly the noise this annotation must not become —
  the lesson that an earlier always-on version of this hook taught.

Non-blocking and once-per-file by design: a pervasive signal earns its keep only by staying rare and
precise, or it becomes the noise it was meant to cure. The enforcer is still the Stop gate; this annotates.
