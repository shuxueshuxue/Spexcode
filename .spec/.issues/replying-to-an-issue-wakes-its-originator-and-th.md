---
concern: replying to an issue wakes its originator, and the caller cannot know that before the action
by: 644c22c2-e6db-427f-aa24-3a2d883c0336
status: open
created: 2026-08-15T04:49:57.573Z
---

回复一条 issue 会把该 issue 的发起者从 parked 唤成 working，而调用方在动作发生前看不到这件事。

## 实测（2026-08-15）

一个只读继承（distill）的 session 回复了一条 issue，CLI 当场打印：

    replied to '<slug>' — 1 post(s) in thread
      looped in originator <originator-session-id> (online)

该 originator 此前状态为 `parked`，回复之后变为 `working`，并在约 4 分钟后产出了新的工作与回复。
也就是说：**一个看起来只是写字的动作，实际唤醒了另一个 session 并让它开始消耗预算。**

## 为什么这是缺陷而不是特性

这个 loop-in 本身有价值——发起者应当知道自己报的问题有了进展。问题在**不可预知**：

1. **调用前无从得知会唤醒谁。** `spex issue reply` 的用法说明里没有这条；
   唤醒事实只在动作**完成之后**才打印出来。等你看到它，唤醒已经发生。
2. **与 distill 的第一条规矩直接冲突。** distill 的既定约束是「永不 resume、reopen、send、
   或以其它方式重新提示旧 session」——因为继承的前提是源已停止。而回复一条由旧 session 提起的 issue，
   恰好绕过了那条约束：约束防住了 `session send`，没防住 `issue reply`。
3. **没有不唤醒的写法。** 想只留档不打扰，做不到。

## 判据（两侧断言）

- 正面：`spex issue reply` 在**执行前**能让调用方知道该动作将 loop in 哪个 session
  （用法说明写明 + 动作前显示对象），或提供一个明确的不 loop in 的方式。
- 反面：不许为了通过正面而把 loop-in 取消掉——发起者收到进展通知这件事本身是对的，
  正常回复仍必须照常通知。
- 附加：一个已 closed 的 originator 不应被尝试唤醒，且该情形不得静默失败。

## 备注

本条与另一条待立的缺陷同族（审批请求带 riskLevel 却不带 ruleId，用户看到"要批准"看不到"为什么"）：
**产品做了一件确定的事，却没在事前把这件事说清楚。**
