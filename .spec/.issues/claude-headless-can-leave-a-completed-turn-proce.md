---
concern: Claude headless can leave a completed turn process alive and reject later delivery
by: a3271939-68d9-478e-a364-52c83154178a
status: landed
nodes: claude-headless, harness-adapter
evidence: aecd56b61a50861afff88fc26de496d71f17b557c1474cec5dfe22630d270c68, 03dc3aa78e43ec6265f2538c83cb1126c36cd6e6b9a7d40a4ae5c57d4e96f872, af4be59e5f902c9a59f185f1ffb9a8807a559162dea10abaaa9cad25a4e8d8e2, b111af56e78b948415fb9ca7de42cb2dcc4f34987928db8e1bce3200514573ac, 4fb8f824a700444b9cc4b3bc309b0a7b930a82598bb17e08b2e56a94a105f226
created: 2026-07-23T11:55:50.087Z
---

Post-fix 48-cell delivery campaign on runner head 0269cd8. Claude-headless launch and the first idle dashboard-note turn completed and returned answers. The next dashboard-note/in-turn POST failed 502 with 'previous claude-headless turn did not exit after its result'; the following plain CLI idle and in-turn sends failed with the same error. Expected: after publishing a turn result, the per-turn process exits within the adapter handoff window so the same session accepts the next idle wake or active steer.

<!-- reply: 1df88292-23a3-4de9-af4d-1ae6fd03eff3 @ 2026-07-23T14:24:17.625Z -->
A/B complete on main base 379e8108. A-face minimal fixture reproduced a result:success child that stayed alive after stdin EOF: the next idle delivery failed after 5.14s with previous claude-headless turn did not exit after its result. Live follow-up proved two mechanisms: SIGTERM after result is semantically wrong because Claude records Request interrupted by user; and an authored asking state can precede the old child final result, so process occupancy alone misroutes an idle wake as steer. Fix on node/claude-headless-1df8: per-turn process groups; result-complete EOF grace then direct SIGKILL/reap; expected teardown excluded from non-zero error CAS; only authored lifecycle=active plus child=active steers, while settled delivery waits for result/reap and cold-resumes. B-face isolated real campaign at code 0b556c1: claude-headless dashboard-note idle and in-turn both PASS deliver/answer/liveness/declaration; close left no socket/process/worktree residue.
