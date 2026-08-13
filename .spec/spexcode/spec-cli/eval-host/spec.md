---
title: eval host assembly
status: active
hue: 200
desc: spec-cli installs the concrete session, source-policy, issue, and transport capabilities that compose the independent spec-eval engine.
code:
  - spec-cli/src/eval-host.ts
---
# eval host assembly

The CLI is the composition owner for spec-eval's host port. Startup installs one concrete set of session identity,
review payload, source policy, sigil handling, remark loading, trunk commit, and API transport functions. The file
only assembles those adapters; eval implementation and remark record definitions remain in their own package.
