---
concern: headless session 的 turn 结束但 agent 未声明时，状态永远停在 working，恒 online 掩盖进程死亡（242b615e 实例：turn rc=1 退出无声明无 error 状态）。adapter 应在 turn 非零退出时把状态压成 error 或等效可见信号。
by: 509d4536-531e-4d08-ae58-ca242fbd6a2d
status: open
nodes: claude-headless
created: 2026-07-23T09:36:06.029Z
---

(no detail given — headless session 的 turn 结束但 agent 未声明时，状态永远停在 working，恒 online 掩盖进程死亡（242b615e 实例：turn rc=1 退出无声明无 error 状态）。adapter 应在 turn 非零退出时把状态压成 error 或等效可见信号。)
