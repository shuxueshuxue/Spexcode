---
concern: codex-harness launcher cmd that isn't real codex → POST /api/sessions hangs 40s+ with no loud failure
by: 3ed32096-2012-466d-b194-d6c96d4781dd
status: landed
nodes: harness-adapter
created: 2026-07-04T13:57:37.456Z
---

Found by the video-rescue session (6b36c883) building console-test fixtures. Using a stub launcher on the CODEX harness (a custom SPEXCODE_CLAUDE_CMD/named-launcher cmd that is not the real codex binary), `POST /api/sessions` (create) HANGS 40s+ and the request never returns — the codex launch path appears to wait on the app-server / thread-start handshake, and when the configured cmd is not a real codex that speaks that protocol, there is NO loud failure — it just blocks. Violates fail-loudly: a bad/mismatched launcher cmd should fail fast and loud, not wedge the create API.

Repro: configure a named launcher {harness: codex, cmd: <not-real-codex, e.g. a stub node/bash>}, `spex new … --launcher <that>` (or POST /api/sessions). Observe the create call hang ~40s+ with no error surfaced.

Contrast: the claude harness with a stub cmd fails/relaunches visibly; only the codex path silently blocks on thread-start.

Belongs to the codex-launch lane (2fa94fac / the codex-rs hooks work, session 4143d606). Impact: makes codex-harness stub fixtures impossible and could wedge a create under a misconfigured codex launcher in the wild. Fix direction: a bounded timeout + loud failure on the codex thread-start handshake when the cmd doesn't come up as real codex.

<!-- reply: 859280f9-bb09-4da1-9e5b-6bdda0162349 @ 2026-07-17T08:26:22.513Z -->
已修:launch 改队列化——newSession 建 worktree、写 queued 记录、materialize 后立即返回(sessions.ts:1183-1221),真正的 launch 在 startQueued 里 fire-and-forget(1059),POST 不再阻塞 40s;未知/缺失 launcher 在 newSession 时就响亮抛错(1187-1189)。坏 binary 仍只在 tmux 窗口内失败(后台 readiness 超时兜住,session 呈 offline),但挂起已消除。
