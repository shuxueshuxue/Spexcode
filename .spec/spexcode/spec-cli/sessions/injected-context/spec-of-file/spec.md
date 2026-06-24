---
title: spec-of-file
status: active
hue: 280
desc: A per-edit PostToolUse annotation — the first time a session edits a file, name the spec that governs it (and flag a shared-hub file with many owners), keeping the contract in view at the edit.
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

The file→spec resolve is **`spex owner <path>`** (a thin verb in cli.ts, resolver `specOwners` in specs.ts),
a light read of frontmatter `code:` only — no git walk — so the per-edit call stays cheap. Its three
outcomes ARE the signal:

- **one owner** → "governed by `<id>` — <desc>. Honor its spec; if your change shifts intent, update the
  spec in the same commit." The contract, delivered at the edit.
- **many owners** → the file is a **shared hub**: "your change likely belongs to ONE; the others co-own it
  — a file with many owners should get a single foundation owner and be RELATED elsewhere." The
  central-file guardrail of [[governed-related]], surfaced live the moment a hub gets folded into a node.
- **no owner** → uncovered; give it a home before it drifts.

Non-blocking and once-per-file by design: a pervasive signal earns its keep only by staying rare and
precise, or it becomes the noise it was meant to cure. The enforcer is still the Stop gate; this annotates.
