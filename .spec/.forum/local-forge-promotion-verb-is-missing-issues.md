---
concern: local→forge promotion verb is missing [[issues]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: issues
created: 2026-07-02T10:15:42.772Z
---

The unified Issue port reads both stores but writes only local. A durable concern that outgrows the repo (needs CI/external visibility) has no promote path — a future verb on [[issues]] should move a local thread to the forge (open the forge issue, mark the local one landed with the permalink).
