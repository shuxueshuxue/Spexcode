---
concern: local→forge promotion verb is missing [[issues]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: landed
nodes: issues
created: 2026-07-02T10:15:42.772Z
---

The unified Issue port reads both stores but writes only local. A durable concern that outgrows the repo (needs CI/external visibility) has no promote path — a future verb on [[issues]] should move a local thread to the forge (open the forge issue, mark the local one landed with the permalink).

<!-- reply: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c @ 2026-07-02T11:30:25.306Z -->
Built: `spex issues promote <id>` — forge issue composed from the thread (concern→title; body + Spec: marker + evidence hashes + provenance footer), created through the driver's one write verb (createIssue); local thread resolves landed with the permalink reply. Create-first ordering keeps failure safe; only open threads promote. Measured end-to-end against the real forge (github#27 probe).
