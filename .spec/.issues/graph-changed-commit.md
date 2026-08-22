---
concern: graph-changed 在一次 commit 轮次里可发两次，测试的等值断言因此在超发时失败
by: ded4b563-50b9-4146-b860-e98e0d073700
status: open
nodes: graph-stream
created: 2026-08-22T04:54:01.830Z
---

# 待提 issue（需从主检出运行 `spex issue open`，worktree 被守卫拒绝）

Spec: graph-stream

## 标题
graph-changed 在一次 commit 轮次里可发两次，测试的等值断言因此在超发时失败

## 正文

`graphStream.api.test.ts:247` 的等待条件是

    waitFor(() => events.filter(e => e === 'graph-changed').length === before + 1,
      `commit ${round} did not produce exactly one graph change`)   // 默认 5000ms

`=== before + 1` 这个等号在**超发**时同样失败，不只在欠发时失败。而超发确实会发生。

### 证据

- 七对交错 A/B（每对一次 main、一次带无关改动的候选分支）：main 失败 2/7，候选 1/7。与被测改动无关，是 main 自身行为。
- 另一条 session 独立在 main `df8e8c649` 上五次隔离运行，得 4 过 1 挂，已进 flaky 注册表。
- 失败那次的服务端日志：**一次 commit 轮次里出现两次** `graph refresh revision moved — signalled=full scope=full inputs=[root, main]`，加两次 `cache-commit scope=full`。计数一步越过 `before + 1`，等式此后永不成立，空转到 5 秒超时。
- 内存 PSI full avg10 全程 0.00；瓶颈是 CPU 争用（16 核，load 5.9–29.9），不是内存。

### 这是产品问题，不是测试娇气

测试写 `=== before + 1` 是因为契约本来就是「一次 commit 恰好一次图变更事件」。日志说明刷新信号在某些时序下没被合并成一次。先定契约再动代码：

- 若合并应当保证「一次 commit 一次事件」→ bug 在刷新路径，测试是对的。
- 若事件本就允许重复、消费者应当幂等 → 契约要改写，测试应断言「至少一次」，且 dashboard 的 delta 应用逻辑要一并复核。

两条路成本差别很大。

### 复现

在 main 上重复跑 `spec-cli/src/graphStream.api.test.ts`，负载越高越易命中，实测约 1/5–2/7。失败恒定是第一个用例 `backend watcher plateaus and delivers three consecutive ref changes exactly once`。

<!-- reply: ded4b563-50b9-4146-b860-e98e0d073700 @ 2026-08-22T22:12:32.900Z -->
越会话存续：graph-stream 的 changed 溢报属后端图流 lane，与本次前端重构无涉且未在本会话修复；保持开放待其归属 lane 处理。
