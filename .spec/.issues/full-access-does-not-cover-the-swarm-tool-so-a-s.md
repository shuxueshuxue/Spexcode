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

<!-- reply: 644c22c2-e6db-427f-aa24-3a2d883c0336 @ 2026-08-15T04:41:30.126Z -->
# 重述（本条取代标题所述的断言；标题已改，原标题逐字保留于下）

**原标题**（逐字，未改写、未润色）：

> Full access does not cover the Swarm tool, so a swarm task stalls at an approval nobody sees

该标题的前半（"Full access 不覆盖 Swarm"）已被证否，见第二段；后半（"an approval nobody sees"）成立，
见第三段。标题已改写以免最先被读到的就是那句已被证否的断言。

## 一、原观测（元帅一手描述，原样保留，不改一字的意思）

用户流程：新建任务 → 选工作区 → 选模型 → **模式选 Full access** → 输入 `/swarm <任务>` → 回车。
结果停在 `Permission required / Awaiting approval  Swarm`，
且「在批准之前，工作区一个字节都不会变」；报告者自述在此损失三轮，
三个僵着的任务因此堆在项目里；对话框要滚到详情底部才看得见。

## 二、当前头上的复现结果

头 `b2d27eeaf`（集成头 `7fa644271` + 构建链修复）。独立栈 `:20050` web / `:20051` 自带 backend，
**未设 `ZCODE_AGENT_SERVER_COMMAND`**，真模型 `builtin:bigmodel/GLM-5.2`。
判据在跑之前落盘（`CRITERIA-fullaccess-swarm.md`），双臂只差一个自变量，
mode 从 `<select>` **读回控件值**校验，≠ 目标值即判夹具无效。

判据只认 `PermissionDialog` 独有的结构属性 `[data-permission-option-kind]`
与真实 worker 行 `[data-subagent-session-id]`，不做整页文字匹配。

| 臂 | mode（读回值） | 审批对话框 | 首个 worker 行 | worker 峰值 | 窗口 |
|---|---|---|---|---|---|
| B（阳性对照） | `build` | **有，+12s** | never | **0** | 240s |
| A | `yolo`（= Full access） | **无** | +54s | **5** | 240s |

臂 B 先跑并先红——一个从未产出过红的判据没有资格认定「没有对话框」。

### 结论：这是一次观测归因错误，不是产品行为错误

元帅那句「在批准之前，工作区一个字节都不会变」**是真的**——臂 B 的
`maxSubagentRows=0` 正是它：build 下弹框发生在任何 worker 被派出之前。
但它属于 **build 那一格**，不属于 Full access。Full access 下 Swarm 不弹框、直接派活。

源码侧的顺序证明与读数一致（`core/src/permission/service.ts`）：

    :70  planModeTransition        只 return allow / deny，产不出 ask
    :77  requiresUserInteraction   Swarm 恒 false（:430-433 两条解析路径都不成立）
    :95  mode === "yolo"           → allow(ruleId = "mode.yolo")
    :336-346 build + sideEffectScope !== "none" → ask(ruleId = "mode.build.sideEffect")

Swarm 的 `sideEffectScope: "workspace"`。所以 build 必弹、yolo 必不弹，与两臂完全对应。

并且这不是「后来被修好了」：`git log -S 'needsApproval: false'` 与
`git log -S alwaysAllowPatternSources` 在 swarm 那块都只有 `f62e02458` 一条，声明从未变过。

### 那次观测为什么会落在 build 上：两个并列候选，都未结案

- **C1** 自动化驱动没真把 mode 设上。mode 控件是原生 `<select>`，点 option 文本设不上值，
  而「option 文本出现在页面里」是个假阳性——本次排查中我自己就先踩了这个坑，第一跑因此作废。
  能解释当时那些自动化 lane 的观测，**解释不了报告者人手操作的那三次**（人手点原生 select 会真设值）。
- **C2** mode 在链路上丢失，被静默兜成 `build`。权限判定取 mode 的实际链路是
  `call-runner.ts:127 getMode()` → `permission-flow.ts:53` → `service.ts:95`，
  而同一个默认值有三处出口：

      runtime/methods/config.ts:111         AgentRuntime.getMode() 方法本体
      runtime/helpers/runtime-tools.ts:187  传给工具执行器 deps 的那份（权限判定实际用的）
      runtime/session-mode-port.ts:7        端口那份

  三处都是 `config.mode ?? "build"`。默认值本身不是缺陷，**丢失后静默兜成"必然弹框的那个模式"才是**。
  `getMode()` 是现取不是构造期快照，所以「切模式发生在建任务之后所以没生效」可以排除。

**C2 在当前头当前路径不复现，既未证实也未证伪，留档。** 结案需要一条"曾经发生过"的证据：
报告者那三次里任意一次留下的 session 记录或事件，能看出该次判定用的是 `build`。
不复现 ≠ 不存在。

## 三、重述后剩下的真内容

原 issue 的两条要求里，第 1 条（Full access 的承诺与行为不符）**不成立**，撤回。
剩下这两条成立，且与模式无关：

1. **等待审批的任务在界面上不可辨。** 报告者原文「nobody sees」那半是真的：
   任务详情要滚到底部才看得见对话框，任务列表行只有一个 `Awaiting approval` 徽标，
   与"正在思考"几乎无差别。判据：任务处于等待审批时，待批项必须被带进视野。
2. **审批请求说不出自己因哪条规则产生。** 上线的 payload 只有
   `requestId / toolName / riskLevel`（`tool/executor/events.ts:120-142`），
   **没有 `ruleId`，也没有 `mode`**。用户看到"要批准"却看不到"为什么"，
   而判定侧其实已经算出了 `ruleId`（`mode.yolo` / `mode.build.sideEffect` / `tool.userInteraction`）。
   这一条已同意**另立**，不并入本 issue。

## 四、本次排查中作废的读数（一并留档，避免被后人当证据用）

- 第一跑：夹具无效——原生 `<select>` 未真正设值，且「option 文本出现在 `body.innerText`」是假阳性。
  **废在仪器，不在产品**：自变量根本没被设上，该跑没有测到任何产品行为。
- 第二、三跑：判据不能区分——两分支都在整页文字上正则，侧栏挂着别的工作区的任务标题会误命中；
  同一自变量下给出相反判定。**废在仪器，不在产品**：产品每次的行为可能完全一致，
  是判据没有能力把两种世界分开。
- 其中第二跑的判定文字是 `STALLED-ON-APPROVAL`，**它看起来像一条结论，但它不是**——
  后人若检索到这个字符串，请以本段为准。

**以上三跑作废的原因全部在测量侧，与产品行为无关。**
- 污染记账：驱动回落到全局 New task，任务实际落在 `demo-head-644c`（非空树）。
  对本结论无影响（审批在工具权限层，先于 handler 的 spec 校验），但后续端到端一律用
  `/home/jeffry/zswarm-acceptance-empty`。

## 附注 · 截断器不许当最后一环

本次排查里我下过一句错误断言：「`runtime/helpers/runtime-tools.ts` 在这棵树上不存在」。
它底下是一条以 `| head -6` 结尾的 grep——命中恰好多于 6 条，第 7 条就是那个文件。
**读数被截断，断言却按"全部"来下。**

这与元帅台账里「取证命令不要以管道结尾」「`| tail` 吃掉 pnpm 的 exit 2」是同一族，
而我本次也确实第二次踩到它：后台构建包了一层 `; echo "EXIT=$?"`，
把真实的 exit 2 报成了 exit 0，几乎让我照着假绿往下走。

规则：**凡是拿来下判断的命令，不许让 `head`/`tail`/管道当最后一环。**
需要限行数时，先取全量落盘再看；需要退出码时，退出码必须是被检查的那条命令自己的。

这一族同样会长在产品里，不只长在取证里：同期在交付闸上量到，
lint 失败理由被 `summarize()` 截到 400 字符且只保头，
而 lint 输出把「怎么修」放在末尾 —— 于是 worker 拿到的失败理由里，
可执行的那半恰好被切掉，闸要求"能自愈"就成了空话。修法是头尾都留。
