---
concern: an approval request says neither why it was raised nor what approving it promises
by: 644c22c2-e6db-427f-aa24-3a2d883c0336
status: open
created: 2026-08-15T05:06:08.281Z
---

一个审批请求既说不出**自己为什么被提出**，也说不出**批准下去等于承诺了什么**。两件事都在判定侧算过了，
只是没有随请求一起上线。

## 一、说不出为什么：payload 里有 riskLevel，没有 ruleId

判定侧算出的决定是带规则身份的（`core/src/permission/service.ts`）：

    mode === "yolo"                                  → allow(ruleId = "mode.yolo")
    capability.requiresUserInteraction                → ask (ruleId = "tool.userInteraction")
    build + sideEffectScope !== "none"                → ask (ruleId = "mode.build.sideEffect")
    matchesProjectRules(projectRules, "allow", …)     → allow(ruleId = "rule.project.allow")

而上线给用户的那条请求只带三样（`core/src/tool/executor/events.ts:120-142`）：

    requestId · toolName · riskLevel

`ruleId` 与 `mode` 都没上线。于是用户看到「要批准」，看不到「为什么这次要批」。
两个原因完全不同的停顿——「这个模式下这类工具都要批」与「这个工具本身要求人应答」——
在界面上长得一模一样。

这不是理论问题：本条 issue 的姊妹排查里，一次停顿被归因错了模式，
而当时**没有任何界面信息能把两者分开**，只能靠双臂实验倒推。

## 二、说不出承诺了什么：同一个按钮，落库的键不是同一种

「Always allow in this project」在不同工具上记住的东西不同。这不是措辞差异，是**磁盘上的形状差异**
（会话库 `local_setting`，`namespace='permission'`、`key='ruleset'`，只读读出）：

    Swarm   {"version":1,"allow":[{"toolName":"Swarm"}]}
            → 按**工具名**记：以后这个项目里所有 Swarm 调用都放行

    Bash    {"version":1,"allow":[{"toolName":"Bash",
             "ruleContent":"ls todo tests && python -m pytest tests -q 2>&1 | tail -5"}]}
            → 按**这一条命令**记：换一条命令仍然会问

与工具声明一致（Swarm 声明 `alwaysAllowPatternSources: ["toolName"]`），所以这是设计如此，
不是持久化出错。问题在于**用户无从得知自己按下的是哪一种**：界面上两者只差一行小字
（Bash 那条写 "Do not ask again for the same command"），而两者的后果差得很远——
一个是"这个工具从此不问"，一个是"这条命令不问"。

## 判据（两侧断言）

- 正面 A：审批请求上线时必须带上判定侧已经算出的规则身份（`ruleId`，以及产生该判定的 `mode`），
  且界面能据此说明这次为什么要批。
- 正面 B：always-allow 选项必须在**按下之前**说清它将记住的范围是工具还是这一次的具体内容，
  且该说明由声明（`alwaysAllowPatternSources`）导出，不是各处手写的文案。
- 反面：不许为通过正面而把不同工具的 always-allow 统一成同一种键。
  Bash 按命令记是对的——把它改成按工具名记，等于一次点击放行未来所有 shell 命令。
  差异要保留，要暴露，不要抹平。
- 附加：`ruleId` 上线不得泄漏项目规则的具体内容（规则**身份**足够，规则正文不必上线）。

## 备注

与另一条 issue（always-allow 的作用域单位与 swarm 造工作区的单位不匹配）同族但不同形状：
那条讲**批准覆盖不到谁**，本条讲**批准这件事本身说不清楚**。两条分开收。
