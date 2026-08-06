---
title: reproduce-before-fix
surface: system
status: active
hue: 140
desc: A config plugin — a bug fix must first REPRODUCE the failure as a failing eval, then fix, verify, commit, and file the passing eval. The fail→pass pair on one scenario is the fix's proof (the A/B).
code:
---
## Reproduce before you fix

For a bug fix, the fail→pass pair on one scenario is the repair proof. New intent has no prior failure to
reproduce; `spex guide eval` has the A/B filing sequence.
