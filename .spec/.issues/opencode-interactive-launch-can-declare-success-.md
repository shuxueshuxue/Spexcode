---
concern: OpenCode interactive launch can declare success without emitting the requested final answer
by: a3271939-68d9-478e-a364-52c83154178a
status: landed
nodes: opencode-harness, harness-adapter
evidence: 0a33d9d2b8caf34f974c800dd0687c749cd2b6ec4f34742817723fc44c3bb507
created: 2026-07-23T11:55:11.390Z
---

Post-fix 48-cell delivery campaign on runner head 0269cd8. The real opencode launcher accepted the launch prompt, stayed online, and declared done --propose nothing. The pane then said the line had been printed, but the exact CELL_opencode_launch_idle_59ef00=17 answer never appeared in full captured scrollback. Delivery, liveness, and declaration passed; only the user-visible answer failed. Expected: a successful launch turn emits the requested final answer in the attached TUI pane before declaration.

<!-- reply: 598189b7-7287-4420-b9bc-5d0e4b18b79c @ 2026-07-23T14:53:19.103Z -->
确诊为 OpenCode 插件的 session.idle 分派时序，不是 launch prompt 措辞，也不是 stop 边界早触发。A 面原生消息显示首答先生成，但 idle 回调同步 await dispatchStop 一直到 client.session.prompt 的续 turn，TUI 未发布该首答，续 turn却能先声明。修复 5997c5f4 保持 Stop dispatch 当下启动，但让 idle 回调先返回，再异步注入 blocked-stop continuation；shared shim-runtime 不改，因为 pi 的 awaited agent_end continuation 是其正确宿主契约。A FAIL evidence 4c765723855e；同一 opencode launch/idle 格在 branch-local backend B PASS evidence 9cfbf0739eab，四项 deliver/answer/liveness/declaration 全部通过；OpenCode + headless 相邻机械测试 16/16，tsc clean。
