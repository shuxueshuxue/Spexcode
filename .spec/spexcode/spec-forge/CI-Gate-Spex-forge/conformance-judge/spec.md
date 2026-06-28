---
title: conformance-judge
status: pending
hue: 280
desc: PENDING — the agentic core. Per touched node, judge whether a PR's diff honors that node's spec intent, fed the spec + its tree + the node's diff slice + its yatsu scenarios. Structured verdict, not free text. Deterministic spec-touch matrix is its input. No code yet.
related:
  - spec-cli/src/lint.ts
  - spec-yatsu/src/proof.ts
---
# conformance-judge

The agentic heart of [[CI-Gate-Spex-forge]] — and the LLM judge [[spec-lint]] explicitly deferred ("whether
the code still matches what the spec *says* is the LLM judge's job, async, not in the commit path").

**Determinism routes; the agent judges.** Routing is mechanical — the `code:` graph already maps each
changed file to its node. The judge appears only where *meaning* must be weighed: does this slice of the
diff still honor what its node's spec says?

**Tier 0.5 — the spec-touch matrix (deterministic input).** Per touched node, classify `(spec touched?,
code touched?)`:

- *code changed / spec untouched* — drift risk; the judge decides harmless detail vs. **silent
  divergence** (the most dangerous cell, invisible to lint/typecheck).
- *spec + code changed* — normal; the judge checks the two are self-consistent.
- *spec only* — intent moved ahead of code; a `note`, with a follow-up question.
- *neither, file ungoverned* — a `coverage` smell, not a judgment.

**Tier 1 — one judge per touched node, bounded and structured.** Not one agent over the whole PR. Each
judge is fed: the node's spec body **plus its parent/siblings/children** (intent is only legible against
the tree), the node's slice of the diff (already grouped by [[review-proof]]), and the node's yatsu
scenarios (the expected zero-loss behavior). It returns a **closed-schema** verdict —
`{ verdict: conforms | diverges | spec-missing, severity: block | warn | note, rationale, evidence }` —
never free prose. Judges run in parallel across nodes and are skipped entirely for a PR that touches no
governed node.

**Read-mostly.** The judge produces a verdict; it never pushes a commit, never auto-merges, and never
writes a node's status. Escalating to adversarial multi-vote review is a depth knob, not the default.

Out of scope: publishing the verdict ([[forge-write-seam]]), sequencing it with the Tier-0 gates and CI
([[forge-gate]]), and the Tier-2 suggestion agent (deferred, default off).
