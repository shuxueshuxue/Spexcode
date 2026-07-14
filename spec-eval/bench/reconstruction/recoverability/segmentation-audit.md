# segmentation grain audit — frozen pre-R0 review

Scope: all 152 `seg-v2` units from the eight deterministic non-sample, non-sample-ancestor nodes listed in
`segmentation-audit.json`. Reviewed on 2026-07-15 before any module R0 existed and without reading the parent
phase-leaf R0 archive. This is protocol calibration, not sample annotation and not a replacement for dual
labels.

## Result

The first draft failed: semicolons created dependent fragments while multi-sentence bullets remained compound
(24–1004 chars). It was discarded before freeze. The frozen segmenter applies one sentence boundary to
paragraphs and bullets, keeps semicolon-qualified clauses together, contextualizes table data with headers,
and splits a semicolon branch list only when a shared colon prefix can be copied onto every branch.

Full review of the regenerated dev pool found every unit independently adjudicable as one commitment group.
Material qualifiers and causal clauses remain with the claim, so omission has the rubric's `partial` meaning;
headings, table headers, and fenced examples are not promoted to claims. Cluster-local anonymous subject slots
provide component context for pronouns without exposing node ids. Mechanical checks agree: zero headings,
raw table rows, dependent-start fragments, units under 20 chars, or units over 600 chars; dev-pool lengths are
21–473 chars.

Examples that set the boundary:

- `A read failure is not non-existence.` is a complete invariant and remains one short unit.
- The worktree directory/existence rule keeps its conditions and consequence together; splitting them would
  make `full` reward an unsafe half-rule.
- Runtime table rows become `Path: ...; Legacy flat name: ...; Written by: ...`, making each row self-contained;
  the header itself is context and is excluded.
- A worst-first status fold is split into branch units only by copying the shared aggregate prefix, so no bare
  `else` branch becomes a sample.

## Measured burden

The sample census contains 620 module units with per-module counts 100, 34, 73, 166, 122, and 125, plus 39
leaf-calibration units. This exceeds the critique's provisional ~60–120 module-scale pilot estimate; a
per-module mean cannot be used to claim otherwise. The 2-descendant module is genuinely smaller and the
8-child module genuinely larger, but keeping both is required by the single external eligibility rule.

Pre-R0 annotation therefore requires 659 real cards × 2 independent labels = 1,318 decisions, plus 95
fabricated controls × 2 absence verifications = 190, for a minimum 1,508 independent decisions before up to
659 adjudications. Unit sampling remains zero. This burden is an annotation-feasibility NO-GO until a human
explicitly approves the exact census or re-freezes an external module-scope rule before seeing any R0/result.
The resulting study is neither minimal nor quick.
