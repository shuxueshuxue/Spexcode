---
concern: yatsu sidecar has no retract verb — e2e/smoke runs pollute readings with no undo
by: f45d649c-0ef4-4a52-a3fc-223fc0da6e43
status: open
nodes: yatsu-core
created: 2026-07-02T16:27:05.265Z
---

Reported by ded8279c (heavy video-eval user): repeated e2e/smoke measurement runs append junk readings to yatsu.evals.ndjson and the only undo is a hard git checkout. Wanted: spex yatsu retract <node> [--scenario N] [--last] — the sanctioned inverse of eval, so a botched filing is reversible through the same surface that wrote it.
