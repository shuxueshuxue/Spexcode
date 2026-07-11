---
title: yatsu-core
status: active
hue: 140
desc: The scoreboard slice of spec-yatsu — yatsu.md scenarios (how to measure loss), the readings sidecar with verdicts, git-derived freshness, scan/eval/clean, and a content-addressed evidence cache. yatsu runs nothing; the agent measures.
code:
  - spec-yatsu/src/yatsu.ts
related:
  - spec-cli/src/cli.ts
  - spec-yatsu/src/cli.ts
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/freshness.ts
  - spec-yatsu/src/scenariofresh.ts
  - spec-yatsu/src/scenariofresh.test.ts
  - spec-yatsu/src/cache.ts
  - spec-yatsu/src/filing.ts
---
# yatsu-core

## raw source

The scoreboard slice of [[spec-yatsu]]: the eval/loss engine that KEEPS SCORE of a node's behaviour and
EXECUTES NOTHING. A spec carries how to measure its loss; the agent measures; yatsu records the result and
flags it stale. Prove the whole loop — declare a scenario, file a measurement, detect when it goes stale,
prune the evidence — works end to end through the real `spex` surface, with no browser and no executor.

## expanded spec

A node declares its scenarios in a **yatsu.md** beside its spec.md (a frontmatter `scenarios:` list, each a
**name** + **description** + **expected** zero-loss result + **tags**, plus OPTIONAL **test** (a co-located
runnable file), **code** (the file this scenario GOVERNS, ideally one) and **related** (files it
references but does not own — they never stale it). A yatsu.md owns nothing; only its scenarios govern and
relate — the [[governed-related]] model on the scenario axis. A scenario is a *target the agent measures
however it likes*, not a script yatsu runs. The first four are required and the key set closed; a **strict
validator** rejects a malformed yatsu.md LOUD — at `scan` and the pre-commit gate, never silently reshaped.

**Tags classify a scenario** so it can be filtered now and routed to the right driver later (a surface like
`frontend-e2e`/`backend-api`/`cli`, a device like `desktop`/`mobile`). Each scenario carries **≥1 tag**, every
tag drawn from a **closed vocabulary** — the library configured in `lint.scenarioTags` (spexcode.json). A tag
outside the library is rejected with the repair the author owns: pick an existing tag, or **extend the
library** to mint a new one. The library is data, not a fixed enum baked in code, so the project grows its
own classification deliberately; the tags ride into `/api/board` so every surface that shows a scenario
([[focus-panel]], the search palette, [[yatsu-eval-tab]]) renders them as a uniform chip.

A scenario is the unit of measurement, so its **freshness is its own**: its optional `code` subset is its
code freshness axis (a `code`/`related` path that doesn't exist is flagged, never silently immortal); absent,
it inherits the node's whole `code:` list. So two scenarios on one node, tracking different files, go stale
independently — one node's loss is many signals, not one. A file governed by more scenarios than `maxOwners`
is the `yatsu-owners` smell (split it). Measurements live apart in a flat
**yatsu.evals.ndjson** sidecar — **append-only, one JSON line per EVENT**. A filing appends a *reading*
(scenario, codeSha, an **evidence LIST** (each entry
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
to `yatsu-missing`; a retracted reading's blobs simply fall out of the referenced set at the next clean. The
two event kinds are told apart **positively** — a retraction carries `retracts`, a reading carries `codeSha`;
neither is ever recognized by another field's *absence* — and a
retraction matching no reading is inert. The trace stays navigable: the timeline carries the retraction
events beside the effective readings, and `show` renders each as a `⟲ retracted` line.

The **verdict** is the loss against `expected`: `pass` or `fail`. Either may carry an optional **note** — a
one-line annotation (why it failed, how far a pass sits from ideal). A note is an annotation *on* the verdict,
not a third status: a measurement must commit to pass or fail, and a scenario you haven't actually measured is
`yatsu-missing`, never a hedged note-as-verdict. The **evidence** is a **LIST** of content-addressed entries —
N `image`s and/or a `video` (with its step-timeline) and/or a `transcript` and/or a `data` block ([[evidence-kind-taxonomy]]), each typed by its `kind` (the
captured actual behaviour — the *why* lives there, the note only summarises it). One filing can carry a whole
run: several stills beside the recorded clip. Backward-compatible: a legacy **scalar** reading (one `blob` +
`blobKind`) reads as a one-entry list, so old readings still render; one filed before verdicts existed — or a
legacy note-only reading — renders as *legacy*.

**Freshness is derived live from git, never stored.** A reading goes stale on three axes since its codeSha —
two git-derived (a governed `code:` file changed, or its scenario's *content* changed) plus a
**non-git** axis, the REMARK ([[remark-teeth]]): an unresolved remark on the
scenario ages it like a drift event, and a resolved one keeps it stale until a reading taken *after* the
resolve exists. The scenario-content axis is **per-scenario and semantic, not per-file**: because a scenario is the unit of
measurement, a reading stales only when ITS OWN measurement contract moved — the **semantic fields,
description + expected** (what to measure, what zero loss looks like) — never when a *sibling* scenario
sharing the same yatsu.md did, and never on a **metadata-only edit**: tags (routing — which surface/hand
measures), and the file pointers test/code/related, change nothing about what an already-taken reading
proved, so one file's routine growth (an added scenario, a neighbour's reword) AND a tree-wide hygiene
sweep (a schema-clean retag, a coverage retune) both leave untouched contracts fresh instead of spraying
false stale across every reading they hold. (A renamed scenario is not an edit but a remove+add — a new
key, honestly unmeasured; a `code`/`related` retune reaches freshness anyway, because the code axis reads
the CURRENT governed set live.) Because freshness is derived live from git and never stored, narrowing the
projection **self-heals retroactively by design, not as a side effect**: historical metadata-only commits
simply stop registering as scenario changes the moment the engine reads them — no migration, no stored
hashes to rebuild. The deliberate tradeoff: a wrong→right retag means an old reading may have been measured
through the wrong modality, and it still reads fresh — accepted because the reading's **evidence kind**
(image/video/transcript/data) already records how it was ACTUALLY measured, so a modality mismatch stays
visible to a human and to review, while the false-positive cost of staling a whole tree on a tags sweep is
paid instantly and everywhere. Git has no
sub-file history, so this is built ([[scenariofresh]]): per scenario NAME, the commits where that block's
**semantic projection**
changed, rename-followed — a bare `git mv` reparent leaves the block byte-identical, so it records no change
and never stales (the same content-not-path rule a reparented spec node follows). A block version is keyed by
its **projection hash**, so a scenario's freshness is identical in every checkout that shares the history — a
worktree reads the same score as the main line, without a per-branch rebuild — and the walk is **whole-history**,
never first-parent-simplified, so a block edit that landed on a node branch and merged in still counts and is
never silently read as fresh. Both git axes then judge
"changed since" by the SAME true ancestry ([[drift-by-ancestry]]) — the code axis over a governed file's
commits, the scenario axis over that one scenario's block-change commits: a commit stales the reading iff it
is *not an ancestor* of its codeSha. An **off-history codeSha** — orphaned by a fold, rebase, squash-merge or
cherry-pick, or sitting on a never-merged branch — is where ancestry stops testifying, but the trees still
do: while the anchor commit object exists locally, freshness **falls back to content** — the anchor's tree
diffed against HEAD, scoped to the reading's governed files on the code axis and to that ONE scenario's
semantic projection on the scenario axis (the same per-scenario granularity and the same projection, so a
sibling's edit or a metadata sweep still can't
stale it). Byte-identical content reads fresh; a real difference stales exactly the moved axis — so a
routine history rewrite no longer sprays false stale across readings whose governed content never moved.
Only when the anchor commit object is truly gone (pruned) does the conservative stale remain, surfaced as
its own **anchor** axis so "anchor lost" never masquerades as "content changed". The fallback is fed to the
pure decision functions at the call sites (a content probe, exactly like the remark track) and the
in-history fast path pays no extra git call. No hashes kept; an
ack vindicates a *spec*, not a reading. `freshness.ts` stays a pure computation — the remark track is fed in
at the call sites, never read from the issue store here.

The code axis also **reports its drift for display**, not just decides it: `codeDrift` counts, per governed
file, how many commits in `codeSha..HEAD` touched it (the same ancestry reachability, reused — not a second
freshness path), so a surface can say `EvalsFeed.jsx +3` instead of a bare "code moved" ([[event-detail]]'s
stale readout). It is derived, never stored, and never feeds the stale/fresh decision — it explains one.

The surface mirrors the code-drift report:
- **scan [--changed]** — the loss signal's blind spots: a malformed yatsu.md (`yatsu-schema` — missing field,
  unknown key, dup name, ghost `code`/`related` path, out-of-library tag), a stale reading (`yatsu-drift`), a scenario never
  measured (`yatsu-missing`), a node governing **source code** with **no yatsu.md** (`yatsu-uncovered` — keyed off
  the SAME configurable `sourceExtensions` knob as [[spec-lint]]'s coverage, so a backend/CLI/Rust/Go/Python
  project's own sources are held to the loss discipline too, not just web files; no second web-only allowlist), and a whole-repo
  summary — a file governed by > `maxOwners` scenarios (`yatsu-owners`, split it). A `drift`/`missing` line
  carries the scenario's **tags**, so a reader (and [[yatsu-proactive]]'s Stop nudge) sees the gap's SURFACE —
  e.g. a browser-measured `frontend-e2e` scenario needs a real product run to refresh, not a desk check.
  `--changed` scopes the per-node classes to the nodes the branch touched ([[yatsu-proactive]]); plain scan covers the repo.
- **eval [.|<node>] [--scenario N] (--pass|--fail|--note T) [--image P …repeatable] [--result P|-] [--video P [--timeline P]]** —
  FILE the measurement the agent already took. yatsu runs nothing: it stores the evidence under one verdict,
  for one scenario. `--image` REPEATS (N stills) and combines freely with `--result`/`--video` in one filing —
  each is pushed onto the reading's evidence list; `--timeline` anchors the video entry. eval's flag set is
  **closed**, the argv mirror of the scenario schema's closed field set: an unrecognized `--flag` is rejected
  LOUD (before any node lookup or filing), never silently ignored — a version-skewed CLI that didn't know
  `--video` once filed the clip as an `--image`, and a misfiled reading is worse than none (it reads as proof).
  A reading anchors to `codeSha` — and a sha can only name a COMMIT, never a working tree — so **the only
  honest reading is measured on a CLEAN tree**, where HEAD *is* the code measured. Filed over uncommitted
  governed edits, a reading is **mis-anchored at birth**: it claims a verdict at HEAD while HEAD lacks the
  edits actually measured — a pass for code that never ran — and the stale flag after the next commit is
  freshness correctly exposing that lie, not an engine bug. eval therefore probes the scenario's governed
  files (its `code` subset, else the node's list, plus its own yatsu.md) for uncommitted changes and warns
  LOUD when it finds any — a warning, never a block (the filing proceeds; retract is the repair). The
  discipline it teaches is NOT "commit before you test" — gaining confidence and archiving sha-anchored
  evidence are two different acts. ① **Measure on the working tree** (dirty, with the fix), re-measure until
  green: the informal confidence gate, before any commit. ② **Commit that just-tested tree as-is** — what
  lands is code already verified, so no blind commit and no revert-as-routine — and now the tree is clean:
  HEAD *is* the code measured. ③ **Only then file the reading**: codeSha=HEAD names committed, verified
  code, the guard stays silent, and the eval sidecar appends as the last layer of evidence. The sha anchor
  can only land after the commit; the confidence must land before it. The seam has a **write half over data** too (filing.ts): a caller with a
  verdict but no argv — the HTTP eval route, a programmatic filer — appends through the SAME seam. Filing is the CLI/agent surface: [[event-detail]] reads
  readings and hosts remarks, it files nothing.
- **retract [.|<node>] [--scenario N] [--last | --ts <iso>] [--note <why>]** — the sanctioned inverse of
  eval: withdraw a botched filing by APPENDING a retraction event (see above), never by deleting its line.
  Node and scenario resolve exactly as eval resolves them; the default target is the scenario's latest
  effective reading (`--last` makes that explicit — repeated retracts peel a junk run back one filing at a
  time), `--ts` pins an exact one. A retract that finds nothing to withdraw — no reading, an unknown ts, an
  already-retracted target — fails LOUD; its flag set is closed like eval's.
- **clean [--keep-latest|--all]** — GC the evidence cache (blobs no reading references, by default).

There is **no executor seam and no per-reading instrument schema**: a measuring hand (human or future
computer-use) is never code yatsu calls, and it earns a schema field only when a second kind of hand
actually exists — attribution today is the `by` session plus the commit trailer, nothing else.

**A yatsu node's id IS its canonical spec id** — minted by the same rule, over the same universe, as the
spec loader ([[id-url-safe]]'s exported mint: the leaf dir name, or on a leaf collision the shortest
globally-unique `_`-joined trailing suffix, computed over ALL spec nodes, not just the yatsu subset). There
is no second, yatsu-local id scheme: the id `eval`/`show`/`retract` answer to is exactly the id the board,
scan and search already print, so a reading always lands on the node every other surface means by that id.
A node ref resolves LOUD: an exact canonical id always wins; a bare leaf name stays the convenience it
always was while it names exactly one yatsu node; a leaf several nodes share is an error listing the
candidate canonical ids — never an arbitrary first hit in walk order.

Evidence is content-addressed under the **shared git common dir** ([[portable-layout]]) — one copy per repo,
outside the tree, uncommittable (no .gitignore). A gone blob renders as `miss original file`; a pre-commit
backstop rejects a stray blob or a malformed yatsu.md. `spec-cli/src/cli.ts` carries only a thin
`yatsu` route ([[forge-cli]] shape) — yatsu-core's sole stake in that shared hub.

Out of scope (sibling nodes): the dashboard eval-tab read side and the forge `needs-yatsu-eval` half of
scan. Computer-use and backend measurement are future measuring hands, not code paths here.
