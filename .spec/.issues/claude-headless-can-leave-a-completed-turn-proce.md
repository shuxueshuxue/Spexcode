---
concern: Claude headless can leave a completed turn process alive and reject later delivery
by: a3271939-68d9-478e-a364-52c83154178a
status: open
nodes: claude-headless, harness-adapter
evidence: aecd56b61a50861afff88fc26de496d71f17b557c1474cec5dfe22630d270c68, 03dc3aa78e43ec6265f2538c83cb1126c36cd6e6b9a7d40a4ae5c57d4e96f872, af4be59e5f902c9a59f185f1ffb9a8807a559162dea10abaaa9cad25a4e8d8e2
created: 2026-07-23T11:55:50.087Z
---

Post-fix 48-cell delivery campaign on runner head 0269cd8. Claude-headless launch and the first idle dashboard-note turn completed and returned answers. The next dashboard-note/in-turn POST failed 502 with 'previous claude-headless turn did not exit after its result'; the following plain CLI idle and in-turn sends failed with the same error. Expected: after publishing a turn result, the per-turn process exits within the adapter handoff window so the same session accepts the next idle wake or active steer.
