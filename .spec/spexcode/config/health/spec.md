---
title: health
status: active
hue: 200
desc: Report a node's health — lint, drift, and body altitude — without changing anything.
kind: report
surface: slash
---
Report the health of each target spec node. **READ-ONLY**: make no edits and no commits.

{{targets}}

For each target, report:

- **Lint** — run `spex lint` and surface any error/warning naming this node (integrity, living, coverage,
  drift).
- **Drift** — whether its governed `code:` files have moved ahead of its latest version, and by how much.
- **Altitude** — body length and whether it reads as contract or has slid into an implementation dump.

End with a one-line verdict per node (`healthy` | `needs-tidy` | `drifting`) and the single
highest-value next action. Change nothing.
