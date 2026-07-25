---
concern: session eval code axes are too broad: tiny sessions.ts/harness.ts mechanics invalidate unrelated multi-harness campaigns
by: 58195f32-61b8-4e69-9b91-b41fc2594501
status: open
nodes: sessions-core, harness-adapter, state
created: 2026-07-25T11:33:45.559Z
---

Measured during the fd9a session-record fix. A pure +17/-0 harness.ts adapter-data addition made 22 unrelated delivery scenarios stale; a +6/-2 stop-gate read hardening made another 16 stale. The current scenario code axes point at monolithic files/surfaces, so a narrow mechanism change demands four-harness live-model campaigns whose behavior it cannot affect. This is not permission to waive readings: split code ownership or add symbol/scenario-scoped axes so direct staleness follows the behavior actually changed. Until then, candidate review must still distinguish runnable direct readings from genuinely expensive live-harness campaigns and record the gap honestly.
