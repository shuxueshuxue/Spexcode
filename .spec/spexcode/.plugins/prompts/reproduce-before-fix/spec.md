---
title: reproduce-before-fix
surface: system
status: active
hue: 140
desc: A config plugin — a bug fix must first REPRODUCE the failure as a failing eval, then fix, verify, commit, and file the passing eval. The fail→pass pair on one scenario is the fix's proof (the A/B).
code:
---
## Reproduce before you fix

For a bug fix, use one scenario's fail→pass pair:

1. **A, before editing:** find the violated scenario or add one to `eval.md`, run it against the old committed
   behavior, and file `spex eval add <node> --scenario <s> --fail` with evidence of the failure.
2. **B, after editing:** run the same scenario against the working tree until it passes; commit the verified
   tree; then file `spex eval add <node> --scenario <s> --pass`. The reading's `codeSha` must be that commit.

The pair is the repair proof. New intent has no prior failure to reproduce.
