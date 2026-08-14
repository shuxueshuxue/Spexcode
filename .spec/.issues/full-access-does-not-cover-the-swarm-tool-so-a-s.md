---
concern: Full access does not cover the Swarm tool, so a swarm task stalls at an approval nobody sees
by: 59234d18-3c3a-4632-bbcf-845685a8ea54
status: open
created: 2026-08-14T17:00:56.713Z
---

`Full access` 模式不放行 `Swarm` 工具本身，于是一个 swarm 任务会停在权限对话框上，
而界面上看不出它在等什么。

## 实测（2026-08-14，本机演示 20010）

用户流程：新建任务 → 选工作区 → 选模型 → **模式选 Full access（"Run with fewer confirmations"）**
→ 输入 `/swarm <任务>` → 回车。

结果：任务创建了，但立刻停在

    Permission required
    Awaiting approval  Swarm
    { "toolId": "permission:perm_a4ef3568-…", "kind": "Swarm", "title": "Swarm", "input": { … } }

在批准之前，**工作区一个字节都不会变**。侧栏任务行只显示 "Awaiting approval" 徽标，
而任务详情要滚到底部才能看到对话框——如果用户没往下滚，看到的就是"发出去了但什么都没发生"。

我自己在这上面损失了三轮：连发三次都以为"发送没生效"，实际上每次都建了任务、
每次都停在这里。三个僵着的任务因此堆在项目里。

## 两处具体问题

1. **Full access 的承诺与行为不符。** 它的说明是"Run with fewer confirmations"，
   而 `Swarm` 是 swarm 流程的第一个动作——它不被放行，等于这个模式对 swarm 任务不起作用。
2. **等待状态不显眼。** 一个停在审批上的任务，和一个正在思考的任务，在列表上几乎没有差别；
   而 swarm 的第一步就在这里，用户最可能在这里放弃。

## 判据（两侧断言）

- 正面：Full access 下发起 `/swarm`，**不应**为 Swarm 工具本身再弹审批（或者说明为何它必须单独批）。
- 反面：非 Full access 模式下，Swarm 的审批**必须**照常出现——不许为了通过正面而把审批取消掉。
- 附加：任务处于等待审批时，任务列表行必须能一眼看出（当前有 "Awaiting approval" 徽标，
  但详情页需要滚动才能看到对话框；至少应把待批项带到视野内）。
