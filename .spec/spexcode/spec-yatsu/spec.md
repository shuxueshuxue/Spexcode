---
title: spec-yatsu
status: active
session: 861e8ed1-064b-489e-b623-ff79dac86dc1
hue: 140
desc: yatsu is the evaluation in spec=loss / commits=optimizer — a spec carries how to measure its loss, the agent measures it, yatsu keeps score and flags stale.
---
# spec-yatsu

The third SpexCode package, with [[spec-cli]], [[spec-dashboard]], and [[spec-forge]]. Read the system as
one optimization: **a spec is a loss-function design** (what we want), **issues/commits are the
optimizer** (driving the code toward it), and **yatsu is the evaluation** — the measured loss, how far
live behavior sits from the spec.

## A spec carries how to measure its loss

Beyond the target, a node's **`yatsu.md`** says how to measure the loss against it — one or more
scenarios, each: a **description** (what to check), the **expected** result (what zero loss looks like),
and optionally a **test file** beside it (a real `playwright.spec.ts`, a script — whatever runs). This is
the *measurement*, written next to the loss function. yatsu defines no DSL and runs nothing.

## The agent measures; yatsu keeps score

The **agent is the evaluator.** When a score is stale, the agent reads the scenario, runs it *however* —
the test file, by hand, a computer-use pass — compares the actual result to the expected, and files the
measurement: `spex yatsu eval <node>` with the **evidence** it captured (a screenshot, a transcript) and
a **verdict** (met expected, or how far off). yatsu executes nothing; it only records the result.

yatsu **keeps score.** Measurements live in a flat git-tracked `yatsu.evals.ndjson` beside the spec — a
*second git-as-database axis*: a measurement commit is an evaluation event, so history / attribution /
drift apply unchanged. A score is **stale** when its governed `code:` or its scenario
moved since — derived live from git, no stored hashes. Evidence bytes are content-addressed under the
shared git common dir (one blob per content, shared by every worktree, never committed; gone → "miss
original file").

- **`spex yatsu scan`** — which scores are stale or missing.
- **`spex yatsu eval [.|<node>]`** — the agent files a measurement (evidence + verdict).
- **`spex yatsu retract [.|<node>]`** — the sanctioned inverse of eval: withdraw a botched filing by
  appending a retraction event (the sidecar stays append-only; the trace stays), so a junk e2e/smoke
  reading is reversible through the same surface that wrote it.
- **`spex yatsu show [.|<node>] [--json]`** — read a node's scores; the same data the dashboard's eval
  tab renders (one engine, two faces).
- **`spex yatsu clean [--keep-latest|--all]`** — prune the evidence cache.

## Proactive — the optimizer keeps its scores fresh

yatsu is the loss signal the optimizer reads, so a stale score is a blind spot. The **`core` contract**
tells every agent: changed a node that has a `yatsu.md`? re-measure it. The **stop-gate** surfaces a
stale or missing score the way it surfaces code-drift, so the nudge lands in the flow, not on demand.
Only nodes that declare a scenario are in scope — a node with no surface to measure simply has none.

## What's next
The **computer-use "stupid user"** is the agent's most thorough measuring hand — it just looks. **Backend
yatsu** measures loss through real APIs ([[freshness]] reconcile waiting). Nothing in yatsu ever learns
*how* to test: the spec defines the loss, the agent measures it, the optimizer drives it down, yatsu
keeps score.
