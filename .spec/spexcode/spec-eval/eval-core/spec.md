---
title: eval-core
status: active
hue: 140
desc: The scoreboard slice of spec-eval — eval.md scenarios (how to measure loss), the readings sidecar with verdicts, freshness (ancestry code axis + stored scenario-contract hash), add/ls/scenario ls/lint/retract/clean, and a content-addressed evidence cache. eval runs nothing; the agent measures.
code:
  - spec-eval/src/scenarios.ts#scenarioHash
  - spec-eval/src/scenarios.ts#scenarioProjection
  - spec-eval/src/scenarios.ts#validateScenarios
  - spec-eval/src/scenarios.ts#writeScenarioMeasurementMetadata
  - spec-eval/src/scenarios.ts#resolveEvalNode
related:
  - spec-cli/src/cli.ts
  - spec-eval/src/cli.ts
  - spec-eval/src/sidecar.ts
  - spec-eval/src/freshness.ts
  - spec-eval/src/scenariofresh.ts
  - spec-eval/src/scenariofresh.test.ts
  - spec-eval/src/scenarios.test.ts
  - spec-eval/src/declaration-write.cli.test.ts
  - spec-eval/src/scan-source.test.ts
  - spec-eval/src/cache.ts
  - spec-eval/src/filing.ts
  - spec-eval/src/cli.test.ts
---
# eval-core

## raw source

The scoreboard slice of [[spec-eval]]: the eval/loss engine that KEEPS SCORE of a node's behaviour and
EXECUTES NOTHING. A spec carries how to measure its loss; the agent measures; eval records the result and
flags it stale. Prove the whole loop — declare a scenario, file a measurement, detect when it goes stale,
prune the evidence — works end to end through the real `spex` surface, with no browser and no executor.

## expanded spec

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
tag drawn from a **closed vocabulary** — the library configured in `lint.scenarioTags` (spexcode.json). A tag
outside the library is rejected with the repair the author owns: pick an existing tag, or **extend the
library** to mint a new one. The library is data, not a fixed enum baked in code, so the project grows its
own classification deliberately; the tags ride into `/api/graph` so every surface that shows a scenario
(the search palette and [[eval-tab]]) renders them as a uniform chip.

A scenario is the unit of measurement, so its **freshness is its own**: its optional `code` subset is its
code freshness axis (a `code`/`related` path that doesn't exist is flagged, never silently immortal); absent,
it inherits the node's whole `code:` list. So two scenarios on one node, tracking different files, go stale
independently — one node's loss is many signals, not one. A file governed by more scenarios than `maxOwners`
is the `eval-owners` smell (split it).

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

Measurements live apart in a flat
**evals.ndjson** sidecar — **append-only, one JSON line per EVENT**. A filing appends a *reading*
(scenario, codeSha, the **`scenarioHash`** contract stamp (see freshness below), an **evidence LIST** (each entry
a typed `{hash, kind ∈ image|video|transcript|data}` — the render taxonomy ([[evidence-kind-taxonomy]])),
the video entry's optional timelineBlob ([[step-timeline]]),
an optional **`by`** (the SESSION that filed
it, from envSessionId), **verdict**, ts) — the second git-as-database axis: a reading commit is a *measurement
event*, not a spec version, so history and attribution apply unchanged. `by` is the reachable session behind the
filing — the ORIGINATOR an eval-comment thread loops in on a reply ([[mentions]]). It is purely additive: a
legacy reading without it simply has no originator, so the loop-in stays silent; a human filing through the
HTTP route has no reachable session and omits it too. WHO measured is deliberately NOT a schema axis: the
agent is the measuring hand, and the retired per-reading `evaluator` tag (constant `manual@1` on every
reading ever filed) carried zero signal — legacy lines still hold the key, read-tolerated like the scalar
`blob`, rendered if present, never written again.

The sanctioned undo appends a **retraction** — `{retracts: <target reading's ts>, scenario, note?, by?, ts}`
— never deletes or rewrites a line, so a botched filing (a junk e2e/smoke run, a wrong verdict) is reversible
*through the same surface that wrote it* while the trace stays: the target line remains as history, the
retraction event says who withdrew it and why, and git carries both. Every score consumer reads the
**effective view** (readings minus the retracted, joined by (scenario, ts)) through one seam
(`readReadings`), so a retract undoes the filing on freshness, scan, clean's referenced-blob set, the eval
tab, and the proof at once — the previous reading becomes the latest again, or the scenario honestly returns
to `eval-missing`; a retracted reading's blobs simply fall out of the referenced set at the next clean. The
two event kinds are told apart **positively** — a retraction carries `retracts`, a reading carries `codeSha`;
neither is ever recognized by another field's *absence* — and a
retraction matching no reading is inert. The trace stays navigable: the timeline carries the retraction
events beside the effective readings, and `show` renders each as a `⟲ retracted` line.

The **verdict** is the loss against `expected`: `pass` or `fail`. Either may carry an optional **note** — a
one-line annotation (why it failed, how far a pass sits from ideal). A note is an annotation *on* the verdict,
not a third status: a measurement must commit to pass or fail, and a scenario you haven't actually measured is
`eval-missing`, never a hedged note-as-verdict. The **evidence** is a **LIST** of content-addressed entries —
N `image`s and/or a `video` (with its step-timeline) and/or a `transcript` and/or a `data` block ([[evidence-kind-taxonomy]]), each typed by its `kind` (the
captured actual behaviour — the *why* lives there, the note only summarises it). One filing can carry a whole
run: several stills beside the recorded clip. Backward-compatible: a legacy **scalar** reading (one `blob` +
`blobKind`) reads as a one-entry list, so old readings still render; one filed before verdicts existed — or a
legacy note-only reading — renders as *legacy*.

**Freshness is derived at read time, never stored as a verdict.** A reading goes stale on three axes —
the CODE axis (git-derived: a governed `code:` file changed since its codeSha), the SCENARIO axis (its
own measurement contract moved), plus a **non-git** axis, the REMARK ([[remark-teeth]]): an unresolved
remark on the scenario ages it like a drift event, and a resolved one keeps it stale until a reading
taken *after* the resolve exists.

The scenario axis is **per-scenario, semantic, and decided by a stored contract hash**. Because a
scenario is the unit of measurement, a reading stales only when ITS OWN measurement contract moved — the
**semantic fields, description + expected** (what to measure, what zero loss looks like) — never when a
*sibling* scenario sharing the same eval.md did, never on a sidecar-only commit, never on a merge's
textual reshuffle, and never on a **metadata-only edit**: tags (routing — which surface/hand measures)
and the file pointers test/code/related change nothing about what an already-taken reading proved. Each
filing stamps the reading with **`scenarioHash`** — the content hash of the semantic projection of the
scenario declaration it measured — and freshness is then a **pure text compare**: the stored hash against
the hash of the scenario's CURRENT declaration. Equal → fresh; different → stale; scenario gone from
eval.md → stale (nothing current answers for it; a renamed scenario is not an edit but a remove+add — a
new key, honestly unmeasured). The hash definition is deterministic and normative: each of description
and expected independently **collapses every whitespace run (space, tab, CR, LF) to a single space and
trims its ends** — so a prose re-wrap, an indent shift, CRLF churn, a literal-vs-folded block-scalar
restyle never move it — then the two normalized fields join with a single `\n` (unambiguous: neither can
contain one after normalization) and the UTF-8 bytes are sha256-hexed (`scenarios.ts scenarioHash`, the
one definition both filing seams and freshness read). The hash is pure text over the parsed declaration —
no git walk, no file position, no history — so it is identical in every checkout, on any branch shape,
however the same contract text got there. That is what makes fleet-parallel measurement **converge**:
agents filing readings and merging waves cannot re-stale each other's readings unless a contract's text
actually changed (issue #61 — the previous, git-derived axis keyed change-commits off a linearized
whole-history walk, and a DAG flattened to a list cross-attributes parallel branches' edits to one
eval.md, so every merge re-flagged the other branch's readings and the stale count never reached zero).
A text round-trip (edit away, edit back) reads fresh by design — the contract measured and the contract
now are the same text. The deliberate tradeoff carried over from the projection: a wrong→right retag
means an old reading may have been measured through the wrong modality and still reads fresh — accepted
because the reading's **evidence kind** (image/video/transcript/data) already records how it was ACTUALLY
measured, so the mismatch stays visible to a human and to review.

**Legacy readings degrade to the git-derived rule, one-shot and exclusive.** A reading filed before the
hash existed carries none, and for it the retained per-scenario git axis decides (`scenariofresh.ts`):
per scenario NAME, the commits where that block's semantic projection (the same description+expected,
block-scalar-folded) changed, rename-followed — the walk is **whole-history**, never
first-parent-simplified (a block edit that landed on a node branch and merged in still counts), and its
pathspec names BOTH spellings of the scenario file — the live `*eval.md` AND the retired `*yatsu.md` —
because it reads **immutable history, and an archive answers only to its archive name**: pre-rename
commits touched files literally named yatsu.md, so a single live-name pathspec would truncate every chain
at the rename commit and spray false stale across every pre-rename reading (the adopter corpora this
protects are real — hundreds of readings; the rename commit itself is a pure `git mv`, R100, and stales
nothing). Exactly ONE track decides each reading: hash present → the hash compare alone; hash absent →
the git rule alone — never both OR-ed into a double jeopardy, and no third fallback behind either. The
degradation is honest (the old rule's #61 over-staling persists for old readings) and self-retiring: the
next filing of that scenario carries the hash and leaves the legacy track for good.

Both the code axis and the legacy scenario track judge "changed since" by TRUE ancestry
([[drift-by-ancestry]]) — a commit stales the reading iff it is *not an ancestor* of its codeSha. An
**off-history codeSha** — orphaned by a fold, rebase, squash-merge or cherry-pick, or sitting on a
never-merged branch — is where ancestry stops testifying, but the trees still do: while the anchor commit
object exists locally, freshness **falls back to content** — the anchor's tree diffed against HEAD,
scoped to the reading's governed files on the code axis and to that ONE scenario's semantic projection on
the legacy scenario track. Byte-identical content reads fresh; a real difference stales exactly the moved
axis. Only when the anchor commit object is truly gone (pruned) does the conservative stale remain,
surfaced as its own **anchor** axis so "anchor lost" never masquerades as "content changed" — and a
hash-bearing reading's scenario axis still testifies even then, because the stored hash needs no anchor.
The fallback is fed to the pure decision functions at the call sites (a content probe, exactly like the
remark track) and the in-history fast path pays no extra git call. An ack vindicates a *spec*, not a
reading. `freshness.ts` stays a pure computation — the remark track is fed in at the call sites, never
read from the issue store here.

The content fallback is also a bounded resource boundary, and its bound is the QUESTION, not just the
schedule: freshness asks Git only about the governed paths a reading actually claims, and retains only
those answers. The tree comparison is pathspec-scoped to the requested paths (matched literally, so a path
carrying a glob character, a space or a leading colon is compared verbatim), and what enters the cache is
one verdict per (root, HEAD, anchor, requested path) — never a repository-wide list of changed files.
An unrequested path therefore has no verdict and reads as unprovable rather than fresh, which is what keeps
the retained set proportional to governed breadth instead of repository width. Scheduling composes with
that: concurrent callers on one anchor union their paths into a single child, a path requested after that
child starts rides the next batch, a settled path is never asked again, and different anchors under one
root and HEAD still run one at a time. A graph
abort or timeout rejects both its active and queued work with the existing `AbortError` and caches nothing,
so a later call retries; an unreadable anchor object is recorded as exactly that — the anchor axis — not as
a content verdict. Synchronous freshness decisions consume only
successfully settled verdicts — they never bypass a failed asynchronous prime by starting another diff.

**A root retains ONE head's verdicts — the head it is currently read at.** A settled verdict stays true of
its two immutable trees, but a checkout only ever answers at its current head, so keeping a head in the
cache key made every rebuild leave a whole generation resident and the cache grew with rebuild count rather
than with the corpus ([[source-of-truth]]'s current-root rule, which the history and drift indices already
follow). A head move therefore swaps the root's scope atomically: the previous head's per-anchor verdicts
and drift counts are released with it, and a probe pinned to the superseded head reads 'cannot testify'
rather than a stale answer. A batch still in flight across that swap settles for the caller holding it —
it never hangs and never throws — but writes into a detached entry that the new head can never read, so an
old flight cannot backfill a newer scope. Across repeated full invalidations over the same corpus the
resident entry count is therefore constant, and the number of warm roots is bounded on its own.

The code axis also **reports its drift for display**, not just decides it: `codeDrift` counts, per governed
file, how many commits in `codeSha..HEAD` touched it (the same ancestry reachability, reused — not a second
freshness path), so a surface can say `EvalsFeed.jsx +3` instead of a bare "code moved" ([[event-detail]]'s
stale readout). It is derived, never stored, and never feeds the stale/fresh decision — it explains one.

The surface mirrors the code-drift report:
- **lint [--changed]** — the measurement layer's findings are PURE ADVISORY (`spex spec lint`'s errors
  block commits; a measurement gap never blocks anyone — one lint per layer, same word):
  a malformed eval.md (`eval-schema` — missing field,
  unknown key, dup name, ghost `code`/`related` path, a dead/ambiguous/unextractable `code:` selector,
  out-of-library tag), a stale reading (`eval-drift`), a scenario never
  measured (`eval-missing`), a node governing **source code** with **no eval.md** (`eval-coverage` — the same
  NAME and shape as [[spec-lint]]'s coverage, keyed off the SAME [[adopt-nonweb-ergonomics]] tracked-text
  include-minus-exclude/test algebra (with `sourceExtensions` lowered to include globs), so a
  backend/CLI/Rust/Go/Python project's own sources are held to the loss discipline too; no second allowlist),
  an orphaned remark track (`eval-dangling`), and a whole-repo
  summary — a file governed by > `maxOwners` scenarios (`eval-owners`, split it). A `drift`/`missing` line
  carries the scenario's **tags**, so a reader (and [[eval-proactive]]'s Stop nudge) sees the gap's SURFACE —
  e.g. a browser-measured `frontend-e2e` scenario needs a real product run to refresh, not a desk check.
  A completed scan exits zero regardless of findings. `--changed` first prints the scope it actually
  established: the resolved merge base, changed-path count, and the exact current-worktree `spexcode.json`
  path (or `defaults`). The changed-path set is the union of the merge-base diff (both endpoints of a
  rename/copy) and untracked files. Failure to resolve the base or read either changed-path set is a command
  failure, not an empty scope: it exits non-zero and never prints a zero-finding summary.
  `--changed` keeps its selection axis aligned with the finding it is about ([[eval-proactive]]). The
  per-node classes (malformed, missing, coverage) select a node when the branch touched one of that node's
  OWN files — its spec directory excluding every descendant node directory — or the node's `code:` axis.
  Drift selects per SCENARIO instead: a stale scenario is reported only when the branch touched its node's
  own files or that scenario's effective code axis (`scenario.code`, else the inherited node `code:`).
  Thus a child node cannot make its parent disgorge unrelated old gaps, while an explicit scenario code
  override cannot fall outside changed-scan selection. Plain lint still covers the repo.
- **scenario ls [<node>|.] [--unmeasured] [--json]** — the DECLARED half of the scoreboard. The default text
  face keeps its worklist behaviour: it may join the latest effective reading to print verdict/timestamp, and
  `--unmeasured` keeps only scenarios with no effective reading (never measured, or every filing retracted).
  `--json` is a different, complete declaration projection for external measurement hands: it never reads or
  folds `evals.ndjson`, verdicts, evidence, remarks, or freshness, and therefore cannot accept the
  reading-dependent `--unmeasured` filter (that combination fails loud). The JSON envelope carries a
  projection id and schema version, fixed-tree Git provenance (`head` and `treeSha`), and rows sorted by
  canonical node id then scenario name. Each row has two stable blocks:

  - `semantic`: `{node, name, description, expected, scenarioHash, code, related, tags}` — the living
    declaration contract. `scenarioHash` remains exactly the description+expected contract hash defined
    above; `code` and `related` are the normalized relation entries from the ONE `parseRelation` grammar,
    retaining selector information, and `tags` preserves the parsed order.
  - `measurement`: `{test}` — the normalized test mapping or `null`; it is metadata for the measuring hand,
    not part of `scenarioHash`.

  The envelope exposes `semanticIndexHash` over the canonical semantic row bytes and `fullIndexHash` over
  the canonical full (semantic + measurement) row bytes. A test-link-only edit therefore changes only the
  full index hash; a description/expected/code/related/tags edit changes both; add/remove/rename changes
  the sorted row bytes. A Git mode/type-only change never changes either scenario index hash because rows are
  content projections; the outer `treeSha` is the provenance signal that catches it. All fields, including
  empty relation/tag arrays and a missing test, have one stable JSON shape. The projection is the only
  canonical `--json` output; no second parser or cache exists.

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
- **add [.|<node>] [--scenario N] (--pass|--fail|--note T) [--image P …repeatable] [--result P|-] [--video P [--timeline P]]** —
  FILE the measurement the agent already took. eval runs nothing: it stores the evidence under one verdict,
  for one scenario. `--image` REPEATS (N stills) and combines freely with `--result`/`--video` in one filing —
  each is pushed onto the reading's evidence list; `--timeline` anchors the video entry. add's flag set is
  **closed**, the argv mirror of the scenario schema's closed field set: an unrecognized `--flag` is rejected
  LOUD (before any node lookup or filing), never silently ignored — a version-skewed CLI that didn't know
  `--video` once filed the clip as an `--image`, and a misfiled reading is worse than none (it reads as evidence).
  A reading anchors to `codeSha` — and a sha can only name a COMMIT, never a working tree — so **the only
  honest reading is measured on a CLEAN tree**, where HEAD *is* the code measured. Filed over uncommitted
  governed edits, a reading is **mis-anchored at birth**: it claims a verdict at HEAD while HEAD lacks the
  edits actually measured — a pass for code that never ran — and the stale flag after the next commit is
  freshness correctly exposing that lie, not an engine bug. add therefore probes the scenario's governed
  files (its `code` subset, else the node's list, plus its own eval.md) for uncommitted changes and warns
  LOUD when it finds any — a warning, never a block (the filing proceeds; retract is the repair). The
  discipline it teaches is NOT "commit before you test" — gaining confidence and archiving sha-anchored
  evidence are two different acts. ① **Measure on the working tree** (dirty, with the fix), re-measure until
  green: the informal confidence gate, before any commit. ② **Commit that just-tested tree as-is** — what
  lands is code already verified, so no blind commit and no revert-as-routine — and now the tree is clean:
  HEAD *is* the code measured. ③ **Only then file the reading**: codeSha=HEAD names committed, verified
  code, the guard stays silent, and the eval sidecar appends as the last layer of evidence. The sha anchor
  can only land after the commit; the confidence must land before it. The seam has a **write half over data** too (filing.ts): a caller with a
  verdict but no argv — the HTTP eval-write route (`POST /api/specs/:id/evals`, the REST pair of the GET), a
  programmatic filer — appends through the SAME seam. Filing is the CLI/agent surface: [[event-detail]] reads
  readings and hosts remarks, it files nothing.
- **retract [.|<node>] [--scenario N] [--last | --ts <iso>] [--note <why>]** — the sanctioned inverse of
  add: withdraw a botched filing by APPENDING a retraction event (see above), never by deleting its line.
  Node and scenario resolve exactly as add resolves them; the default target is the scenario's latest
  effective reading (`--last` makes that explicit — repeated retracts peel a junk run back one filing at a
  time), `--ts` pins an exact one. A retract that finds nothing to withdraw — no reading, an unknown ts, an
  already-retracted target — fails LOUD; its flag set is closed like add's.
- **clean [--keep-latest|--all]** — GC the evidence cache (blobs no reading references, by default).

There is **no executor seam and no per-reading instrument schema**: a measuring hand (human or future
computer-use) is never code eval calls, and it earns a schema field only when a second kind of hand
actually exists — attribution today is the `by` session plus the commit trailer, nothing else.

**A measurable node's id IS its canonical spec id** — minted by the same rule, over the same universe, as the
spec loader ([[id-url-safe]]'s exported mint: the leaf dir name, or on a leaf collision the shortest
globally-unique `_`-joined trailing suffix, computed over ALL spec nodes, not just the measurable subset). There
is no second, eval-local id scheme: the id `add`/`ls`/`retract` answer to is exactly the id the board,
lint and search already print, so a reading always lands on the node every other surface means by that id.
A node ref resolves LOUD: an exact canonical id always wins; a bare leaf name stays the convenience it
always was while it names exactly one measurable node; a leaf several nodes share is an error listing the
candidate canonical ids — never an arbitrary first hit in walk order.

Evidence is content-addressed under the **shared git common dir** ([[portable-layout]]) — one copy per repo,
outside the tree, uncommittable (no .gitignore). A gone blob renders as `miss original file`; a pre-commit
backstop rejects a stray blob or a malformed eval.md. `spec-cli/src/cli.ts` carries only a thin
`eval` drawer route ([[forge-cli]] shape) — eval-core's sole stake in that shared hub.

Out of scope (sibling nodes): the dashboard eval-tab read side and the forge `needs-eval` half of
lint. Computer-use and backend measurement are future measuring hands, not code paths here.
