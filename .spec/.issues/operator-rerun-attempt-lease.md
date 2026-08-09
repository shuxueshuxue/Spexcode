---
concern: 修 operator rerun 超时被印成终态结论「未入队」：同一请求零状态变化重试即成功，人却被指向 attempt lease
by: 9be33950-7166-40fd-8d62-5d3a3390cdf7
status: open
created: 2026-08-07T12:51:55.307Z
---

## 实测（三条请求，同一时刻，同一脚本，同一 lease 形态）

    !1886 attempt=3 phase=active  ->  {"conclusion":"not-queued","detail":"接纳截止后 attempt lease 保持未消费"}  exit=1
    !1887 attempt=4 phase=active  ->  {"conclusion":"not-queued","detail":"接纳截止后 attempt lease 保持未消费"}  exit=1
    !1927 attempt=4 phase=active  ->  {"accepted":true,"dispatchAttempt":5,"status":"queued"}                     exit=0

三条 lease 的 `phase` 全是 `active`，`sessionId` 全都在，三个 session 的 worker 全都已经结束
（一个连 tmux 都没有，两个 pane 掉回 0% CPU 的 `-zsh`）。**唯一的差别是第三条请求拿到了应答。**
listener 日志里 `!1927 @ 3f3c8a70 (dispatch 5)` 落盘，1886/1887 没有任何 dispatch 行。

## 缺陷有两层

**一层：措辞把人指向错误的地方。** 这条结论出自 `classifyTimedOutRerun`
（`scripts/cr/cr-listener-control.mjs`，末尾无条件 `return { conclusion: "not-queued", … }`）——
它只在**控制面调用超时之后**才运行。真实原因是「listener 忙，5s 内没应答」（见 #41 #82），
而 detail 说的是「attempt lease 保持未消费」。lease 只是它超时后回读到的**旁证**，不是原因。
我本人照这句话去查 lease phase，走了一整段错路，并且差点去动 append-only 的 `~/.zcode-cr/`。

**二层：一个瞬时症状被报成终态分类，且不给下一步。** 那个 `return` 没有任何分支区分
「确实没入队」与「不知道有没有入队」，也不告诉人「重试即可」。实测重试**零状态变化**就成功了。

## 修的方向

1. 超时路径的结论必须**自承其不确定性**：拿不到应答就是 `unknown`/`timed-out`，
   不得在没有证据的情况下断言 `not-queued`。要断言未入队，必须有正面证据（如 dispatch 行缺失 + 队列快照）。
2. detail 要说**它实际观测到的那件事**（控制面超时），lease 状态最多是附注。
3. 给出修复入口：「listener 正忙，重试」——这是本轮反复出现的「结论没有第二去处就落进兜底」的同一形状。

## 不许这样收口

- 不许只把文案改软而保留同一个无条件 `return`。
- 不许靠拉长超时了事 —— 那治的是 #41 的症状，而这条缺陷是「不知道被印成知道」。

<!-- reply: 9f21aaf5-2745-46f8-bcb9-2f21455b6acb @ 2026-08-07T21:57:21.154Z -->
Spec: cr-listener-control

2026-08-07T21:xxZ live recalibration: !1666 was rejected before receipt because one 5s absolute admission budget performed two sequential GitLab head proofs. The first proof and terminal identity passed; the second, lock-held proof timed out. Lease, ledger, reports, and queue remained unchanged. This is distinct from the socket-response-timeout branch described above.

Landed zcode-spec cad70220f. Exact rerun and legacy replay now have one live head proof under the same lease lock immediately before archive/receipt/FIFO mutation; the lock-external proof is gone. The 5s deadline was not relaxed.

Measured A/B: clean d0856a15 baseline with two 2.6s fetches -> 5.138s not-queued at locked proof and zero mutation. cad70220 with the same fixture -> 2.737s queued with one proof. A subsequent live !1666 dispatch 4 was accepted and terminally completed at 2026-08-07T21:53:46.524Z as done / ags-unjudgeable, removing its red projection.

Do not close this issue yet: the original socket response-timeout classification path was not remeasured by this fix.

<!-- reply: 9f21aaf5-2745-46f8-bcb9-2f21455b6acb @ 2026-08-09T12:10:48.724Z -->
Spec: cr-listener-control

Verified against the live zcode-spec source: `node --test --test-name-pattern="response timeout with an unchanged active lease remains unknown" scripts/cr/cr-listener-rerun.process.test.mjs` passed (1/1).

`classifyTimedOutRerun` now returns `unknown` with an explicit safe-retry detail when the control response times out and the active lease is unchanged; no lease or ledger mutation occurs. The repair is present at `6645f0b8a6`.
