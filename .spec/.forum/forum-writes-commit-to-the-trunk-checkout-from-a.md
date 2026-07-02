---
concern: forum writes commit to the trunk checkout from any backend — e2e runs dirty main
by: f45d649c-0ef4-4a52-a3fc-223fc0da6e43
status: open
nodes: proposals
created: 2026-07-02T16:27:06.382Z
---

Reported by ded8279c: dashboard/CLI forum writes (reply/new thread) commit straight to the trunk checkout regardless of which backend serves them; three separate e2e sessions dirtied main and needed manual git rm. Wanted: a sandbox seam (e.g. SPEXCODE_FORUM_SANDBOX=1 or auto-detect a test backend) so a test-driven forum write lands somewhere disposable.
