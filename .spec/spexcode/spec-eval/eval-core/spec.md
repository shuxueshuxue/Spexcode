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

A scenario's declaration format, its tag vocabulary, its code axis and the anchors that narrow it are
[[scenario-declaration]]'s. The append-only readings sidecar, its retraction event and its evidence list are
[[measurement-sidecar]]'s. Deciding whether a stored reading still testifies — the three axes, the contract-hash
compare, the legacy git track, and the off-history content fallback — is [[eval-freshness]]'s. What stays here is
the loop those three serve: a scenario is a target the agent measures however it likes, eval records the result
and flags it stale, and nothing in this layer executes anything.

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
  established: the resolved merge base, changed-path count, and the exact current-worktree `.spec/spexcode.json`
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
  LOUD when it finds any — a warning, never a block (the filing proceeds; retract is the repair). The order that
  satisfies both halves is measure on the dirty tree until green, commit that just-tested tree as-is, then file
  — confidence lands before the commit, the sha anchor only after it, and neither is traded for the other.
  The seam has a **write half over data** too (filing.ts): a caller with a
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

Out of scope (sibling nodes): the dashboard eval-tab read side and the forge `needs-eval` half of
lint. Computer-use and backend measurement are future measuring hands, not code paths here.
