# content-recoverability judge rubric（frozen before any scoring）

Judge receives one behaviorally normalized statement and anonymous candidate bundles in seeded order.
The packet never reveals arm, control kind, category, A/B/S stratum, source path, constructor, or seed.
Judge must not search the repository or use external knowledge. Score each statement/candidate pair
independently; do not rank candidates against one another.

## Verdicts

- **full** — the candidate completely carries the same behavior, boundary, object, and material qualifier.
  For structural units it must also put the responsibility or contract on the correct anonymous component
  and preserve the stated parent/child or ownership relation. For research-evidence units it must preserve
  the learned result and its material scope, not merely mention the method. Different wording and organization
  do not hurt.
- **partial** — the object or behavior is present but a material qualifier, direction, responsibility edge,
  non-responsibility, or cross-leaf boundary is missing or weakened.
- **absent** — the candidate does not carry the statement.
- **contradicted** — the candidate asserts the opposite behavior or boundary for the same object.

Only `full` counts in primary recoverability. `full + partial` is a secondary lenient diagnostic;
`contradicted` is reported separately as a bad signal. When uncertain, choose the more conservative verdict:
partial over full, absent over partial. A note may explain ambiguity but never replaces a verdict.

## Research-evidence boundary

Research evidence is a measured or systematically observed fact/conclusion: an experiment result, benchmark
finding, comparison, or frozen observation. Recovering only the experiment procedure or evaluator is at most
partial; recovering a design choice without the evidence is rationale, not recovery of the research unit.
A narrative of a failure event is incident content even when it motivated later research. Category labels
remain hidden from judges, but these semantic boundaries determine whether the anonymous candidate carries
the whole statement.

## Structural and control discipline

An intact sentence placed under the wrong owner is not full for responsibility, topology, or cross-leaf
units. A polished distractor is absent unless it independently states the same contract. Fabricated
plausible statements are judged exactly like real statements; judges are never told which they are.
Shuffled-original content preserves style and words but deliberately moves ownership slots, so lexical
familiarity is not a reason to grant full.

O0-self is the positive control. Its full-recall must be at least 95%. Fabricated false full-recovery must
be at most 10%. A B-latent full-recovery rate above 20% halts interpretation for contamination audit; any
S-stale/contradicted full recovery is a separately named bad signal. Tree-only topology/ownership recovery
at least 80% of R0 means inbound breadcrumbs explain nearly all of the apparent result: scrub/stub and
remeasure, or demote that category to secondary.

## Judge panel and agreement

The panel has at least one human and two model judges from mutually distinct families. The R0 constructor
family (OpenAI/gpt-5.5 for the frozen parent pilot) is excluded from model judges and cannot cast a consensus
vote. Report each judge separately, Gwet AC2 and Krippendorff alpha, plus leave-one-judge-out category order.
If dropping any judge reverses a category ordering, no single consensus ordering is reported. Before scoring,
run the frozen style-identity probe; accuracy above 70% requires arm-neutral normalization and a new frozen
probe before judging. A second failure is NO-GO.
