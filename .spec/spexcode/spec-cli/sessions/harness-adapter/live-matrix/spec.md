---
title: live-matrix
status: active
hue: 280
desc: The parameterized harness conformance suite — the eight-behavior acceptance matrix defined once as data, run against any registered launcher by `spex eval matrix <launcher>`, filing per-row eval readings on that harness's node.
code:
  - spec-eval/src/matrix.ts
related:
  - spec-eval/src/cli.ts
  - spec-eval/src/filing.ts
---

# live-matrix

[[harness-adapter]]'s acceptance rule — an adapter merges only with per-behavior readings measured through
a REAL dispatched session — used to live as prose: each harness's eval.md hand-transcribed its own wording
of the eight behaviors and a worker ran them by hand, so every new harness re-copied the matrix or silently
dropped rows. This node de-patches that: the matrix is DATA, defined exactly once, and running it against
any harness is one command.

Each row carries the three things a measurement needs: the DRIVE (real steps over the public session verbs
— new/send/show/stop/resume/close, plus a materialize for the transient guard hook and tmux for the
liveness kill; never a parallel mechanism), the EXPECTED (the harness-agnostic contract text), and the
EVIDENCE (a per-row transcript of every command, board observation, and pane capture, filed with the
reading). `spex eval matrix <launcher>` resolves the launcher to its harness, targets the
`<harness>-harness` spec node (`--node` overrides), and walks ONE real worker through the whole lifecycle:
undeclared-stop · pretooluse-block · ask-note · deliver-steer · resume · liveness · commit-gate ·
close-residue.

The rows are also the single source of the matrix's contract TEXT: before running, the suite syncs each
row's description/expected into the target node's eval.md — a scenario matching a row (canonical key,
harness-prefixed key, or historical alias) keeps its NAME so reading history is never orphaned while its
contract converges on the shared wording; a row with no scenario is appended under the canonical key;
hand-written harness-specific scenarios pass through byte-for-byte. One definition, N materializations —
the same shape materialize gives the plugin surfaces.

Verdicts stay honest three ways: a row that could not be provoked (the worker declared on its own; no
mid-turn window opened) files NOTHING and reports skip — never a fabricated loss signal; a measured row
files pass or fail immediately, so an aborted run keeps its partial readings; and the runner's own board
polling is exactly the probe pressure the delivery path must survive, so the measurement environment is the
adversarial one. A new harness is covered by registering its launcher and creating its node — zero new
runner code.
