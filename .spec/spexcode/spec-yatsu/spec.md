---
title: spec-yatsu
status: active
session: 861e8ed1-064b-489e-b623-ff79dac86dc1
hue: 140
desc: The eval/loss engine — yatsu.md declares scenarios; a readings sidecar is a second git-as-database axis; scan/eval/show/clean on the CLI, the eval tab on the dashboard.
---
# spec-yatsu

The third SpexCode package, with [[spec-cli]], [[spec-dashboard]], and [[spec-forge]] — and now built.
Read the system as one optimization: **a spec is a loss-function design** (the target — *chosen*, not
proven), **issues/commits are the optimizer**, and **yatsu is the evaluator** that reads the loss (live
behavior vs. spec) and hands the signal back. Nothing proves a spec; what is measured is the code's
conformance — a relation between a spec and a code-state, keyed at the **evaluation**.

## The spine — scenarios and readings, a second git-as-database axis

Each node carries a **`yatsu.md`** beside its `spec.md` declaring its scenarios as a structured
`scenarios:` list (**one or many**, scenario-only — each a driver + target + inline steps or a pointer to
a native test). The **readings** they produce are recorded apart, in a flat git-tracked sidecar
`yatsu.evals.ndjson` keyed by scenario — and *that* record is the second axis: as a `spec.md` commit is a
*spec version*, a reading commit is an *evaluation event*, so the whole engine (history, attribution,
drift) applies unchanged, never inflating spec versions. The eval timeline is the sidecar's history. The
core launches no browser; the producer behind the Driver seam is **a human eyeballing** — the manual
producer (`spex yatsu eval --image`) — with a computer-use "stupid user" the interchangeable future one.
A reading is **stale** when its governed `code:`, its scenario, or the evaluator version moved since.

- **`spex yatsu scan`** — status: nodes holding a stale reading. *(Folding in open forge issues marked
  needs-yatsu-eval, resolved by [[spec-forge]]'s `eval-pending`, is the next wire.)*
- **`spex yatsu eval [.|<node>] [--force] [--image <path>]`** — incremental, idempotent: re-reads only
  the stale (`.` = current node, bare = sweep the tree; `--force` redoes a flaky result).
- **`spex yatsu show [.|<node>] [--json]`** — the CLI face of the eval timeline: a thin read over the
  *same* engine the dashboard folds onto the board, so a terminal agent and the eval tab read alike.
- **`spex yatsu clean [--keep-latest|--all]`** — prune the pixel cache (unreferenced blobs by default).

## Evidence — the eval tab

A node's **eval tab** (sharing the history tab's chronological scaffold) lists its readings newest-first
from `node.evals` on the board: each a freshness badge ("✓ current / ⚠ stale", surfacing `scan` like
code-drift) over an expandable screenshot. Pixels are content-addressed under the **shared git common
dir** — one blob per content, shared by every worktree (no duplication), never committed; a record whose
blob is gone reads **"miss original file."** *(A second timeline source — forge issue open/close events
that link out to the issue — is designed, not yet wired.)*

## The keystone & what's next

A bug *is* a detected loss: **A = repro on the broken state, B = the same scenario after the fix**, so a
fix authors its own regression scenario; [[spec-forge]]'s issue→node link is the rail. Still ahead: the
**computer-use "stupid user"** producer (scripted Playwright/WebDriver is deliberately *not* the path —
the ledger plus the manual producer is the heart), the forge second source above, and **backend yatsu**
(loss through real APIs — [[freshness]] reconcile waiting).
