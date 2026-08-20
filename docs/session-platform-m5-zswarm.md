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

## 2.4 clone 不是 Spex 对象，所以它的每一条保证都要手工补出来

父侧接受了这次的双根隔离，但要求收口时显式补偿一个缺口：**Spex 管得住 session 的 worktree，管不住那个 clone**。
clone 没有 session record 兜底，一旦 owner session 关闭，它就是个无主目录。因此收口时对 clone 逐条独立核验：
realpath、branch、`b9b3fa701` 是祖先、HEAD、`git status --porcelain`（**含 untracked 必须为 0**）、
相对 base 的精确 diff、以及**有没有别的 session/进程在写它**；同时复查活 checkout `/home/jeffry/zcode`
的 branch / HEAD / dirty 三项未变。lane J 在提案被审完前不得 close、不得删除或移动 clone。

**关于最后那条"没有别人在写"，我要写清楚它证明了什么、没证明什么**，因为我在做它的时候先把它做错了一次：

- 第一版用"进程 cwd 是否在 clone 下"来数。这本身是**代理**：`git -C <clone>` 写它的时候 cwd 在别处。
- 第二版补了扫 `/proc/*/fd` 的分支来盖住这种写法。加上之后，**探针不再能抓到一个活着的 canary**——
  同样的循环体内联执行能抓到，放进脚本就抓不到，我没能定位原因。
- 于是第三版**把没能证明的那半删掉**，只留能演示的那一半，并当场用一个 detached canary 证明它确实会报非零
  （`FOREIGN process sleep pid=… session=…`，判定 FAIL）。

**剩下的探针只覆盖"cwd 在 clone 内的并发进程"**；用绝对路径从别处写、或在两次采样之间开-写-关的写者，
它看不见。这条限制写在这里，而不是让"foreign writers = 0"看起来像一条全称证明。
一个从未被证明能报非零的探针，它的 0 不是证据——这条在本 campaign 里已经第三次咬到我自己。

## 3. 门禁与结果

两侧各自独立跑门，结果各自记在本节；跨仓的那条绑定单独列出来，因为它是"两个仓库在说同一件事"的唯一硬证据。

### 3.1 spexcode 侧（本仓 HEAD）

| 门 | 结果 |
|---|---|
| `spex spec lint` | 0 error / 12 warning（warning 全是既有 coverage/drift，阻塞门只看 error） |
| `spex eval lint --changed` | 0 node flagged（0 malformed / 0 stale / 0 missing / 0 coverage gap） |
| `scripts/m5-zswarm-adopter.mjs` | 122 assertions；`forbiddenGraphCount: 0`；`protocolAdopterColumns: []` |
| `scripts/m4-self-launch-yatu.mjs` | 17 assertions |
| `scripts/m1-conformance.mjs` | 48 assertions |

m5 三种破坏模式（old store missing / read-only / poisoned）都是 `legacyFileSyscallHits: 0`，
分别落在 628 / 628 / 634 行真实 file syscall 上。这个 0 之所以算数，是因为同一次运行里的标定段
`poisonPathHits: 1` —— 追踪器**当场演示过它能看见 legacy 路径**，然后才在正式段报 0。
没有这条标定，"0 命中"和"追踪器瞎了"是同一个输出。

### 3.2 跨仓绑定：z-code 里躺的那两个包，就是本仓门禁量到的那两个包

z-code 提案把 `@spexcode/session-core` 从 `apps/zcode-cli/packages/bootstrap/package.json` 换成
`third_party/spexcode` 下两个 `file:` tarball。它们的 SHA-256 与 §3.1 中 m5 门禁**本次运行**打包量到的值逐字节相同：

| 包 | SHA-256 | 两侧一致 |
|---|---|---|
| `@spexcode/session-protocol@0.6.7` | `fc173f191baccbfb72b1bb7f7127dabbb9182d695d9f81920a116b556be343fa` | ✓ |
| `@spexcode/session-topology@0.6.7` | `61fb674e465956289c416fedf1b535e2f56873e84bffe6c91620af85fc29fef8` | ✓ |

同一对哈希、加上产出它们的 spexcode 源码 commit `581941d9d5c0ccf962acfd07cd24aea186c84158`、
以及"M9 发布后换 registry 依赖并删除 `third_party/spexcode`"的退出条件，都写在 **z-code 自己的**
`docs/swarm-session-protocol.md` 里 —— 不是只记在本账里。否则那两个 tgz 在对方仓库里就是两坨无出处的二进制。

### 3.3 z-code 提案侧（clone 收口）

**最终状态**（这是当前真相，下面的历史快照不要当成现状读）：
clone `/home/jeffry/zcode-m5`，分支 `m5/zswarm-protocol-cutover`，HEAD
`d97c3e87e1784e306a3cbde4020d65fa73ac8a00`：`b9b3fa701` 是祖先且 base..HEAD **恰好 2 个 commit**
（实现 `3b1d53e26` + readings sidecar `d97c3e87e`，顺序即此）；`git status` 含 untracked **为 0**；
`.git` 锁文件不存在；活 checkout `/home/jeffry/zcode` 的 branch/HEAD/dirty 三项未变。
diff 相对 base 为 **23 files / +1749 / −222**。收口判定 **PASS**。

**历史快照（已被上面取代，仅记录过程，不是现状）**：本提案在 review 过程中先后停在
`ab465113d` → `65f710f59`（各为 1 commit、13 files / +1020 / −183）→ `3b1d53e26` → 最终 `d97c3e87e`。
前两次 HEAD 变化是 **amend 改写**而非追加（提案被打回后由 owner 重做），每次改写都让上一轮的 post 快照作废、
必须重新采样；最后一步 `3b1d53e26 → d97c3e87e` 是**追加** sidecar，不是改写。
把这段留成历史而不是删掉，是因为"这条分支被改写过几次、哪几次"本身是收口证据的一部分；
但它必须写成历史，不能继续用现状口吻站着——那正是这份账在 M4 上栽过的坑。

`--- 上一节所列探针限制在此依然成立 ---` 见 §2.4：foreign-writer 探针只覆盖 cwd 在 clone 内的长生命周期写者；
短生命周期、用绝对路径从别处写的写者仍是 **NOT-PROVEN**。收口靠的是"J 是唯一被授权的写者 + 稳定快照 + 锁文件检查"，
不是靠那个 0。

### 3.4 九个失败的归属：实测同集，不是"看起来无关"

提案改了 `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts`（`365df0b`→`eedd915`），
内容是**一处调用点**从 `createSwarmSessionProtocolPort()` 变成显式传绝对 `databasePath`
（`join(cliStorageRoot, "swarm-sessions.sqlite")`）—— 与协议契约"databasePath 必须显式绝对、不许有隐式默认"一致。

`create-app.ts` 是共享装配点，所以"九个失败与本次改动无关"必须实测，不能靠直觉。做法是在 base 与 proposal
两棵**各自独立安装**的树上跑同样五个测试文件：

- 对照变量成立：五个测试文件在 `b9b3fa701` 与 HEAD 之间**逐字节未变**（blob `c5b9f41` / `d703096` / `1b744f2` /
  `423af6f` / `71b1ad2`）。我用"文件名解析到唯一路径再比 blob"独立复核过，并配了一个负对照证明该比较**会**报不等 ——
  第一次我用 `git diff --stat` 加 glob 复核，那条命令在"glob 没匹配到任何文件"时同样输出空，
  与"文件确实没变"不可区分，是同一类代理缺陷，作废重做。
- 结果：两侧都是 135 total / 126 pass / 9 fail，按表序 1/1/1/1/5 分布；
  排序后的 `(file, fullName)` 失败集两侧 SHA-256 同为 `52952e06a036184baca2f3a40aa539cb25f6c4c9e29067320344b85adf450abd`。

**所以这九个失败是 base 既有，不是本次 cutover 引入的。** 它们属于 z-code，本 campaign 不修、也不假装没看见 ——
落地计划里作为已知项交回对方。

一处要说准的：我另做的"五个失败测试是否直接引用 create-app"扫描结果是 0 引用，但那只是**直接引用**扫描，
**传递可达性未测**。归属结论站在上面那次实测同集上，不站在这个扫描上。

## 4. 跨仓落地计划（前置条件先于步骤）

**前置条件（不满足就不落）**：

1. **z-code 侧的合并需要对方所有者同意。** 依据是对方仓库自己的 `AGENTS.md:15`：
   "如果是设计缺陷需要和我沟通，不要自作主张。" 换掉整个会话持久化层属于设计层变更。
   本 campaign 授权的是**实现**，不是**代对方合并**。所以 `m5/zswarm-protocol-cutover` 是**提案分支**。
2. **顺序是 spexcode 先、z-code 后。** z-code 装的是本仓打出的 tarball，本仓这边一动，那两个哈希就失效。
3. **vendoring 是 M9 前的过渡态**，退出条件已写进对方文档（发布后换 registry 依赖并删 `third_party/spexcode`）。
   换安装源不等于加运行时 fallback —— 这一条必须在换的时候仍然成立。

**步骤**：

1. 本仓 M5 产物按常规原子落地（已跑完 §3.1 全门）。
2. 带着 §3.2 的哈希表与 §3.4 的归属结论，把提案分支交给 z-code 所有者评审。
3. 对方同意后再合并；合并前按本仓惯例重跑一次对方侧门，因为 base 可能已经前移。
4. 合并后 `third_party/spexcode` 的退出条件挂到 M9。

**明确不做**：不推进 M6；不代替对方合并；不因为"文件系统可写"就把提案当既成事实。

## 5. 跨仓 ownership / provenance（z-code commit 不带 Spex trailer 的原因与替代记录）

本仓的落地纪律要求每个 commit 带 `Spec:` / `Session:` trailer。**z-code 那两个 commit 没有带，这是裁决过的，不是遗漏。**

三条理由，按重要性排：

1. **目标仓的契约不是这条。** z-code 自己的 AGENTS 只要求 Conventional Commits。
   往别人的仓库里塞我们的治理格式，是把自己的流程当成通用规范。
2. **那个 clone 不是 Spex governed 项目**，trailer 里的 `Session:` 在对方仓库里指不到任何东西，
   写了也只是一串对读者无意义的 uuid。
3. **改写会毁掉已经正确归档的证据。** 三条 reading 的 `codeSha` 精确指向 `3b1d53e26`；
   为补 trailer 而 amend 会让那个对象消失，readings 立刻指向不存在的 commit——
   为了形式合规去破坏实质证据，方向反了。

**所以 provenance 记在这里**，由本仓承担它该承担的那部分记录责任：

| 环节 | 标识 |
|---|---|
| 实施 session（Spex 侧 owner） | `a1c2f851-3905-4c89-ada7-028c94e1ccd0` |
| 实现 commit（z-code） | `3b1d53e267fbd5344c5d607e75ff7fd7d2169eee` |
| readings sidecar commit（z-code） | `d97c3e87e1784e306a3cbde4020d65fa73ac8a00` |

三条 reading 全部以**实现 commit** 为 `codeSha`（不是 sidecar 自己），scenario 文本在测量前已冻结
（sidecar 对 `eval.md` 的改动为 0），且三条各自持有**不同的 scenarioHash 与不同的 evidence transcript**：

| scenario | scenarioHash | evidence |
|---|---|---|
| `split-session-protocol-cross-process` | `fe2cea8ae18c8214…` | `5f9c7492bbb8fd84…` |
| `split-session-protocol-production-composition` | `de4d1c13a462a787…` | `b28722f55c7224b8…` |
| `split-session-protocol-canonical-metadata` | `5f67cc8330c4654e…` | `dcfca456e44d0847…` |

三个 hash 两两不同这件事本身是有意义的：它排除了"用同一个内部 helper 断言三次、冒充三条产品测量"这种做法。
z-code 侧 `spex eval lint` 的 missing 从 4 降到 1，剩下那 1 条是 base 既有，不属于本次。

## 6. z-code 侧门禁的覆盖边界：跑了什么、没跑什么、哪一条不能声称

把"跑过并通过"和"没跑"和"跑不了所以不能声称"三件事分开写。混成一句"门禁通过"是本 campaign 一路在打的那个毛病。

**跑了且通过：**

- `bootstrap` 与 `adapters` 的 **direct typecheck**：PASS。
- 新增/拆分文件的 **oxlint**：无 finding。精确改动文件里只报 `create-app.ts` / `app/types.ts` 两处 max-lines，
  且 base 用同一 oxlint 对这两个文件同样报——是既有超标，不是本提案引入（三个 >400 文件的 base 行数见 §3.4 同法核过）。
- z-code `spex spec lint`：0 error / 2 warning。
- 新门实测：adapter 1 file / 3 tests；bootstrap 5 files / 11 tests。

**没跑（不是通过）：**

- **聚合 typecheck / lint 未进入检查**——那个 clone 是裁剪安装，缺 `turbo`，聚合入口根本没跑起来。
  所以它既不是绿也不是红，是**未执行**。

**跑不了，因此明确不声称：**

- **`spex eval lint --changed` 在 z-code 建立不了 scope**——该 clone 没有本地 `main` ref，
  changed-scope 无从计算。**不声称它通过。** 全量 `spex eval lint` 的结论另算：
  只剩 base 既有的 5 malformed / 2 stale / 1 missing，本轮新增的三条已 filing 完毕。

**为什么要这样分**：一个没跑起来的聚合门和一个跑完全绿的门，在最终报告里长得一模一样——都是"没有报错"。
把它们写成同一句话，等于把"我们没看"包装成"那里没问题"。落地决定要建立在知道哪些地方我们确实没看过的基础上。

## 7. J-7 的 fail-first 与拆分保真度（最终状态）

fail-first 向量：字段全合法、`text` 中含裸 0xff 的 message bytes。非 fatal 的当时实现上**唯一自有断言失败**
（stdout/stderr/exit sha256 = `898014a8…` / `b1ca1938…` / `4355a46b…`，末者即 sha256("1\n")，exit 1）；
恢复 `TextDecoder(..., {fatal:true})` 后拒绝为 `Invalid ZSwarm message`。

拆分保真度：以拆分前 `65f710f5` 对 DDL / `sameRegistration` / `parseMessage` 逐字段人工复核，
**fatal 恢复后未见第二处差异**，未扩 schema。这与我这边的机械审计一致——
throw 站点 18/18、九条模板 throw 逐字一致、typeof 7/7、STRICT 2/2，`fatal:true` 是唯一实证丢失。
两条独立路径得到同一结论，这条才算立住。

## 8. K-2 最终措辞

**DEFERRED / currently unreachable**，复测入口固定为 **windows-chole**（tailscale 上 offline, last seen 5d）。
上线后跑：Node 24.14 default adapter 的 fixed drive、SMB network drive、production composition 三项。
**Linux 上的 win32 注入测试明确不冒充 Windows runtime proof**——它证明的是"适配器被告知 win32 时行为正确"，
不是"Windows 上确实如此"。

## 9. J 的最终证据整合（本节由本账 owner 整合，不是把 J 的分支合过来覆盖）

J 的 Spex 分支上有一份同名 ledger，带着 §6–§8 没有覆盖的原始测量。语义整合到这里，
`§2.4` / `§4` / `§5` 原样保留。**不 merge J 的分支**——那会用它的版本覆盖掉本账特有的 clone 手工补偿、
跨仓落地计划与 provenance；owner 文件由 owner 整合，这是本 campaign 一开始就定下的规矩。

### 9.1 一处必须当场解决的矛盾：聚合 turbo 门

J 的 ledger 写着 `CLI turbo 23/23 pass`。父侧独立核对说聚合门**根本没跑起来**，因为那个 clone 是裁剪安装、缺 `turbo`。
两句话不能同时进账，所以我去量了：

    apps/zcode-cli/node_modules/.bin/turbo   → 不存在
    pnpm exec turbo run typecheck            → ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "turbo" not found

（`turbo` 只在仓库根的 `node_modules/.bin` 下，而 `test` / `typecheck` 脚本是从 `apps/zcode-cli` 里跑 `turbo run …` 的。）

**结论：以父侧为准。`turbo 23/23` 在当前 clone 状态下不可复现，因此本账不记它为通过。**
J 可能是在更早的完整安装状态下跑到过，但我们要落地的是**现在这个状态**，
一条在待落地状态下跑不起来的门，不能写成绿的。§6 的三分法（跑过并通过 / 未执行 / 跑不了因此不声称）据此成立，
`聚合 typecheck/lint` 归入**未执行**。

### 9.2 fail-first 原始测量（J 产出，哈希照录）

| 轮次 | 结果 |
|---|---|
| 原始 fail-first | 66 行 / 2,411 bytes，SHA-256 `e3b13b63…` |
| J-3/J-4/J-6 | 旧实现上 3 条自有断言稳定失败（locality 调用 0 次；de/sv 跨进程 replay conflict；production `createZCodeApp` locality 调用 0 次）。stdout/stderr/exit = `626e3702…` / `3344e5f8…` / `4355a46b…` |
| J-7 | 字段合法、`text` 内嵌裸 `0xff` 的 message 在非 fatal 实现上错误通过。stdout/stderr/exit = `898014a8…` / `b1ca1938…` / `4355a46b…` |

`4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` 是 `sha256("1\n")`，即 exit 1。

### 9.3 clean consumer 与 sabotage（J 产出）

clean consumer 在产品仓之外，只从本提案的两个 tarball 安装；graph/manifests 恰为
`@spexcode/session-protocol@0.6.7` 与 `@spexcode/session-topology@0.6.7`，
`@spexcode/session-core` / `@spexcode/spec-cli` / `spexcode` 三者计数均为 0。
result `8710b38c…`、dependency tree `e3409770…`、两个 tarball `fc173f19…` / `61fb674e…`。

sabotage 三态各 1/1 pass，只读能力先实测为 `EACCES`；命令固定
`/usr/bin/strace -f -qq -e trace=%file,%process`。**标定是这组数字能成立的前提**：
32 条 file syscall 且以真实 `openat` 命中 poison 文件 1 条（不是只命中 `execve` argv）。
缺失/只读/投毒各 45,630 / 45,533 / 45,802 条 file syscall，排除 `execve` 后 legacy 根路径命中**均为 0**。
计数 JSON `80677b81…`；三份 raw trace `900e201c…` / `4a8aca4d…` / `a290ffee…`，
**只存在 `/home/jeffry/spexcode-base` 的证据目录，不在产品树**（这条纪律来自 M4 的教训）。

### 9.4 完整套件与九个失败（J 产出，与 §3.4 结论一致）

bootstrap 完整套件 93 files / 1,288 tests = 1,276 pass + 9 fail + 3 skip，JSON `48f9fd55…`。
九个失败分布 marketplace import 1 / session title event 1 / v4 gateway 1 / v4 native boundary 1 / telemetry lifecycle 5，
**没有一个是 ZSwarm 测试**。归属证据见 §3.4，两条独立路径（J 的与我的）得到同一结论。

### 9.5 未测清单（最终状态）

- `NOT-MEASURED(macOS runtime)`：Darwin allowlist 按 XNU 历史 filesystem type 编号实现，无 macOS runner；未知类型 fail closed。
- `DEFERRED(actual Windows Node/PowerShell runtime; currently unreachable)`：见 §8。
- `NOT-MEASURED(native provider-backed worker lifecycle)`：跨进程门的 worker 是独立 Node fixture，
  production composition 门用注入模型；需要真实 provider 的完整 native worker lifecycle 未启动。
- `spex eval lint --changed`：clone 无 `main` ref，changed scope 建立不了，**不声称通过**；完整 eval lint 已跑，
  只剩 base 既有 5 malformed / 2 stale / 1 missing。
- lsof 已用真实 open-file 固定向量标定；clone 下写 FD 命中 0。另有旧 z-code worktree 进程经硬链接映射到
  clone 的 node_modules inode，但只显示 `mem`/`txt`、cwd 不在 clone、无写入。
