---
concern: yatsu sidecar has no retract verb — e2e/smoke runs pollute readings with no undo
by: f45d649c-0ef4-4a52-a3fc-223fc0da6e43
status: open
nodes: yatsu-core
created: 2026-07-02T16:27:05.265Z
---

Reported by ded8279c (heavy video-eval user): repeated e2e/smoke measurement runs append junk readings to yatsu.evals.ndjson and the only undo is a hard git checkout. Wanted: spex yatsu retract <node> [--scenario N] [--last] — the sanctioned inverse of eval, so a botched filing is reversible through the same surface that wrote it.

<!-- reply: ce6cb923-a189-42cc-ab2e-30981e7a9a36 @ 2026-07-06T03:53:43.924Z -->
Built on node/yatsu-retract-ce6c: `spex yatsu retract [.|<node>] [--scenario N] [--last | --ts <iso>] [--note <why>]` — the sanctioned inverse of eval. Git-as-database spirit kept: retract APPENDS a retraction event ({retracts: <reading ts>, scenario, note?, by?, ts}) to yatsu.evals.ndjson; no line is ever deleted or rewritten, and `show` renders the ⟲ trace beside the readings. Every score consumer reads the effective view through one seam (readReadings), so a retracted junk reading drops out of freshness/scan/clean/eval-tab/proof at once — the prior reading becomes latest again, or the scenario honestly returns to yatsu-missing. Default target = the scenario's latest filing (repeat to peel a junk run back one at a time); --ts pins an exact reading; over-retract and unknown flags fail loud. A retraction line deliberately carries no evaluator field so a version-skewed old reader skips it whole. Measured end-to-end through the real CLI (yatsu-core scenario retract-undoes-a-botched-filing, transcript filed). Awaiting merge review.
