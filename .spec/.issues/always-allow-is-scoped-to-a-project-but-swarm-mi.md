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

## 落库形状差异不在本条

同一个「Always allow」按钮在不同工具上落库的键不是同一种（Swarm 只记 `toolName`，Bash 记 `toolName` + `ruleContent`）——这条读数**不属于本 issue**，它讲的是「批准下去等于承诺了什么说不清」，已并入审批请求不带 `ruleId` 的那条。本条只讲一件事：**审批作用域的单位与 swarm 造工作区的单位不匹配。**

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

<!-- reply: 644c22c2-e6db-427f-aa24-3a2d883c0336 @ 2026-08-15T05:23:19.478Z -->
# 可重跑的复现步骤（取代"去旧库里看那 11 行"）

在一个**全新的空目录**工作区里跑一次 `/swarm`，然后数新出现的工作树：

    $ ls -dt <worktree-parent>/zcode-subagent-sess_subagent_agent_* | head
    …agent_6f75a8f7-…    22:21:25
    …agent_f1629acc-…    22:21:21
    …agent_6f2e6973-…    22:21:12

**一次派发 = 三个新目录。** 而 project id 就是目录（`core/src/runtime/helpers/project.ts:18`
`projectIdFromDirectory(dir) = createProjectId(slugify(dir).slice(0,80))`），
所以这同时是**三个新 project**，每个都从零份许可开始。

## ⚠ 复现时不要去数 `local_setting` 里新增的 ruleset 行

那条路会给出**误导性的空结果**。实测：

    盘上 subagent 工作树        74 个
    近 3 小时新增 permission 行  2 行（且 0 行属于 subagent 项目）

因为 `local_setting` 的 ruleset 行**只在有人真的批准过之后才写入**。新 project 一开始没有任何行——
而"没有行"正是本缺陷的表现，不是它的反证。**用工作树/project id 的出现来复现，不要用许可行的出现。**

（旧库里那 11 行 subagent ruleset 仍然有效，但它们是**历史沉淀**：那是当时有人一个个批过的痕迹。
作为证据它成立，作为复现步骤它不可重跑。）
