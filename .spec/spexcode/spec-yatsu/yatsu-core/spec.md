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
  - spec-cli/src/cli.ts
---
# yatsu-core

## raw source

The scoreboard slice of [[spec-yatsu]]: the eval/loss engine that KEEPS SCORE of a node's behaviour and
EXECUTES NOTHING. A spec carries how to measure its loss; the agent measures; yatsu records the result and
flags it stale. Prove the whole loop — declare a scenario, file a measurement, detect when it goes stale,
prune the evidence — works end to end through the real `spex` surface, with no browser and no executor.

## expanded spec

A node declares its scenarios in a **yatsu.md** beside its spec.md (a frontmatter `scenarios:` list, each
a **name** + **description** of what to check + the **expected** result that is zero loss + an OPTIONAL
**test**: a repo path to a co-located runnable file the agent may run by hand). There is no driver or
steps-as-execution-mechanism — a scenario is a *target the agent measures however it likes*, not a script
yatsu runs. The measurements live apart in a flat **yatsu.evals.ndjson** sidecar — one JSON line per
reading (scenario, codeSha, blob + blobKind, evaluator, **verdict**, ts). That sidecar is the second
git-as-database axis: a reading commit is a *measurement event*, never a spec version, so the engine's
history and attribution apply to it unchanged.

The **verdict** is the loss the agent measured against `expected`: `pass` (met it), `fail` (didn't), or a
`note` (a free-text how-far-off). The **evidence** the agent captured is either an `image` (a screenshot)
or a `transcript` (text) — content-addressed the same way, distinguished only by `blobKind`. A reading
filed before verdicts existed carries none and renders as *legacy*.

**Freshness is derived live from git, never stored.** A reading goes stale on three axes measured since
its recorded codeSha — a governed `code:` file moved, its scenario (the yatsu.md) moved, or the evaluator
version moved. The code and scenario axes reuse the very drift index `spex lint` uses; no hashes are kept.
An ack vindicates a *spec*, not a reading, so that ack logic is deliberately not borrowed here.

The surface mirrors the code-drift report:
- **scan** — report which scores are stale or missing: per scenario, its latest reading gone stale or no
  reading taken yet — exactly the pairs `eval` would (re)measure. The proactive Stop gate reuses it
  ([[yatsu-proactive]]).
- **eval [.|<node>] [--scenario N] (--pass|--fail|--note T) [--image P|--result P|-]** — FILE the
  measurement the agent already took. yatsu runs nothing: it stores the evidence the agent hands it
  (`--image` a screenshot, `--result` a transcript or `-` for stdin) under one verdict, for one scenario.
- **clean [--keep-latest|--all]** — GC the evidence cache (blobs no reading references, by default).

The **evaluator** is metadata only — a tag `<name>@<version>` (e.g. `manual@1`) recording WHO measured,
the evaluator freshness axis. There is no executor seam, no Driver interface, no `capture()`: a measuring
hand (a human, a future computer-use "stupid user") is a tag, never code yatsu calls.

Evidence is content-addressed under the **shared git common dir** (resolved via [[portable-layout]]), so
every worktree shares one copy and the bytes sit outside the tree — uncommittable by construction, hence
no .gitignore. A record whose blob is gone renders as `miss original file`; a pre-commit backstop rejects
a blob copied into the tree. `spec-cli/src/cli.ts` carries only a thin `yatsu` route (the [[forge-cli]]
shape) — yatsu-core's sole stake in that shared command hub, untouched when a sibling verb churns the same
file (e.g. registering [[forge-cli]]'s `eval-pending`).

Out of scope (sibling nodes): the dashboard eval-tab read side and the forge `needs-yatsu-eval` half of
scan. Computer-use as an evaluator and backend measurement are future evaluators, not new code paths here.
