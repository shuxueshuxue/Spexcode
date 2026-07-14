# unit-card template（human-readable mirror of schema.json）

One card corresponds to exactly one row in `units-skeleton.json`. The segmenter owns boundaries; annotators
may label but never split, merge, omit, or sample units. Both annotators work before any module R0 exists and
must not read the archived phase-leaf R0 until `labels --write` and `labels --check` succeed.

Before card work starts, `annotation-feasibility-approval.json` must bind the current protocol freeze and
explicitly approve 620 module units, 659 real cards, and at least 1,508 independent pre-adjudication
decisions. Without that human approval the study is NO-GO. The only alternative is a new external
module-scope rule frozen before R0/results; unit sampling is not an alternative.

```yaml
unitId: <copied from units-skeleton.json>
cluster: <module or leaf relDir>
scale: module | leaf
sourceNode: <C0 node relDir>
subjectSlot: <cluster-local anonymous component-NN copied from skeleton>
ordinal: <integer copied from skeleton>
rawTextSha256: <binds the hidden raw O0 text>
rewriteId: <entry in rewrite-map.json shown to judges>
labels:
  - annotator: <blind annotator A>
    stratum: A-supported | B-latent | S-stale-contradicted
    taxonomy: <exactly one taxonomy.json id>
    structuralFacet: none | responsibility | non-responsibility | topology-ownership | cross-leaf-contract
    evidenceRefs: [<C0 snapshot path[:line] references; required for A>]
    note: <optional>
  - annotator: <distinct blind annotator B, same closed keys>
adjudication:
  stratum: <resolved A/B/S>
  taxonomy: <resolved primary category>
  structuralFacet: <resolved facet>
  adjudicator: <identity; must also be blind to all R0>
  note: <why disagreement was resolved, or "agreed">
```

A means the clean C0 code-only snapshot independently supports the statement. B means O0 carries the intent
but the allowed C0 artifacts neither support nor contradict it. S means C0 behavior contradicts it or shows
that it was stale. Main recoverability uses only adjudicated A. B above 20% full recovery triggers a
contamination audit; recovered S is a bad signal, never a success.

`rewrite-map.json` is generated before labels. It replaces legacy yatsu-era names with neutral behavioral
phrases, preserves a raw hash to rewrite mapping, forbids residual legacy tokens, and checks that two distinct
raw units do not collapse to one normalized statement. Any collision requires a semantic human rewrite and
new `--write` freeze before annotation continues.

The blind statement is rendered as `[component-NN] <rewriteText>`. The slot, not the hidden source path,
provides subject and ownership context for pronouns and structural claims. Candidate module bundles use the
same anonymous slots; shuffled-original moves statements to a different slot, making wrong ownership
judgeable without revealing any node id.

Fabricated cards use the separate schema in `schema.json`: 10--15% of all probes at each scale, with slots
deterministically allocated across clusters, plausible for the assigned module/leaf but verified absent or
unsupported in C0 by both annotators. They are interleaved only after the
real-unit census is frozen and are never marked for judges.
