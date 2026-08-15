---
concern: always-allow is scoped to a project, but swarm mints a new project per worker, so the approval never covers them
by: 644c22c2-e6db-427f-aa24-3a2d883c0336
status: open
created: 2026-08-15T05:04:43.745Z
---

「Always allow in this project」按项目记住许可，而 swarm 给每个 isolated worker 现造一个新项目。
于是用户批准过的那一次，作用域是一个在他点击时**还不存在**的东西的兄弟——每派一个 worker，
就多一个"你还没允许过的项目"，审批要重来一次。

## 根：project id 就是目录

    core/src/runtime/helpers/project.ts:18
      projectIdFromDirectory(dir) = createProjectId(slugify(dir).slice(0, 80))
    core/src/runtime/methods/events.ts:585
      createSession({ …, projectID: projectIdFromDirectory(directory) })

审批规则按 `projectID` 存取（`tool/executor/permission-flow` 的 `resolveProjectId` → `session.projectID`）。
所以**审批作用域的单位是目录**。而 swarm 的 isolated worker 每人一个新 worktree =
每人一个新目录 = 每人一个新 project = 每人一份空的 ruleset。

## 磁盘读数（只读，未修改任何行）

会话库 `local_setting` 表，`namespace='permission'`、`key='ruleset'`，共 **15 行**：

    普通项目                     4 行
    subagent worktree 项目      11 行   ← 每个 project id 互不相同

    proj_…-zcode-subagent-sess_subagent_agent_3372b0bb-…
    proj_…-zcode-wt-zcode-subagent-sess_subagent_agent_69a1f0fc-…
    proj_…-zcode-wt-zcode-subagent-sess_subagent_agent_7dfbf037-…
    …（11 个）

**写入侧是好的，不要往那儿查。** 三个普通项目里确实躺着 Swarm 的许可规则，
落库形状与工具声明逐字对应：

    Swarm 声明  alwaysAllowPatternSources: ["toolName"]
    Swarm 落库  {"version":1,"allow":[{"toolName":"Swarm"}]}

没有 `tool.permission.project_update.skipped`，规则确实持久化了。**缺陷不在持久化，在作用域。**

## 附带读数：同一个按钮，不同工具落库的键不是同一种

    Swarm  {"toolName":"Swarm"}                                        ← 按工具名
    Bash   {"toolName":"Bash","ruleContent":"ls todo tests && python -m pytest tests -q …"}
                                                                        ← 按具体命令

界面上两者只差一行小字（Bash 那条写的是 "Do not ask again for the same command"）。
用户按下同一个按钮，承诺的范围却不同，而这个差别只能靠读那行小字发现。
这条与「审批请求不带 ruleId」是同族但不是同一条：那条讲**说不清为什么要批**，
这条讲**说不清批下去等于承诺了什么**。

## 判据（两侧断言）

- 正面：在项目 P 中对一次 swarm 派发按下「Always allow in this project」之后，
  该次派发所产生的 worker 不应为同一工具再次索要审批。
- 反面：不许用"取消 worker 的审批"来通过正面。一个**不是**由该次已批准派发产生的会话，
  即使目录相邻，仍必须照常审批；跨项目的许可不得互相泄漏。
- 附加：修复不得改变会话在侧栏中的归组。`projectID` 目前同时承担**审批作用域**与
  **侧栏归组**两个职责，直接把 child 的 `projectID` 改成父的会让 worker 从它自己那组消失，
  并入父项目——那是用户可见的产品形状改动，不属于一个权限修复。

## 已否决的方向（记下来，免得重走）

让 `projectIdFromDirectory` 把 linked worktree 解析回主检出：**否决**。
它改的是共享默认值，任何使用 linked worktree 的会话都会突然共享审批作用域，
包括与 swarm 无关的。swarm 特有的行为差异应当挂在 swarm 自己的调用路径上。
