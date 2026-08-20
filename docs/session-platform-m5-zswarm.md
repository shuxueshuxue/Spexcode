# Session platform M5 ZSwarm adopter 账

基线 **`0b8b5c93d`**（M4 落地头）。本文记录 M5 的定位结果、可证伪判定与门禁。它不推进 M6。

## 1. 开工第一件事：ZSwarm 是真实存在的，而且它消费的正是我们计划删掉的那座桥

M0 的 G.1 L09 写着「本仓库没有 production importer……external ZSwarm use is unproven」。
**那句话对本仓库为真，对世界为假**——consumer 一直在另一个仓库里，只是没人打开过它。实测：

| 事实 | 证据 |
|---|---|
| ZSwarm 源在 z-code | 本机 `/home/jeffry/zcode`，分支 `codex/swarm-five-integrated` @ `b9b3fa701` |
| 它声明 legacy 包 | `apps/zcode-cli/packages/bootstrap/package.json:24` → `"@spexcode/session-core": "0.6.7"` |
| 它 import **全部六个** bridge 导出 | `apps/zcode-cli/packages/bootstrap/src/swarm-session-protocol.ts:1-8`：`drain`、`publishRuntimeSessionState`、`readRuntimeSession`、`registerRuntimeSession`、`runtimeSessionNotification`、`runtimeSessionChildren` |
| 它自己的 spec 也这么写 | `.spec/zcode/swarm-orchestration/session-protocol/spec.md`：swarm session 用 `@spexcode/session-core` 承载 session record、timeline、parent watch、pending queue、cursor 及其 locks |

**直接后果，必须写在最前面**：在该 adopter 迁移之前删除 `packages/session-core/src/runtime-session.ts`
**会打断一个活着的外部产品**。因此 M8 的拆除计划、以及架构简化审查里
「ARCH-AFF-3：可合并，此 head 上合并成本为零，没有产品调用者」这条判定，**都被 M5 阻塞**。
后者的措辞对本仓库成立，但它据以推论"零成本"的那个前提已被推翻。

## 2. 跨仓边界：M5 能证明什么、由谁落最后一刀

替代目标（ZSwarm 侧的旧消息持久化、关系投影、兼容 adapter）**位于 z-code 仓库**，不在本仓。
本 lane 能够并且应该做到：

- **Inventory**：以 file:line 钉死 ZSwarm 今天经由 bridge 持久化了什么、落在哪个 store root；
  够不着的（例如 mbp 上的权威 checkout、真实 swarm 运行时状态）一律 `NOT-MEASURED(<原因>)`，不猜。
- **Adopt**：在**本仓之外**的 clean consumer 里安装 M1 协议栈，用 ZSwarm 的形状（自有绝对 databasePath、
  自有 topology、worker loop、无任何 Spex runtime）跑通等价回路——这正是路线图 M5 的 exit 条款。
- **Sabotage**：旧 store 缺失/损坏/只读时，同一套 ZSwarm 形状回路仍然成立。
- **Delete**：**本仓的实测删除目标为空**（判据同 M4：既被本 adopter 消费、又已被本 milestone 替代）。
  ZSwarm 侧的删除是 z-code 的改动，需要该仓的所有权；本 lane 交付精确 kill list 与已证可用的替代物，
  使那一步成为机械改动，但**不代它落刀**——跨产品单方面改源码不是集成方的权限。

## 2.1 跨仓落地前必须先说的一件事：ZSwarm 不在 z-code 的 source-of-truth 分支上

授权跨仓实现之后，我先去定位"真实 source-of-truth branch 的最新可复核 head"。实测结果与直觉相反：

| 事实 | 证据 |
|---|---|
| z-code 声明的主干是 `zcode-spec` | `/home/jeffry/zcode` 的 `spexcode.json` → `"mainBranch": "zcode-spec"` |
| 本机有它，作为远程跟踪引用 | `refs/remotes/origin/zcode-spec` @ `7a6db2350`（2026-08-15） |
| origin 指向 mbp 的权威 checkout | `ssh://mbp-tail/Users/jeffryglm/Codebase/temp/z-code` |
| **主干上没有任何 swarm 源文件** | `git ls-tree -r origin/zcode-spec \| grep -i swarm` → **0** |
| swarm 只在一条未合并的特性分支上 | `codex/swarm-five-integrated` @ `b9b3fa701`（2026-08-16），**领先主干 1433 个提交，未合并** |

**这决定了迁移只能落在哪一支。** 若从 `origin/zcode-spec` 开分支，那里**根本没有 ZSwarm adapter**——
在一条从未有过 importer 的分支上"实现迁移"，等于凭空造一个 importer，而那正是本里程碑明令禁止的事
（禁令的理由与"不得在本仓编造 importer"完全相同：迁移必须有被迁移物）。

因此本 lane 的取舍是：**承载 ZSwarm 的那条分支就是 ZSwarm 这项工作的可复核 head**——
`codex/swarm-five-integrated` @ `b9b3fa701`，它同时是全部 swarm 分支里最新的一条。
迁移分支从它开出，不从 `zcode-spec` 开。这条选择连同上表一并记录，因为它推翻的是一个合理但错误的默认假设，
而不是一个可有可无的细节：**主干与"这项工作的真实基线"在这个仓库里并不是同一个东西。**

一并记录两条尚未测量的事实，不猜：
- `origin/zcode-spec` 是本机的远程跟踪快照（2026-08-15），**未向 mbp 重新 fetch**，mbp 上是否已前进 `NOT-MEASURED`；
- swarm 分支是否已在 mbp 上以别的名字合并进主干，`NOT-MEASURED`。
两者都不影响上面的取舍（迁移物只存在于 swarm 分支），但影响最终跨仓落地时的合并目标，落地计划里必须先复测。

## 2.2 跨仓落地计划（机制已实测，等 lane I 证据齐备后执行）

**为什么不能直接在这台机器上 `spex session new` 出一个 z-code session**：`spex session new` 会先跑
`assertProjectMatch`（`spec-cli/src/sessions.ts:1928-1937`），它向 `SPEXCODE_API_URL` 的 `/api/settings` 取回
后端所服务的项目并比对调用方项目。本 shell 继承的 `SPEXCODE_API_URL=http://127.0.0.1:8787` 服务的是
**spexcode** 项目，所以从 z-code 目录调用会被这道守卫正确拦下——它存在的意义正是拦住这个错误。
另外 z-code **未注册**为本机 SpexCode 项目（`~/.spexcode/projects.json` 只有 spexcode / rocket-delta / hanzi-fate-game）。

**因此落地按这个顺序做，每一步都不写 `/home/jeffry/zcode` 的工作树**：

1. **克隆而非 worktree**：`git clone /home/jeffry/zcode <新路径>`，再 checkout `b9b3fa701`。
   选 clone 不选 `git worktree add`，是因为后者会往对方仓库的 `.git` 写 worktree 元数据；clone 对它是纯读。
   （本机 clone 走硬链接，代价可以忽略。）
2. **给 z-code 项目起一个独立后端**：`env -u SPEXCODE_API_URL PORT=<空闲端口> spex serve`，cwd 在该 clone。
   `env -u` 与显式 `PORT` 两者缺一不可——本仓 CLAUDE.md 记着这个 footgun：被派发的 shell 会继承
   `PORT` 与 `SPEXCODE_API_URL`，裸跑 `serve` 会静默绑到继承来的端口并把子进程指向**活着的**后端。
   起之前先 `ss -tlnH "sport = :<port>"` 确认端口空闲。
3. **在该后端上开 session**：`SPEXCODE_API_URL=http://127.0.0.1:<port> spex session new …`，
   基线 `b9b3fa701`（理由见 §2.1：主干上没有被迁移物）。
4. **停止时按实例停，不按签名停**：本仓 CLAUDE.md 明写每个后端的进程签名完全相同，
   `pkill -f '…serve'` 会打死错的那个（历史上真打死过线上 :8787）。只按端口找 pid 停。

这套机制我已经逐条实测了依据（守卫代码、projects.json、z-code 的 `mainBranch` 与 remote），
但**尚未执行**——按既定次序，先收齐 lane I 的证据。

## 2.3 两条实测事实改变了"在 z-code 里开 session"的做法，以及一条属于对方的规则

**事实一：`spexcode.json` 不在被迁移的那条分支上。** 逐条查过：`b9b3fa701`（swarm）**没有**、
`origin/zcode-spec`（主干）**没有**、只有 `codex/swarm-worktree-isolation` 有。swarm 分支上的 `.spec` 只有 **4 个节点**。
也就是说 **z-code 的 SpexCode 采用本身是分支局部的，而且不在主干上**。
在一条没有 `spexcode.json`、没有后端、只有 4 个节点的分支上强行 `spex session new`，
拿到的不会是"一个 z-code session"，只会是一个看起来像的东西。

**因此做法调整（记录为偏离，不是便利）**：独立工作副本用 **clone** —— `/home/jeffry/zcode-m5`，
分支 `m5/zswarm-protocol-cutover` 基于 `b9b3fa701`；实现由一条**真实 spex session** 承担，
它的 worktree 是独立的，产出物是那条 z-code 分支。父侧要求的两件事都成立：会话是真的、
`/home/jeffry/zcode` 的工作树一个字节都不碰（clone 完成后复查：分支、HEAD、dirty 计数全未变）。
唯一没做到的是"session 的 worktree 本身是 z-code 的"，原因如上，且不影响任何证据。

**事实二：对方仓库自己的规则里有一条关于权限的。** `AGENTS.md:15`：

> 解决问题的时候要深究，是设计缺陷还是 bug……**如果是设计缺陷需要和我沟通，不要自作主张。**

把 ZSwarm 的整个会话持久化层换掉，无论如何都属于设计层变更，不是 bug 修复。跨仓实现已由本 campaign 侧授权，
所以**工作照做**；但按对方自己的契约，**这条分支是提给 z-code 所有者的提案，不是既成事实**——
合并进 z-code 需要该所有者的同意，这一条写进落地计划的前置条件，不靠"我们有权限访问文件系统"来代替。
其余 z-code 契约（先写测试再写代码、注释用中文、spec 留在 docs、完成后提交一个 commit）在实现中一并遵守。

## 3. 门禁与结果

（施工阶段填写。）
