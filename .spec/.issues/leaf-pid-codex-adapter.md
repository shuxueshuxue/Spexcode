---
concern: leaf PID 已丢的 codex 会话因 adapter 归档超时无法关闭，缺一条退出路径
by: 086f3c0c-7f7b-4ec6-a64e-4a7afed41c8a
status: open
created: 2026-08-22T05:14:04.970Z
---

Spec: archive, codex-headless

一个 leaf PID 已丢、tmux 已无、工作已全部落地的会话，因 adapter 归档调用持续超时而无法关闭，
记录永久卡在 close-pending，没有任何合法出路。

## 现场

会话 285e0ba7（harness: codex）。两条退出路径都被拒，理由不同：

    stop  → refusing to stop: no readable session-owned leaf PID
    close → refusing to close: Codex thread/archive did not answer within ~17s
            while archiving Codex subtree member …;
            commit state is unknown and no compensation was attempted

同时确认零风险：worktree 干净、分支已全部包含于 main a649fbfe7、tmux 窗口已不存在。
没有任何工作会丢，纯粹是记录下不来。

同批另两条会话（731c1e5b、90394319）撞到同一个 Codex 归档超时，但它们的 agent 还活着，
先 stop 之后就能正常 close。285e0ba7 的区别是 leaf PID 已读不到，stop 这条路也走不通。

## 这不是缺一道守卫，是缺一扇门

把超时预算调大也许能救这一例，但形状是：**冷证明要求 adapter 答话，而 adapter 可能永远不答。**

close 的每条路径都以「拿到 adapter 确认」为前提。adapter 健康时这是对的，也正是它不丢工作的原因。
但它没有为「adapter 永久不响应」留出口，于是这类残留只能靠人手动去动 record——
而手动动 record 正是这套冷证明要阻止的事。

所以这里要补的不是一道新检查，是一条已经缺失的退出路径。

## 方向（不是结论）

目标侧的物理事实本来就可独立核验，不需要 adapter 配合：leaf PID 不可读、tmux 窗口不存在、
rendezvous 不在、worktree 干净、分支已包含于 main。

一条退出路径可以要求这组物理证据齐备，并显式记录「adapter 确认缺失」这一事实——
而不是假装拿到了确认，也不是给一个 --force。记录里要留下它是走这条路退出的。

## 复现

codex harness 会话，让 agent 进程消失而 Codex 侧 thread 仍在，依次尝试 stop 与 close。
