---
title: spec-yatsu
status: pending
session: 861e8ed1-064b-489e-b623-ff79dac86dc1
hue: 140
desc: The eval/loss engine — yatsu.md declares scenarios; a readings sidecar is a second git-as-database axis; scan reports stale, eval re-reads, the dashboard shows A→B.
---
# spec-yatsu

The third SpexCode package, with [[spec-cli]], [[spec-dashboard]], and [[spec-forge]] — the last still
unbuilt. Read the system as one optimization: **a spec is a loss-function design** (the target —
*chosen*, not proven), **issues/commits are the optimizer**, and **yatsu is the evaluator** that reads
the loss (live behavior vs. spec) and hands the signal back. Nothing proves a spec; what is measured is
the code's conformance — a relation between a spec and a code-state, keyed at the **evaluation**.

## The spine — scenarios and readings, a second git-as-database axis

Each node carries a **`yatsu.md`** beside its `spec.md` declaring its scenarios as a structured
`scenarios:` list (**one or many**, scenario-only — each a driver + target + inline steps or a pointer
to a native test; no loose headings). The **readings** they produce are recorded apart, in a flat
git-tracked sidecar `yatsu.evals.ndjson` keyed by scenario — and *that* record is the second axis: as a
`spec.md` commit is a *spec version*, a reading commit is an *evaluation event*, so the whole engine
(history, attribution, drift) applies unchanged, never inflating spec versions. The eval timeline is the
sidecar's history. The core launches no browser; the producer behind the Driver seam is **a human
eyeballing** — the manual producer that ships today (`spex yatsu eval --image`) — with a computer-use
"stupid user" as the interchangeable future one, the [[spec-forge]] shape. A reading is **stale** when its
governed `code:`, its scenario, or the evaluator version moved since.

- **`spex yatsu scan`** — status: nodes holding a stale reading, *plus* open forge issues marked
  **needs-yatsu-eval** (a label or `Spec:`-style body line, resolved to a node by forge).
- **`spex yatsu eval [.|<node>] [--force]`** — incremental, idempotent: re-reads only the stale (`.` =
  current node, bare = sweep the tree; `--force` redoes a result suspected flaky).
- **`spex yatsu clean [--keep-latest|--all]`** — prune the pixel cache (unreferenced blobs by default).

## Evidence — one timeline, two sources

A node's **eval tab** lists every evaluation chronologically, joined at read time:
- **Local A→B** — yatsu captures; the *record* lives in the sidecar (durable in git), the *pixels* in a
  content-addressed store under the **shared git common dir** — one blob per content, shared by every
  worktree (no duplication), never committed. Record present but blob gone → **"miss original file."**
- **Forge issue events** — each tracked issue appears **twice** (open, close); its image lives on the
  issue, so the entry **links out** rather than showing a local image.

Each carries a freshness badge ("✓ current / ⚠ stale"), surfacing `scan` like code-drift.

## The keystone — bug-fixing authors the scenario

A bug *is* a detected loss: **A = repro on the broken state, B = the same scenario after the fix** — one
optimizer step bracketed around the closing PR (wired via [[spec-forge]] issue→node). So scenarios need
no authoring pass: **each fix contributes its repro** as a new scenario in the node's `yatsu.md`, which
lives on as a regression eval.

## Future siblings
The next producer is the **computer-use "stupid user"** — a real agent driving the very surface a user
touches, the interchangeable successor to the manual producer behind the Driver seam. (Scripted
Playwright/WebDriver automation is deliberately *not* on this roadmap; the ledger plus the manual producer
is the heart.) **Backend yatsu** — loss measured through real APIs ([[freshness]] reconcile waiting) —
stays later, opt-in.
