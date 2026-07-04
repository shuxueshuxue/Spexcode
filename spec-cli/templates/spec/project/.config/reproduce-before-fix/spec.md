---
title: reproduce-before-fix
surface: system
status: active
hue: 140
desc: A config plugin — a bug fix must first REPRODUCE the failure as a failing eval, then fix, then file the passing eval. The fail→pass pair on one scenario is the fix's proof (the A/B).
code:
---
## Reproduce before you fix — the fix's proof is a fail→pass pair

If your task is to FIX A BUG, reproduce it *first*, as a measurement — before you touch the fix. A claim that something is broken is worth nothing until the loss signal shows it broken; a claim that you fixed it is worth nothing until the same signal shows it passing. So a bug fix is bracketed by two readings of ONE scenario:

- **A — reproduce (fail).** Find the yatsu scenario whose expected the bug violates (if none fits, ADD one to the node's `yatsu.md` — a description + the expected correct behaviour), run it, and file the failing reading with evidence that SHOWS the bug: `spex yatsu eval <node> --scenario <s> --fail --note "<what's wrong>"` plus an `--image`/`--video` of the actual broken behaviour. This is not ceremony — reproducing is how you learn what actually breaks, and a fix aimed at an unreproduced bug aims at a guess.
- **B — fix, then re-measure (pass).** Make the code honor the spec, run the SAME scenario again, and file the passing reading with evidence of the corrected behaviour: `spex yatsu eval <node> --scenario <s> --pass`.

The two readings on the same scenario are the **A/B** — the error→correct transition, the fix's proof-of-work. yatsu keeps per-scenario reading history, so the pair is durable and navigable end to end.

Don't skip A because the fix looks obvious — an obvious fix with no reproduced failure leaves the loss signal blind to exactly the regression you just closed. This does not apply to building new intent (there is no prior failure to reproduce) — it is the discipline for **repair**: keep the loss signal honest across a bug's whole lifecycle, not just at the end.
