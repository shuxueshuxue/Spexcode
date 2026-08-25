---
title: session application installed consumer yatu
status: active
hue: 280
desc: The packed external-consumer proof for the complete session application dependency graph.
code:
  - scripts/session-application-yatu.mjs
related:
  - .spec/spexcode/session-runtime/application-service/spec.md
---
# session application installed consumer yatu

The clean consumer packs and installs protocol, topology, runtime bindings, events, and application together. It then
attaches a relation, publishes one notification, and dequeues it through public exports, proving that the package's
new component dependencies are present in the installed graph rather than only in the workspace.
