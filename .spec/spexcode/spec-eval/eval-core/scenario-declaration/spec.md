---
title: scenario-declaration
status: active
hue: 140
desc: What a node DECLARES it will be measured on — the eval.md scenario schema and its closed tag library, the code axis and the anchors that narrow it to named units, and the fixed-tree JSON projection plus the one write seam an external measurement hand may propose back into it.
code:
  - spec-eval/src/scenarios.ts#parseScenarios
  - spec-eval/src/scenarios.ts#validateScenarios
  - spec-eval/src/scenarios.ts#scenarioProjection
  - spec-eval/src/scenarios.ts#writeScenarioMeasurementMetadata
related:
  - spec-eval/src/scenarios.test.ts
  - spec-eval/src/declaration-write.cli.test.ts
  - spec-eval/src/scan-source.test.ts
  - packages/spec-core/src/anchors.ts
---

# scenario-declaration

Half of [[eval-core]]'s loop is the DECLARATION: what a node says it will be measured on, before anyone measures
it. This node owns that half — the file format, its closed schema and tag library, the code axis a scenario may
narrow, and the projection an outside measuring hand reads it through. What a stored reading then proves, and
whether it still testifies, are [[measurement-sidecar]]'s and [[eval-freshness]]'s.

A node declares its scenarios in a **eval.md** beside its spec.md (a frontmatter `scenarios:` list, each a
**name** + **description** + **expected** zero-loss result + **tags**, plus OPTIONAL **test** (either a
co-located runnable-file path or strict `{ path, name }`, where `name` is an opaque concrete case inside
that file), **code** (the file this scenario GOVERNS, ideally one) and **related** (files it
references but does not own — they never stale it). A eval.md owns nothing; only its scenarios govern and
relate — the [[governed-related]] model on the scenario axis. A scenario is a *target the agent measures
however it likes*, not a script eval runs. Both test forms validate that `path` exists; the object key set
is closed and `name` is preserved exactly, never parsed as WDIO, Playwright, or any other framework syntax.
There is no executor or framework adapter here. The first four fields are required and the scenario key set
is closed; a **strict validator** rejects a malformed eval.md LOUD — at `scan` and the pre-commit gate, never
silently reshaped. Every read surface carries the normalized test reference through scan, graph, and scenario
list JSON so callers see one stable shape regardless of how the author wrote the path-only shorthand.

**Tags classify a scenario** so it can be filtered now and routed to the right driver later (a surface like
`frontend-e2e`/`backend-api`/`cli`, a device like `desktop`/`mobile`). Each scenario carries **≥1 tag**, every
tag drawn from a **closed vocabulary** — the library configured in `lint.scenarioTags` (.spec/spexcode.json). A tag
outside the library is rejected with the repair the author owns: pick an existing tag, or **extend the
library** to mint a new one. The library is data, not a fixed enum baked in code, so the project grows its
own classification deliberately; the tags ride into `/api/graph` so every surface that shows a scenario
(the search palette and [[eval-tab]]) renders them as a uniform chip.

**A scenario's code axis narrows to named units, in the ONE anchor grammar the project already speaks.** A
`code:` entry may carry [[code-anchor]]'s `path#symbol` selectors — any number, all on the same base file,
OR'd — and the axis then asks the spatial question instead of the file question: a commit in `codeSha..HEAD`
stales the reading only when its hunks intersect an anchored unit's line range, extracted from the file AS IT
EXISTED AT THAT COMMIT. That is the same parse→resolve→intersect engine spec drift already runs, reused whole
(the structured relation parser, the designated per-extension extractor, anchor resolution, hunk∩range); eval
adds no second selector vocabulary, no second extractor registry, and no eval-local anchor syntax. What eval
deliberately does NOT reuse is the ACK: an ack vindicates a *spec*, not a reading, so the eval window stays
the plain ancestry window ([[drift-by-ancestry]]) and never subtracts `Spec-OK` commits. The narrowing is a
question asked at the axis, not a new verdict: freshness's decision functions stay pure over their inputs and
the anchor answer is fed in at the call sites, exactly like the content probe and the remark track.

The narrowing exists because **a shared file is not a shared behaviour**, and on this corpus that gap is
expensive. `harness.ts` is ONE file carrying eight adapters, and its scenarios measure liveness, delivery,
wake and teardown per adapter — each refreshed only by a REAL dispatched session of that harness
([[harness-adapter]]'s live matrix), the costliest measurement class here. A single +17/-0 edit adding the
`Harness` interface's settled-launch-failure field and the claude/codex adapter rows moved none of those
behaviours, yet file-level staling re-flagged the whole harness/headless cohort — billing the most expensive
readings in the corpus for an edit that could not have changed what they measured. Symbol narrowing makes the
bill follow the behaviour, and the same shape covers the headless adapter files, whose controllers and
one-turn spawners are separately-measured units inside one file.

An anchor is a claim that a named unit exists, so it is held to the same LOUD standard as a ghost path and
never resolves into a quiet pass. A selector that is **dead** (no unit of that name in the current file),
**ambiguous** (two units share the name), on a revision the extractor cannot parse, or on an extension with
no designated extractor is an `eval-schema` finding naming the selector and its repair — and until repaired
its reading stays conservatively STALE. A missing symbol therefore costs a false stale, never a false fresh:
this axis may over-report, it may never silently stop testifying. Anchors are OPTIONAL and additive — a bare
`code:` entry keeps whole-file semantics unchanged, and a scenario declaring no `code:` at all still inherits
its node's whole `code:` list, unnarrowed — so a behaviour with no trustworthy unit to name stays honestly
file-level rather than being pinned to a guessed symbol.

Narrowing the code axis moves NOTHING on the scenario axis. `scenarioHash` projects description + expected
alone, and `code` is a file POINTER, not a measurement contract — so adding, changing or removing a selector
leaves every stored hash equal and re-stales no reading. That is the same metadata-only rule that already
keeps tags and `test` out of the projection, and it is what makes adopting an anchor free: it narrows future
judgments without invalidating past measurements.

- **scenario ls [<node>|.] [--unmeasured] [--json]** — the DECLARED half of the scoreboard. The default text
  face keeps its worklist behaviour: it may join the latest effective reading to print verdict/timestamp, and
  `--unmeasured` keeps only scenarios with no effective reading (never measured, or every filing retracted).
  `--json` is a different, complete declaration projection for external measurement hands: it never reads or
  folds `evals.ndjson`, verdicts, evidence, remarks, or freshness, and therefore cannot accept the
  reading-dependent `--unmeasured` filter (that combination fails loud). The JSON envelope carries a
  projection id and schema version, fixed-tree Git provenance (`head` and `treeSha`), the normalized
  node-level `code`/`related` relations for every measurable node, and scenario rows sorted by canonical
  node id then scenario name. Each scenario row has two stable blocks:

  - `semantic`: `{node, name, description, expected, scenarioHash, code, related, tags}` — the living
    declaration contract. `scenarioHash` remains exactly the description+expected contract hash defined
    above; `code` and `related` are the normalized relation entries from the ONE `parseRelation` grammar,
    retaining selector information, and `tags` preserves the parsed order.
  - `measurement`: `{test}` — the normalized test mapping or `null`; it is metadata for the measuring hand,
    not part of `scenarioHash`.

  The envelope exposes `semanticIndexHash` over the canonical semantic row bytes, `fullIndexHash` over
  the canonical full (semantic + measurement) row bytes. A test-link-only edit therefore changes only the
  full index hash; a description/expected/code/related/tags edit changes both; add/remove/rename changes
  the sorted row bytes. A Git mode/type-only change never changes either scenario index hash because rows are
  content projections; the outer `treeSha` is the provenance signal that catches it. `planningIndexHash`
  covers the node relations together with the full scenario rows, so a planning consumer can bind the exact
  governed/related impact closure and its test links without loading the review/session graph. Node relations
  reuse the spec loader's frontmatter parser and the same `parseRelation` grammar; they are not a second spec
  parser. All fields, including empty relation/tag arrays and a missing test, have one stable JSON shape. The
  projection is the only canonical `--json` output; no second projection or cache exists.

  The declaration identity also has ONE small **write seam over fixed-tree bytes** for external measurement
  guards that need to propose metadata back into eval.md. A mutation names exactly one scenario and exactly
  one measurement field; initially the only field is `test`, carrying the same strict path-only or
  `{path,name}` value the reader already normalizes. The library accepts the authoritative eval.md bytes plus
  that single mutation, and `spex eval scenario write --mutation <json> < eval.md` accepts the same value and
  writes only the proposed bytes to stdout. Neither face reads a worktree, resolves a runner, or knows which
  forge/CR requested the proposal.

  This is the write half of the EXISTING declaration parser, never a second YAML identity. Before mutation the
  bytes must pass `parseScenarios`' closed-schema validation; the named scenario must resolve exactly once;
  after mutation the proposed bytes pass the same parser again and its normalized `measurement.test` must equal
  the requested value. Unknown/duplicate scenarios, malformed YAML/schema, a mutation containing several
  scenarios or fields, an insertion whose target field already exists, and a deletion whose target field is
  absent all fail LOUD. Callers never provide byte offsets, line numbers, or text anchors. The writer chooses
  one structural placement: `test` immediately after
  the required `tags` entry in the scenario mapping, while retaining the source's indentation and LF/CRLF
  convention. Deleting a value inserted by the writer is its exact inverse: it must reconstruct the
  authoritative input bytes byte-for-byte, including comments, blank lines, scalar style, final newline, and
  line endings. This byte equality is the proof that a guard may safely reverse its own proposal; the writer
  does not reformat unrelated declaration text to manufacture semantic equality.
