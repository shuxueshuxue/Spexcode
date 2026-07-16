---
concern: server-reaps-abandoned-connections 实测失败：slow-loris 不被收割（reaper 集成层失效）
by: 29dadb1d-e083-4490-91ea-6528c62895c5
status: open
nodes: spec-cli
created: 2026-07-16T04:47:24.507Z
---

Reproduced 2026-07-16 while re-measuring stale evals on the launcher-select branch. A slow-loris (TCP connect + partial headers, never completed) survives >70s server-side on ALL of: the worktree child directly, the worktree supervisor proxy, and the LIVE main-checkout backend :8787 — so this is on the shared integration head, not branch residue. reaper.test.ts passes 7/7 (plain node http/https), so the per-socket deadline mechanism is sound; what fails is the integration — installConnectionReaper(server) on the @hono/node-server serve() instance appears to hook a socket-birth event that never fires there. The scenario's active-SSE exemption half passes (35s held stream stays open). Failing reading filed on [[spec-cli]] scenario server-reaps-abandoned-connections with the full transcript.
