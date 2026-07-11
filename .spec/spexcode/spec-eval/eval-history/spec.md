---
title: eval-history
status: active
hue: 140
session: 4f111dfe-6777-423d-a353-da1c68e1a54f
desc: The CLI face of the measurement timeline — `spex eval ls [.|<node>] [--json]`, a thin wrapper over the same evalTimeline() the dashboard rides (verdict + expected + freshness), so a terminal agent and the board read ONE engine.
related:
  - spec-eval/src/cli.ts
---
# eval-history

## raw source

A terminal agent should get a node's evaluation timeline the SAME way the dashboard does — not through a
second implementation it can drift from. The dashboard already folds [[eval-tab]]'s `evalTimeline()`
onto the board; give the CLI the matching face so `spex eval ls` and the eval tab are two views of one
engine — the way `spex graph --json` and `/api/graph` stay byte-identical because both call `buildBoard`.

## expanded spec

`spex eval ls [.|<node>] [--json]` is a thin verb beside add/lint/clean in the eval CLI. It resolves a
SINGLE node (`.` or no arg = the current node by the session's record or `node/<id>` branch, a bare id = that node) and calls the
shared [[eval-tab]] `evalTimeline()` with NO read-context — the standalone path that derives its own
specs + driftIndex for one id, exactly what the `/api/specs/:id/evals` route does. It adds NO timeline logic
and NO dashboard logic; the board fold stays the only other caller, so the two faces can never disagree.

`--json` emits the `EvalTimeline` shape verbatim — the same bytes that ride the board — for an agent to
parse. The default is a readable, NEWEST-FIRST print, one row per reading: its scenario, the **verdict**
(✓ pass / ✗ fail / ≈ note: <text>, or *legacy* for a pre-verdict reading — the loss the agent measured),
the freshness badge in the board's vocabulary (✓ current / ⚠ stale, naming which axes moved),
the short codeSha, the evidence state (image / transcript / video / miss original file / no evidence), and the
timestamp; the scenario's **expected** on a second indented line. The two empty states stay distinct the way
the tab keeps them — a node with no eval.md ("declares no scenarios") versus one with scenarios but no
reading yet.

Out of scope: the read engine and the freshness derivation themselves ([[eval-tab]] / [[eval-core]]);
this node is only the CLI rendering of what they already compute.
