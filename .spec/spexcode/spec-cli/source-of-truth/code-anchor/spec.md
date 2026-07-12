---
title: code-anchor
status: active
hue: 15
desc: A code: entry may pin one named unit (`path#symbol`); drift that touches the anchored unit is the BLOCKING tier (anchor-drift error), replacing the retired count-based driftErrorThreshold gate. Anchors are optional — an unanchored node never blocks.
code:
  - spec-cli/src/anchors.ts
related:
  - spec-cli/src/lint.ts
  - spec-cli/src/git.ts
  - spec-cli/src/specs.ts
---
# code-anchor

## raw source

Count-based drift gating ("3 commits behind blocks") measures the wrong thing: commit COUNT says
nothing about whether the spec's contract was touched. The honest block criterion is spatial — a spec
pins the unit of code that carries its contract, and only a change INSIDE that unit blocks. So a
`code:` entry may carry an anchor, `path#symbol`, and the gate asks one question: did any commit since
the spec's last version intersect the anchored unit's lines? Anchors are optional: an unanchored node
keeps today's advisory-only drift, forever.

## expanded spec

**Vocabulary.** An anchor names one top-level unit: a function, an arrow/const declaration (data
consts included), a class, an enum, or a class method (`#Class.method`). A type/interface resolves but
warns — anchoring a type is usually wrong. Verdicts about the anchor itself are **loud, never
silent**: dead (deleted/renamed — follow the rename or fix the spec), ambiguous (two same-named units),
an unparseable current file, a language with no designated extractor, or an extractor that cannot run
here — each is a lint **error** naming its repair.

**Judgment.** The window is the spec's last version → HEAD: the same non-merge, ack-filtered commit
set [[drift-by-ancestry]]'s walk already derives (one ack rule, shared — `Spec-OK` quiets an anchor
hit too, and the ack's reason is recorded in the ack commit body because quieting a hit is a strong
claim). Per window commit, the file's `--unified=0` hunks are intersected with the unit's line range
extracted from the file **as it existed at that commit** — never from HEAD, so later renames/moves
attribute correctly. Any intersection unacked → `anchor-drift` error, and the ordinary errors-block
gate ([[ci-gate]], the pre-commit shim) carries it; there is no separate staged-index gate, and
`lint.driftErrorThreshold` is retired. A historical file version the extractor cannot parse counts as
a **conservative hit**, flagged as such — over-warn beats silently missing a real change.

**Extraction is a language seam.** Extractors are pure `(content, filename) → units` functions (no
git, no cache, no fs — importable by an external scorer as-is), and every extension maps to exactly
ONE designated extractor — no cross-tier fallback. The JS family's designated extractor is the host
project's own typescript (parse-only AST; readiness probes the actual parse API, not mere
resolvability — an unresolvable OR incompatible typescript is an error with the repair, not a
downgrade). Other languages arrive as DATA rows to a generic engine (the heuristic
declaration/boundary patterns today; a row may carry whatever config its engine needs — e.g. a
tree-sitter grammar — so adding a language never adds a branch). Everything language-agnostic — blob-oid
memoization, dead/ambiguous resolution, hunk∩range — lives outside the seam. Git access stays
batch/short-lived; no resident process.
