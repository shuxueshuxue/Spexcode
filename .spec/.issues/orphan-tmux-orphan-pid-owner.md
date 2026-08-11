---
concern: orphan 归属把活的主后端/网关/tmux 服务器判成 orphan，且同一 PID 被两个 owner 同时认领
by: 455707e5-dc60-4535-9138-5155be816b07
status: open
nodes: host-resource-budget
created: 2026-08-11T07:52:28.712Z
---

Spec: host-resource-budget

## 现象

`spex session resources` 报出的 `orphan:owner-record-absent` 分类不可作为任何回收依据。在一台
16 核 / 30 GiB 的 Linux 宿主上实测（2026-08-11，事故恢复后），11 个 orphan 合计 2487 MiB，其中：

**1. 一个 orphan owner 吞掉了整个舰队。**

`orphan backend 9dbe7b0f-885b-4c58-b90a-c7a054624046`（报 1295 MiB）的 `processes[]` 含 90 个 PID，
里面包括：

- 活着的项目主后端（`:8787` 监听者）及其 supervisor
- 对外 dashboard 网关（`:9443` 监听者）
- 承载全部 governed session 终端的 `tmux -L spexcode` 服务器
- 另外两个 project 的活后端（`:8788`、`:5174`）
- 两个 benchmark fixture 的活后端（`:3032`、`:8892`）
- 一个活着的 governed session 的 agent 进程
- 读取该报告的那个 CLI 进程自己

**2. 同一个 PID 被两个不同 owner 同时认领。**

PID `1129211`（`:8787` 主后端）同时出现在 `9dbe7b0f` 和 `f76cfae8` 两个 orphan owner 的
`processes[]` 里。一个进程只能有一个 owner；这是归属逻辑本身出错的硬证据，与 PID 复用无关
（两次读取在同一份快照内）。

**3. `reclaim.eligible=true` 同样不可信。**

被标为 `eligible: true, reason: "process carries this project and session identity, but the owner
record is absent"` 的 owner 中：

- 一个的唯一 PID 是 `reclaude _daemon`（正在监听两个 loopback 端口，是全部 claude worker 的
  凭据/网关守护进程）。停掉它会造成全体 dispatched worker 401。
- 一个的唯一 PID 是一个**正在监听 `:3037` 的活 backend**。

按 `eligible=true` 执行回收，会打掉活的基础设施。

## 影响

- 该字段目前的唯一安全用法是「读一眼」，不能进入任何自动或半自动回收路径。
- 它也阻塞了把 per-project 并发上限提升为 per-host 上限的工作：host 级 occupancy 必须建立在
  同一份归属数据上，归属错了，occupancy 也错。

## 与现有 spec 的关系

本节现有条文「a budget breach or suspected orphan is a resource finding, not an inferred lifecycle
transition」和「budget age/status alone never authorizes stop」在本次事实面前是**正确且必要的**：
它们挡住了一次会打掉主后端、网关和 tmux 服务器的自动回收。建议保留该禁令，并在本节补一条明确的
可信度声明——在归属可证明正确之前，`orphan` 与 `reclaim.eligible` 都不是可执行结论。

## 复现

在一台同时运行多个 project backend（含 supervisor+child 双进程结构）、且历史上关闭过若干 session
的 Linux 宿主上执行 `spex session resources --json`，检查：

1. 各 `orphan` owner 的 `processes[]` 是否包含当前监听公开端口的 PID；
2. 是否存在同时出现在两个 owner `processes[]` 中的 PID。

## 对照：可用的替代判据

本次实际回收改用可直接证明的活性事实，安全释放 14 个进程且零误伤（六个关键端口全部保持在线）：

- backend 的 `cwd` 已指向被删除的目录（`/proc/<pid>/cwd` 以 `(deleted)` 结尾）
- benchmark 目录 6 小时零文件写入，且其端口上仅有同 PID 的 loopback 自连接（supervisor↔child
  代理），无外部 ESTAB
- tmux socket 名为测试 fixture 名，且其 project 目录已删除

停进程时以 `(pid, starttime)` 双重身份校验，令牌不符即放弃。注意 `starttime` 必须先剥掉
`/proc/<pid>/stat` 的 `comm` 字段再数——`comm` 可含空格（如 `tmux: server`），直接取第 22 个字段会错位读出 0。

<!-- reply: 455707e5-dc60-4535-9138-5155be816b07 @ 2026-08-11T08:20:20.744Z -->
Spec: host-resource-budget

## 补充证据：那条 `idle-cpu-over-budget` 指的是 tmux 服务器，而且它并不空闲

追查 `orphan backend 9dbe7b0f-…` 持续多轮报出的 `idle-cpu-over-budget`（观测区间内在
20% ~ 114% 之间波动）时，把该 owner `processes[]` 里每个 PID 的累计 CPU（`/proc/<pid>/stat` 的
utime+stime）取出来排序，最大的一项是：

    pid=17273   累计 CPU 23517 s (约 6.5 小时)
    cmdline:    tmux -L spexcode new-session -d -s <session-id> …

也就是**承载全部 governed session 终端的那个 tmux 服务器**。次大的两项分别是另一个 project 的活
backend（累计 2234 s）和一个 `/tmp` fixture backend（1100 s）。

这使同一条 finding 在三个方向上同时错误：

1. **不是 orphan** —— 它是当前所有活 session 的终端复用器；
2. **不是 idle** —— 那些 CPU 是它为十余个活 session 渲染 pane、捕获输出的真实开销，
   `idle-cpu-over-budget` 的前提（owner 非 active 却在耗 CPU）不成立；
3. **不是一个可回收单位** —— 该 owner 把 tmux 服务器、两个活 backend 和若干无关进程装在同一个桶里，
   桶内既没有共同 owner，也没有共同生命周期。

后果比首帖描述的更直接：如果有任何自动或半自动路径响应 `idle-cpu-over-budget` 去回收这个 owner，
**每一个活 session 会同时失去自己的终端**，而这恰好是操作者在宿主过载时用来恢复的最后一条通道。

## 这对判据设计的含义

`idle-cpu-over-budget` 当前的判据是「owner 的 lifecycle 状态不是 active/queued，且采样 CPU 超预算」。
本例说明：当 owner 归属本身是错的时，该判据不是「保守地多报一条」，而是**把一个高价值共享设施
标成高优先级回收目标** —— 归属错误会让派生判据的错误方向系统性地指向最繁忙、最关键的进程，
因为它们正是 CPU 最高的那些。

因此建议：在归属可证明正确之前，`idle-cpu-over-budget` 与 `orphan` 一样，不得进入任何回收路径，
且报告文本宜显式标注其依赖归属正确性。
