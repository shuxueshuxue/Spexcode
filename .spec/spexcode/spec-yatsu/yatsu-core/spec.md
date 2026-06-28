---
title: yatsu-core
status: active
hue: 140
desc: The scoreboard slice of spec-yatsu — yatsu.md scenarios (how to measure loss), the readings sidecar with verdicts, git-derived freshness, scan/eval/clean, and a content-addressed evidence cache. yatsu runs nothing; the agent measures.
code:
  - spec-yatsu/src/cli.ts
  - spec-yatsu/src/yatsu.ts
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/freshness.ts
  - spec-yatsu/src/cache.ts
  - spec-yatsu/src/evaluator.ts
related:
  - spec-cli/src/cli.ts
---
# yatsu-core

## raw source

The scoreboard slice of [[spec-yatsu]]: the eval/loss engine that KEEPS SCORE of a node's behaviour and
EXECUTES NOTHING. A spec carries how to measure its loss; the agent measures; yatsu records the result and
flags it stale. Prove the whole loop — declare a scenario, file a measurement, detect when it goes stale,
prune the evidence — works end to end through the real `spex` surface, with no browser and no executor.

## expanded spec

A node declares its scenarios in a **yatsu.md** beside its spec.md (a frontmatter `scenarios:` list, each a
**name** + **description** + **expected** zero-loss result, plus OPTIONAL **test** (a co-located
runnable file), **code** (the file this scenario GOVERNS, ideally one) and **related** (files it
references but does not own — they never stale it). A yatsu.md owns nothing; only its scenarios govern and
relate — the [[governed-related]] model on the scenario axis. A scenario is a *target the agent measures
however it likes*, not a script yatsu runs. The first three are required and the key set closed; a **strict
validator** rejects a malformed yatsu.md LOUD — at `scan` and the pre-commit gate, never silently reshaped.

A scenario is the unit of measurement, so its **freshness is its own**: its optional `code` subset is its
code freshness axis (a `code`/`related` path that doesn't exist is flagged, never silently immortal); absent,
it inherits the node's whole `code:` list. So two scenarios on one node, tracking different files, go stale
independently — one node's loss is many signals, not one. A file governed by more scenarios than `maxOwners`
is the `yatsu-owners` smell (split it). Measurements live apart in a flat
**yatsu.evals.ndjson** sidecar — one JSON line per reading (scenario, codeSha, blob+blobKind, evaluator,
**verdict**, ts) — the second git-as-database axis: a reading commit is a *measurement event*, not a spec
version, so history and attribution apply unchanged.

The **verdict** is the loss against `expected`: `pass`, `fail`, or a `note` (free-text how-far-off). The
**evidence** is an `image` or `transcript`, content-addressed, distinguished by `blobKind`; one filed before
verdicts existed renders as *legacy*.

**Freshness is derived live from git, never stored.** A reading goes stale on three axes since its codeSha —
a governed `code:` file changed, its scenario's *content* changed, or the evaluator version moved. A bare
`git mv` reparent is not a content change, so it never stales a reading: the scenario axis judges content the
way a spec node's own freshness does, not the yatsu.md's path. No hashes kept; an ack vindicates a *spec*,
not a reading.

The surface mirrors the code-drift report:
- **scan [--changed]** — the loss signal's blind spots: a malformed yatsu.md (`yatsu-schema` — missing field,
  unknown key, dup name, ghost `code`/`related` path), a stale reading (`yatsu-drift`), a scenario never
  measured (`yatsu-missing`), a **frontend surface** with **no yatsu.md** (`yatsu-uncovered`), and a whole-repo
  summary — a file governed by > `maxOwners` scenarios (`yatsu-owners`, split it). `--changed` scopes the
  per-node classes to the nodes the branch touched ([[yatsu-proactive]]); plain scan covers the repo.
- **eval [.|<node>] [--scenario N] (--pass|--fail|--note T) [--image P|--result P|-]** — FILE the measurement
  the agent already took. yatsu runs nothing: it stores the evidence (`--image` / `--result`, `-` for stdin)
  under one verdict, for one scenario.
- **clean [--keep-latest|--all]** — GC the evidence cache (blobs no reading references, by default).

The **evaluator** is metadata only — a tag `<name>@<version>` (e.g. `manual@1`) recording WHO measured, the
evaluator freshness axis. No executor seam: a measuring hand (human or future computer-use) is a tag, never
code yatsu calls.

Evidence is content-addressed under the **shared git common dir** ([[portable-layout]]) — one copy per repo,
outside the tree, uncommittable (no .gitignore). A gone blob renders as `miss original file`; a pre-commit
backstop rejects a stray blob or a malformed yatsu.md. `spec-cli/src/cli.ts` carries only a thin
`yatsu` route ([[forge-cli]] shape) — yatsu-core's sole stake in that shared hub.

Out of scope (sibling nodes): the dashboard eval-tab read side and the forge `needs-yatsu-eval` half of
scan. Computer-use and backend measurement are future evaluators, not code paths here.
