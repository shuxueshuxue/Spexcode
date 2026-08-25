---
title: eval-freshness
status: active
hue: 140
desc: Whether a stored reading still testifies — the code axis by true ancestry, the scenario axis by a stored contract hash, the remark axis, the off-history content fallback, and the batching and scope rules that keep the whole judgment bounded.
code:
  - spec-eval/src/freshness.ts#staleAxes
  - spec-eval/src/freshness.ts#isStale
  - spec-eval/src/freshness.ts#changedSince
  - spec-eval/src/freshness.ts#codeDrift
related:
  - spec-eval/src/scenariofresh.ts
  - spec-eval/src/scenariofresh.test.ts
  - spec-eval/src/scenarios.ts
  - packages/spec-core/src/git.ts
---

# eval-freshness

A reading is a claim about code at a commit, so the question this node answers is whether that claim still
stands. It is DERIVED at read time and never stored as a verdict, it is decided per SCENARIO because the
scenario is the unit of measurement, and it may over-report but must never silently stop testifying.
[[scenario-declaration]] owns what a scenario declared; [[reading-sidecar]] owns what was filed.

A scenario is the unit of measurement, so its **freshness is its own**: its optional `code` subset is its
code freshness axis (a `code`/`related` path that doesn't exist is flagged, never silently immortal); absent,
it inherits the node's whole `code:` list. So two scenarios on one node, tracking different files, go stale
independently — one node's loss is many signals, not one. A file governed by more scenarios than `maxOwners`
is the `eval-owners` smell (split it).

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

The content fallback is also a bounded resource boundary: freshness asks Git only about the governed paths
a reading actually claims, retains one verdict per requested path, and never retains a repository-wide
changed-path set. [[off-history-content-probe]] owns the one plural Git schedule that preserves that meaning
when a whole read carries many off-history anchors; eval-core consumes its settled verdicts and never grows a
second transport or cache.

**An immutable-key answer is joined while it is IN FLIGHT, not merely reused once it settles.** A memo holding
only settled values is silent about the window that matters — a whole timeline pass primes concurrently, so
callers naming one key all miss together and each forks its own child. This governs the two per-reading lookups
beside the anchor batch: the drift count for an (anchor, path), and the eval.md object/blob read at a revision.
Both name immutable Git objects, so a joiner cannot be handed another question's answer, and both write their
memo once, on settle. A graph abort or timeout rejects active and queued work alike with the existing
`AbortError` and caches nothing, so a later call retries; an unreadable anchor object is recorded as exactly
that — the anchor axis — never as a content verdict. Synchronous freshness decisions consume only successfully
settled verdicts and never bypass a failed prime by starting another diff.

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

**Every Git demand in one read is planned and batched once, because the READ is the unit** ([[hunk-ranges]]).
A reader that walks many readings plans its rows first — a pure sidecar-and-axis pass — and primes the anchor
engine with every (anchor, entry) demand at once; the same computation billed per row cost ~2,500 redundant Git
children for ~800 verdicts on this corpus. The scenario-block read obeys the same rule one level down: deciding
whether a block moved between an anchor and HEAD needs that eval.md's object id at both revisions and then its
bytes, and asking per reading billed 1,212 `rev-parse` children plus a blob read each on a 415-node scope, where
one `cat-file --batch-check` and one `cat-file --batch` answer the whole demand. So the content probe records
each block demand as it settles an anchor verdict and answers them together when its caller flushes. Batching is
a COST seam, never a correctness one: verdicts stay keyed by (anchor, path, selector set), an unflushed demand
falls back to the singular lookup and returns the same block, and a batched read owes byte-equality with a
reading-at-a-time read — which is why no verdict assertion can observe it and the regression is pinned by
counting children.
