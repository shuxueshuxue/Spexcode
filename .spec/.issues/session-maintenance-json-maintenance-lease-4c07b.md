---
concern: 下次发版时清掉 session-maintenance.json 残留行（maintenance-lease 已于 4c07b281 删除） 节点 [[maintenance-lease]] 及其模块已在 4c07b281 合入 main 时删除，但每个 project 的 runtimeRoot() 下仍留着一个 `session-maintenance.json` 死文件，需要在下次正常发版滚动时顺手清掉。 **为什么不能现在清**：ThinkPad 与 mbp 的 npm-global 是合入前本地打的 tarball（0.5.8 / 0.5.6），仍含该模块并持续重写这些行；删了立刻长回来（实测：本机删掉 74 行后 10 分钟内回来 6 个）。要等这两处重装到合入后的版本才 durable。 **发版滚动时，在 iron ordering 的 verify 之后各机加一句**： ``` rm -f ~/.spexcode/projects/*/session-maintenance.json ``` **各机状态（2026-07-29 记录）**： - gugu / macmini —— 已完成。其 0.5.2 早于租约、从不含该模块，行是 7/28 实现当晚一次性写入的孤儿，已删，backend health 200。 - z-code / mbp —— npm-global 0.5.6 含模块，待重装后清。 - ThinkPad —— npm-global 0.5.8 含模块；另有多个兄弟 worktree 仍停在合入前分支，它们退休或合入后才会停止写入。 无功能影响，纯死文件；漏做只是留下无人读取的 177 字节。
by: 0c99827e-bce6-48d3-9576-d286938fca65
status: open
nodes: runtime, maintenance-lease
created: 2026-07-29T11:32:03.709Z
---

(no detail given — 下次发版时清掉 session-maintenance.json 残留行（maintenance-lease 已于 4c07b281 删除）

节点 [[maintenance-lease]] 及其模块已在 4c07b281 合入 main 时删除，但每个 project 的 runtimeRoot() 下仍留着一个 `session-maintenance.json` 死文件，需要在下次正常发版滚动时顺手清掉。

**为什么不能现在清**：ThinkPad 与 mbp 的 npm-global 是合入前本地打的 tarball（0.5.8 / 0.5.6），仍含该模块并持续重写这些行；删了立刻长回来（实测：本机删掉 74 行后 10 分钟内回来 6 个）。要等这两处重装到合入后的版本才 durable。

**发版滚动时，在 iron ordering 的 verify 之后各机加一句**：
```
rm -f ~/.spexcode/projects/*/session-maintenance.json
```

**各机状态（2026-07-29 记录）**：
- gugu / macmini —— 已完成。其 0.5.2 早于租约、从不含该模块，行是 7/28 实现当晚一次性写入的孤儿，已删，backend health 200。
- z-code / mbp —— npm-global 0.5.6 含模块，待重装后清。
- ThinkPad —— npm-global 0.5.8 含模块；另有多个兄弟 worktree 仍停在合入前分支，它们退休或合入后才会停止写入。

无功能影响，纯死文件；漏做只是留下无人读取的 177 字节。)

<!-- reply: 0c99827e-bce6-48d3-9576-d286938fca65 @ 2026-07-29T11:33:35.115Z -->
保持 open——这条的工作**尚未完成**，且按人的指示明确推迟到下次正常发版。

现在关掉会是假闭环：ThinkPad 与 mbp 的 npm-global 仍是合入前打的 tarball（0.5.8 / 0.5.6），仍含该模块并持续重写这些行；在它们重装之前，任何删除都会在几分钟内被写回（本机实测：删掉 74 行后 10 分钟内回来 6 个）。

关闭条件：这两处装上合入后的版本，各机执行 `rm -f ~/.spexcode/projects/*/session-maintenance.json` 并确认不再生成。gugu 那一份已在开 issue 当天完成（其 0.5.2 早于租约、从不含该模块），无需等待。
