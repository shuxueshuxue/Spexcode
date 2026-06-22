---
title: yatsu-core
status: active
hue: 140
desc: The first runnable slice of spec-yatsu — yatsu.md scenarios, the readings sidecar, git-derived freshness, scan/eval/clean, and a content-addressed blob cache. Browser-free via a manual driver behind a Driver seam.
code:
  - spec-yatsu/src/cli.ts
  - spec-yatsu/src/yatsu.ts
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/freshness.ts
  - spec-yatsu/src/cache.ts
  - spec-yatsu/src/drivers.ts
  - spec-cli/src/cli.ts
---
# yatsu-core

## raw source

The first runnable slice of [[spec-yatsu]]: the eval/loss engine that reads a node's behaviour and
records it, with NO browser. Prove the whole loop — declare a scenario, take a reading, detect when it
goes stale, prune the captures — works end to end through the real `spex` surface, and leave the producer
a seam so a Playwright driver slots in later without touching the engine.

## expanded spec

A node declares its scenarios in a **yatsu.md** beside its spec.md (a frontmatter `scenarios:` list, each
a name + driver + target + either a native-test path or inline steps). The readings they produce are
recorded apart in a flat **yatsu.evals.ndjson** sidecar — one JSON line per reading (scenario, codeSha,
blob, evaluator, ts). That sidecar is the second git-as-database axis: a reading commit is an *evaluation
event*, never a spec version, so the engine's history and attribution apply to it unchanged.

**Freshness is derived live from git, never stored.** A reading goes stale on three axes measured since
its recorded codeSha — a governed `code:` file moved, its scenario (the yatsu.md) moved, or the evaluator
version moved. The code and scenario axes reuse the very drift index `spex lint` uses; no hashes are kept.
An ack vindicates a *spec*, not a reading, so that ack logic is deliberately not borrowed here.

The surface mirrors the code-drift report:
- **scan** — report nodes holding a stale reading.
- **eval [.|<node>] [--force] [--image P]** — incremental + idempotent: re-read only stale scenarios,
  `--force` redoes all. The default **manual** driver records a reading and optionally stores a provided
  image; a **Driver** interface lets a browser producer replace it with no change to eval.
- **clean [--keep-latest|--all]** — GC the pixel cache (blobs no reading references, by default).

Pixels are content-addressed under the **shared git common dir** (resolved via [[portable-layout]]), so
every worktree shares one copy and the bytes sit outside the tree — uncommittable by construction, hence
no .gitignore. A record whose blob is gone renders as `miss original file`; a pre-commit backstop rejects
a blob copied into the tree. `spec-cli/src/cli.ts` carries only a thin `yatsu` route (the [[forge-cli]] shape).

Out of scope (sibling nodes): the Playwright/WebDriver drivers, the dashboard eval-tab, and the forge
`needs-yatsu-eval` half of scan.
