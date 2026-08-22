---
title: Spex governed binding executable proof
status: active
hue: 280
desc: Executable proof of the adapter seam and explicit measurement of the remaining production-composition gap.
code:
  - scripts/spex-governed-bindings-yatu.mjs
related:
  - .spec/spexcode/session-runtime/spex-governed-bindings/spec.md
---
# Spex governed binding executable proof

The proof runs the Spex adapter against the real protocol and runtime-binding packages using an explicit temporary
database. It exercises initial bind, restart fencing, stale-writer rejection, resolve, and unbind. It also verifies
that the current governed registration source has real native identity commit sites but no protocol database open or
adapter call, and reports production cut-in as NOT-MEASURED rather than interpreting the seam proof as product wiring.
