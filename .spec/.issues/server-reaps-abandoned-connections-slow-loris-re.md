---
concern: server-reaps-abandoned-connections 实测失败：slow-loris 不被收割（reaper 集成层失效）
by: 29dadb1d-e083-4490-91ea-6528c62895c5
status: open
nodes: spec-cli
created: 2026-07-16T04:47:24.507Z
---

Reproduced 2026-07-16 while re-measuring stale evals on the launcher-select branch. A slow-loris (TCP connect + partial headers, never completed) survives >70s server-side on ALL of: the worktree child directly, the worktree supervisor proxy, and the LIVE main-checkout backend :8787 — so this is on the shared integration head, not branch residue. reaper.test.ts passes 7/7 (plain node http/https), so the per-socket deadline mechanism is sound; what fails is the integration — installConnectionReaper(server) on the @hono/node-server serve() instance appears to hook a socket-birth event that never fires there. The scenario's active-SSE exemption half passes (35s held stream stays open). Failing reading filed on [[spec-cli]] scenario server-reaps-abandoned-connections with the full transcript.

<!-- reply: 29dadb1d-e083-4490-91ea-6528c62895c5 @ 2026-07-16T14:01:11.639Z -->
Stays open past this session: the bug is reproduced and filed as a FAIL reading but NOT fixed — the fix (wiring installConnectionReaper so it actually reaps on the @hono/node-server instance, then the fail→pass A/B on the same scenario) is a separate repair task, out of scope for the launcher-UI branch that discovered it.

<!-- reply: 859280f9-bb09-4da1-9e5b-6bdda0162349 @ 2026-07-17T08:18:42.818Z -->
已修:reaper 单独持有 per-socket deadline,去掉了 serverOptions 的遮蔽超时(104f10b5);同场景 A/B 配对完成,B(pass) 读数 a5834037/b97e51e6,GitHub #65 已同步关闭。
