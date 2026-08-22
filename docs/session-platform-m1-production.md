# Session platform M1 生产实施账

本文是**生产实施**的决策台账与集成检查点。它不重开任何冻结决定，也不改写三份 HTML 与 concept-map；
它只记录：编号如何对齐、OPEN 细节按什么最小可撤销假设收口、三条 lane 的独占文件面、跑了哪些门、结果是什么。

基线严格为 `8f7163b40`（campaign head，**不是 `main`**；main 在 `2099f5960`，不含本 campaign 的设计集）。

## 1. 编号对齐：本文的 M1 是"生产实施第一阶段"，不是路线图的 M1

`docs/session-platform-construction-roadmap.html` 的 M0–M9 是调度权威，其 M1 是**契约冻结**——它已经以
`docs/` 九份文档与 `.spec/spexcode/session-protocol/**`、`session-topology`、`session-runtime` 的形式落地。
本文的"M1 生产实施"是**把已冻结的契约变成产品代码**的第一阶段，覆盖：

| 本文范围 | 路线图编号 | 交付 |
|---|---|---|
| adopter-owned SQLite protocol core（生产 TypeScript 包） | **M2** | `packages/session-protocol` |
| neutral topology composition seam（内部包，不发布） | **M3** | `packages/session-topology` |
| 最薄 self-launch adopter（path resolver + 薄 CLI + installed 证明） | **M4 的正向证明部分** | `packages/session-selflaunch` |

**不在范围内**：任何 legacy cutover 与物理删除。`packages/session-core/**` 与 `spec-cli/src/sessions.ts`
本阶段一个字节都不改。三个 adopter 的正向证明齐备 + sabotage gate 通过之前，M6/M8 拆除另开 lane。
本阶段新增的三个包在产品路径上**没有任何 importer**——这是刻意的：它们是 M4/M5/M6 cutover 的被接入方，
而不是接入本身。

## 2. OPEN 细节的收口（最小可撤销假设）

冻结文档把若干实现细节留给实施阶段。下列每条都是最小、可撤销、且不扩大 schema / 对外契约 / 路线图范围的选择。

**D-1 包名与目录。** `packages/session-protocol` → `@spexcode/session-protocol`。总体设计要求"用全名，不缩写成
SCP"，`session-protocol` 满足该要求；最终 scope 与是否独立仓库是路线图 M9 的决定，首次发布前改名成本是一次提交。
topology 为 `@spexcode/session-topology` 且 **`private: true`**——concept-map P05 要求两个非同构 adopter 证明语义
相同后才发布。self-launch adopter 为 `@spexcode/session-selflaunch`，带 `bin: spex-session`。

**D-2 open 只有一个拼写。** 导出 `openProtocol(databasePath, options?)`，**不**同时导出总体设计早稿里的
`openSessionDatabase`。被冻结的是"显式绝对路径"这一形状，不是函数名；同一操作两个名字正是本次重构要删掉的东西，
兼容别名同样禁止。

**D-3 adopter 组件迁移由协议提供唯一机制。** 引擎契约要求 adopter 用自己的 component name 共享同一张
`schema_migrations`。协议因此导出 `applyComponentMigrations(protocol, component, migrations)`：与协议自身
完全相同的 checksum-per-migration、forward-only、单事务应用与开库前验证，拒绝 `session-protocol` 这个 component，
只读句柄拒绝迁移。替代方案是让每个 adopter 自己实现一份迁移机制——那是第二套 schema 权威，正是要删的东西。

**D-4 topology 边模型是一张表、一套方向。** 边是 `(from, to, relationType)`，方向恒为"感兴趣的一侧 → 被关注的
主体"。`attach(parent, child, type)` 与 `subscribe(watcher, subject, channel)` 是同一张表的同一种边，
`recipients(subject)` = 指向 subject 的活动边的全部 from。一个机制覆盖两种关系，不是两张表加一个 switch。

**D-5 topology 不带 `revision` 列。** 重构方案 §6 的示意 schema 有 `revision TEXT NOT NULL UNIQUE`。删掉：
唯一会消费它的机制是 relation-revision replay，而 `session-topology` spec 明文禁止 replay/outbox/dispatcher。
留一个没有消费者的唯一键，就是留一个将来会被误当作 replay 依据的钩子。

**D-6 topology mutation 必须在事务里。** `attach`/`detach`/`reparent`/`subscribe`/`unsubscribe` 只接受一个
protocol 事务上下文作为第一参数，因此"关系变更 + 它要求的 enqueue 同一事务"是结构上的，不是纪律上的。
只读查询（`parents`/`children`/`subscriptions`/`recipients`）在事务内外都可用。

**D-7 self-launch CLI 不接受 `--message-id`。** `docs/session-adopter-cutin-plan.md` 记的 argv 契约里有
`--message-id MID`，那是从**已被取代的 M1 spike protocol** 反推出来的；引擎契约 §6.1 冻结了"message id 由协议
生成，producer 提供即拒绝"。生产 CLI 因此没有该参数，协议生成的 id 出现在 stdout JSON 里。argv 契约的其余部分
（单行 JSON stdout、exit 0/1/2、stderr `<bin>: CODE: message`）保持不变。

**D-8 CLI 的 body 用 base64 出，用 UTF-8 文本进。** `--body TEXT` 由 adopter 侧按 UTF-8 编码成字节交给协议；
stdout JSON 里是 `bodyBase64`，不是文本。协议的 body 是 opaque bytes，用文本字段渲染它，等于让 CLI 替别的
producer 猜编码——二进制 body 会被静默搅烂。这是 adopter 表面的选择，协议语义不变。

**D-9 stderr 前缀跟着 bin 名走。** cutin 计划里的 `self-launch-cli:` 是 spike fixture 的程序名；生产 bin 名为
`spex-session`，前缀相应为 `spex-session:`。locality 拒绝打印 resolver 的具体 code
（`LOCALITY_NETWORK_FILESYSTEM` / `LOCALITY_UNDETERMINED` / `LOCALITY_DETECTOR_UNAVAILABLE` /
`LOCALITY_PROBE_FAILED`），比笼统的 `STORAGE_LOCALITY_UNVERIFIED` 多给出可修复的信息。

**D-10 locality 的操作员断言只有一个显式旗标。** 非 Linux 平台没有 detector，按冻结规则一律拒绝。
`--assume-local-storage` 是唯一的越过方式：**只做命令行旗标，不做环境变量、不做配置文件字段**。
环境变量会被子进程继承因而静默生效，配置字段会变成默认值；一个必须每次手打的旗标不会。

**D-11 默认 databasePath 保持可重定位。** 解析优先级冻结为 `--database-path` → `SPEX_SESSION_DATABASE_PATH`
→ `SPEX_SESSION_CONFIG` 指向的 JSON 的 `databasePath` → `${SPEXCODE_HOME:-$HOME/.spexcode}/sessions.sqlite`。
最后一档用产品既有的 home 旋钮，因此仍可重定位。resolver **不创建目录**：父目录缺失由协议按
`PROTOCOL_PATH_PARENT_MISSING` 大声失败，CLI 把修复入口打在 stderr 上。

**D-12 老的 `session-protocol` 节点继续治理 legacy 入口。** `.spec/spexcode/session-protocol/spec.md` 的
`code:` 指向 `packages/session-core/src/index.ts`。本阶段不改这条指向——改它等于在没有 cutover 证明的情况下
宣称权威已经转移。新实现由该节点下的新子节点治理，父节点只增加 `related:` 链接。

**D-13 fail-first 必须有判别力。** 每条 lane 的首次失败必须是**自己的断言**抛出，不是模块找不到、路径拼错
一类在实现正确时同样会失败的环境噪声。原始失败输出逐字节保留在各包的 `evidence/fail-first.log`，任何时候
不得被重跑结果覆盖。

## 3. 三条 lane 的独占文件面

同一时刻一个文件只有一个 writer。roadmap §2 明确 M2 与 M3 在 schema capability 上**串行**，所以 lane A 先落地，
B 与 C 再并行分叉于含 A 的集成头。

| Lane | 独占文件面 | 明确禁止 |
|---|---|---|
| **A** protocol core | `packages/session-protocol/**`、`.spec/spexcode/session-protocol/{engine,schema,message-envelope,errors,package-entry}/**`、`.spec/spexcode/session-protocol/spec.md` 的 `related:` 一行 | 不碰 topology、不碰 adopter、不碰 `packages/session-core/**` |
| **B** topology seam | `packages/session-topology/**`、`.spec/spexcode/session-topology/**`（新子节点） | 不改 protocol 包一个字节；不编码 parent/manager/ZSwarm/Spex 角色策略 |
| **C** self-launch adopter | `packages/session-selflaunch/**`、`.spec/spexcode/session-runtime/self-launch/**` | 不 import spec-core / session-core；不做 daemon、不做 drain loop、不假设 Spex root |
| **集成方** | 根 `package.json`、`spexcode.json`、`package-lock.json`、本文件与其 owning 节点 | 不替 writer 改代码；不替 evaluator 报数 |

**D-14 事务体自己抛出的异常必须原样传出。** 契约冻结了事务体里只能有 SQL 与纯内存校验，也冻结了错误码清单，
但**没有**说调用方在事务体里抛出的异常该怎么处理。本阶段收口为：**调用方的异常是调用方的**——协议回滚，然后原样重抛，
不分类、不包装。只有协议自己的语句（`BEGIN IMMEDIATE`、`COMMIT`）以及 `tx.exec` / `tx.query` / `tx.enqueue`
这三个协议中介的操作，其失败才走协议分类。

理由不是风格。合并树上实测（lane B 报出，集成方复现）：

```
case1  抛 TopologyError(TOPOLOGY_CYCLE_REFUSED) → 收到 ProtocolError(PROTOCOL_SQLITE_ERROR)
case2  抛 TopologyError(TOPOLOGY_EDGE_EXISTS, "…is read-only in adopter policy")
                                              → 收到 ProtocolError(PROTOCOL_DATABASE_READONLY)
```

case1 只是丢了身份；**case2 是凭空造出一个从未发生的协议条件**——分类器会回退到对 message 文本做正则，
adopter 的错误话里带上 "read-only" / "database is locked" / "corrupt" 就会被提升成对应的协议码。
契约 §9.1 禁止把协议条件降级成空值，这条是它的镜像：把非协议条件**升格**成协议码，同样是撒谎，而且更难查。

这条直接决定 D-6 能不能成立：topology 的 mutation 结构上只能在 `withTransaction` 里跑，
所以**每一次** topology 拒绝都发生在事务体内。不修的话 `session-topology` 就不可能有自己的稳定错误码。

处置是**减法**：撤掉过宽的 catch，不是加一个 pass-through marker 机制。代价是分类责任要下沉到 `tx.exec` / `tx.query`
自己身上（否则原始 SQLite 错误会裸奔出去，等于用一个缺陷换另一个），`COMMIT` 也要移出事务体的 try 单独分类。

## 3.1 施工期观察（不属于本阶段的文件面，只如实记录，不代改）

**观察 1：`spikes/sqlite-m2/stubs/run.mjs` 的判定依赖 Node 的测试报告格式，在 fleet 钉死的 Node 22 上把
10 条已冻结决定全部误报成 UNGATED。**

- 该 runner 用 `^✖ (.+?) \(\d` 提取失败的 vector 名（`stubs/run.mjs:37`）。那是 **spec reporter** 的行格式。
  Node 22 的 `node --test` 在非 TTY 下默认 **TAP**，失败行是 `not ok 21 - <name>`，正则一条都匹配不到。
- 更糟的是 TAP 仍然打印 `# tests N`，于是 `sawSummary` 为真（`stubs/run.mjs:39`、`:47`），
  三态判定把这次"看不见失败"的运行记成**测过了的 UNGATED**，而不是 NOT MEASURED——
  正好绕过了三态设计要防的那件事。
- 实测两边，同一棵树、同一个 stub、同一条 vector：

  ```
  M2_ENGINE=../stubs/string-body-accepted.mjs node22 --test test/engine.test.mjs
    → not ok 21 - body must be explicit bytes; a string is not an encoding the protocol guesses   # fail 1
  M2_ENGINE=../stubs/string-body-accepted.mjs node24 --test test/engine.test.mjs
    → ✖ body must be explicit bytes; a string is not an encoding the protocol guesses (31.6ms)    ℹ fail 1
  ```

  整套矩阵：Node 22 跑出 `gated 0/10 ungated 10`，Node 24 跑出 `gated 10/10 ungated 0`。
- **结论：引擎与 vector 本身没问题**（两个解释器下 stub 都被同一条 vector 抓住，`# fail 1`），
  出问题的是"门之门"的输出解析。集成账 §2 记录的 10/10 成立，但它只在 spec reporter 下可复现。
- 处置：`spikes/**` 是已 parked 的 M2 lane 的文件面，按集成账 §4.2 立的规则**不代写**。
  修法是把提取改成同时认 TAP 与 spec 两种格式（或显式 `--test-reporter=spec`），由该 lane owner 执行。
  在那之前，任何人复跑反例矩阵**必须用 spec reporter**，否则读到的 0/10 是假的。

**观察 2：本机 `claude` 全局安装丢了 native binary，claude 系 launcher 全部起不来。**

- `claude --version` 报 `Error: claude native binary not installed`（postinstall 未跑或 optional 依赖没下）；
  `reclaude` 因此在 launch 时报 `reclaude: launch claude: exec format error`，session 卡在
  `queued launch readiness failed: adapter liveness did not become ready`。`claude-glm` 用同一个二进制，同样不可用。
- 这不是 session 创建链路的问题（后端 `/health` 正常，创建、worktree、tmux 都到位），是被启动的二进制坏了。
- 处置：本阶段三条 lane 一律用 `--launcher codex`（本机 `defaultLauncher`，实测健康）。
  修 claude 安装（`node <global>/@anthropic-ai/claude-code/install.cjs`）是舰队工具链的事，不在本里程碑内。

## 4. 门禁与结果

每一门都由集成方在**合并后的树**上独立执行，不采信 lane 自述。

### 4.1 Lane A — protocol core（`packages/session-protocol`）

分支 head `07213110e`，以 no-ff 合并为 `084d525b6`。

| 门 | 结果 |
|---|---|
| ancestor gate（集成头 `25dc46f6a` 是分支祖先） | PASS（lane 自己用普通 merge 并入并保留 merge commit `b384919db`，未 rebase） |
| 窄 diff（改动是否越出独占文件面） | PASS，31 个文件全部在 `packages/session-protocol/**` 与 `.spec/spexcode/session-protocol/**` 内 |
| 禁止路径（lockfile churn / `bin/spex.mjs` / legacy） | PASS，`packages/session-core/**` 与 `spec-cli/src/sessions.ts` 零改动 |
| Node 22.21.0 / SQLite 3.50.4 全套 vector（集成方独立复跑） | **64 / 64**（44 engine + 10 concurrency + 9 production + 1 fail-first） |
| DDL 与冻结契约 §5 逐字节比对 | **一致，0 行差异**（用文档的 SQL 块独立比对，非采信自述） |
| 生产源码禁止模式（`realpath` / `path.resolve` / `mkdir` / `statfs` / `process.platform` / `quick_check` / `journal_mode=` / `spec-core` / 产品词汇） | 各 **0** 命中 |
| 规范字节与契约 §6.2 逐字段核对 | 一致；`message_id` 与 `idempotency_key` 正确排除在 preimage 之外 |
| 跨进程 vector 是否真跨进程 | PASS，真 `spawn`；`follow` / `drain` 的终止条件绑在语义上（收满 N、抽到空），不是墙钟 |
| `npm run build` | PASS |
| `spex spec lint` | **0 error**，新包 coverage 警告 **0** |
| `spex eval lint --changed` | 新增的五个源文件叶节点 0 malformed / 0 stale / 0 missing / 0 coverage |
| installed 读数（clean consumer，仓库之外） | PASS，`resolvedFrom=/var/tmp/session-protocol-consumer-*/node_modules/@spexcode/session-protocol/dist/index.js`，tarball sha256 `5d98a581…`，六操作 + 2 写 1 读跨进程；证据 `e9efe1ef…` |
| fail-first 不可变 | PASS，`c9554661…` 未被重跑结果覆盖；被取代的读数 `be5470a2…` 保留而非删除 |

**审查退回并已修复的三条**：① `engine.test.ts` 一条 vector 从 `spikes/sqlite-m2/adopter-path-resolver.mjs` import，
让生产证明依赖一条已 parked lane 的一次性 spike，且测的是本包不拥有的 adopter resolver（lane C 拥有）——**纯删除**，
不补替代，因为该包该有的那半条（"生产源码不含 locality 探测"，扫全体生产源文件并断言 population size）已经在
`production.test.ts` 里；② 首版 installed 读数只在证据里写了一句 `"surface": "installed tarball…"`，
如果那轮其实跑的是 workspace 源码，导出的 JSON 会一模一样——补 `resolvedFrom` 与 `tarballSha256` 后，
"装过了"才是可核对的事实；③ 同步集成头后在合并树上重证。

**两处收紧，审查接受**：`retire` 的 pending 探测也用 `INDEXED BY` 钉死（spike 没有）；`openProtocol` 无条件检查父目录
（spike 只在可写时查，而契约 §7 的表述本就没有只读豁免）。另有一处实质改进：`protocolVersion` 被限制在无符号 32 位内——
它在 preimage 里按 `u32be` 序列化，不限制的话 `2^32+1` 与 `1` 会哈希成同一个值。

### 4.2 一条被否决的集成期改动：root build 不接线

集成时曾把 `packages/session-protocol` 加进根 `package.json` 的 build 链，随后**撤回**。理由是它让
`packaging` 节点的三条读数（`clean-install-cli-starts`、`omit-optional-l0-adopter`、`dev-loop-launch-no-prefix-leak`，
`code: package.json`）全部变 stale，而**发布产物集合并没有变**：`files` 与 `scripts.prepack` 都没动，
根 build 只是开发期便利。本阶段新包在产品路径上没有任何 importer（这是刻意的），
类型错误由集成方逐包跑 `npm test`（它自己先 build）挡住。接线属于"真的有产品路径依赖它"的那个里程碑，不是现在。
撤回后 `eval lint --changed` 的 stale 归零。

### 4.3 Lane B — topology seam（`packages/session-topology`）与 Lane C — self-launch adopter（`packages/session-selflaunch`）

| 门 | Lane B（合并 `9ae07e93e`） | Lane C（合并 `213bc46b4`） |
|---|---|---|
| ancestor / 窄 diff / 禁止路径 | PASS，21 文件全在文件面内 | PASS，30 文件全在文件面内 |
| Node 22.21.0 vector（集成方独立复跑） | **15 / 15** | **26 / 26** |
| `spex spec lint` | 0 error，新包 coverage 0 | 0 error，新包 coverage 0 |
| installed 证据 | tarball 名+shasum、consumer 内 resolve、原子提交 1 边 3 消息、回滚 0/0 且 TopologyError 身份精确 | tarball 名+shasum、三条 consumer 内 resolve、`source-fallback=absent`、21 个独立 CLI 进程逐条命令/stdout/exit |
| 集成方自写的独立复核 | 打两个包的 dist 直接跑：`recipients` = attach+subscribe 合流、事务内 1 边 + 2 条通知全可见、中途抛错后**两侧一起回滚**、成环拒绝穿过事务边界身份不变 | 见 §4.4 的跨层 YATU |

**审查退回并已修复的一条（F-C1）**：`locality.ts` 在 `statfs` 抛 ENOENT 时 `return databasePath`。
这是刻意设计（有 vector、spec 里也写了），理由的一半成立——父目录不存在时确实没有文件系统可分类，
把更可操作的 `PROTOCOL_PATH_PARENT_MISSING` 留给协议是对的。但实现方式不对：**这个函数的契约是"建立 locality 前提"，
正常返回就是在断言这个前提已经建立**，vector 名字写什么都不改变这一点。两个后果：TOCTOU（探测时父目录不存在→放行→
期间它在 NFS 上被创建→协议在网络文件系统上开库，locality 从未判定），以及 `requireLocalDatabasePath` 是公开导出，
另一个 adopter 调完它去做别的事就继承了乐观路径。冻结规则把"探测本身失败"列在拒绝项里，没有 ENOENT 豁免，
而这条规则的失败模式恰恰是静默损坏。修法是改成抛 `PROTOCOL_PATH_PARENT_MISSING`——**用户可见行为一个字节没变**
（同样的 stderr、同样的 exit 1、同样的 repair hint），变的只是这个函数再也不会在没建立前提的情况下正常返回。

**Lane B 值得记一笔的两处**：`subscribe` 直接委托 `attach`（一个机制，不是两套加一个 switch）；成环检查是带
`INDEXED BY` 的递归 CTE，在调用方事务内做完，而不是应用层遍历完再写。它还多加了两条我没要求但正确的 vector：
「运行时表面没有任何拿走消息的路径」守住 §10.1 的裁决，「时钟回拨仍然合法」守住时间戳不作排序权威。

### 4.4 跨层 high-level YATU：父节点六条 conformance scenario 全部测掉

harness 是 `scripts/m1-conformance.mjs`（已提交，可复现）。它 `npm pack` 三个包 → 在**仓库之外**的
`mktemp -d` 建干净 consumer → 只安装 tarball → 每个子进程都断言自己 resolve 到的路径落在该 consumer 的
`node_modules` 内，**逃出去就直接失败**。理由与 lane A 那条 F2 一样：跑在 workspace 源码上会产出一份长得一模一样的
成功记录，所以"装过了"必须是被测出来的。

在 `8e72a597e` 上跑出 **48 条断言全过**，六条 scenario 的读数以该 commit 的 codeSha 归档（各带自己那一段窄证据）：

| scenario | 这一轮实际测到的 |
|---|---|
| `installed-sqlite-package-contract` | 两个进程同一绝对路径、FIFO A→B、空队列 `null`、history 保留 dequeued 状态、tombstone 后 enqueue 报 retired |
| `schema-migration-is-one-portable-authority` | 新建与重放收敛到一行 migration；改写 checksum → `PROTOCOL_SCHEMA_CHECKSUM_MISMATCH`；伪造未来代 → `PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED`；**两者都在任何协议读之前失败**（读值为 null，不是空库） |
| `fifo-idempotency-and-retirement` | 精确重放返回原行；改一字节冲突且**状态未变**；非空 retire 原子失败且队列完好；抽干后 retire，resurrect 与 later enqueue 都报 retired；history 仍可读 |
| `concurrent-dequeue-has-one-commit-winner` | 四个独立进程按共享墙钟栅栏起跑：**恰好 1 个拿到、3 个拿到 `null`**（不是错误）；commit 前被 SIGKILL → 消息仍 pending；commit 后被 SIGKILL → 已出队且**永不回队** |
| `same-database-composition-needs-no-outbox` | fixture 自有扩展表 + 0/1/多条通知各一次事务；在 mutation 之后、commit 之前强制回滚 → **扩展行与消息一起消失**；公开表面上没有 outbox/dispatcher/raw connection |
| `explicit-path-opaque-data-and-lost-wake` | cwd、HOME、adopter config、databasePath 四处互不相同；相对路径被拒且不读 cwd；**诱饵 config 指向的库自始至终没被创建**；opaque 字节（含 NUL 与高位字节）与 header（含空值与 tab）逐字节往返；未知 kind 不被解释；**全程零 wake hint，后开的进程只查库就发现 pending** |

额外一条不属于这六条、但属于 M1 的组合证明：topology mutation + 它要求的全部 enqueue 在一个事务里提交，
回滚时边与消息一起消失，且 `TopologyError` 穿过事务边界身份不变——这条同时是 D-14 在真实组合里的闭环。

**六条 scenario 的 `code:` 锚点已从 legacy 的 `packages/session-core/src/index.ts` 改指向新包入口**，
理由写在 `eval.md` 正文里：读数必须挂在它真正触碰的那条 freshness 轴上。**节点的 `code:` 治理没有动**——
哪个实现对产品是权威，是有 sabotage 与删除门的 cutover 决定，不是一个测量锚点可以宣布的（D-12 不变）。

`spex eval lint --changed` 现在 **0 flagged**。

## 5. 后续 cut-in 与隔离替换演练（当前状态）

本账前文的“没有 importer / 只证明替代物自己成立”描述属于初始 M1 施工范围，**不再是当前状态**。后续 cut-in
已把 Spex backend 的 lifecycle、parent/watch topology、canonical send queue、runtime binding 与 JSON migration
接到 `@spexcode/session-application`；marker 之后不再读取 `session.json` 或 `pending.json` 作为应用权威，也没有
兼容 fallback。当前实现提交链以 `b7a5aaed4` 为 head，最后一条窄 CLI YATU（真实 backend、parent/child、restart、watch
delivery）通过，production cutover 的十条 HTTP/migration YATU 也为 **10/10**。

在不触碰 live `127.0.0.1:8787` 的前提下，用 live store 的 560 份 JSON 记录复制品做了一次完整替换演练：

- 一次性迁移生成 SQLite、backup 与 marker；首次迁移 `replayed=false`，第二次相同输入 `replayed=true`，source
  digest 相同；迁移共 64 条事件，backup 114 个文件。
- 用 committed `spec-cli/dist` 启动隔离 backend，`/health`、`/api/instance`、`/api/session-runtime/:id/replay`
  与 `/events` 均可用；停止后重启，replay 的 state/proposal/note 完全一致。
- 将迁移 DB 与 marker 暂时移开模拟回滚，再恢复并启动；health 与 replay 再次通过。演练只证明复制品上的切换/回滚
  机制，**没有停止、改写或替换真实 live backend**；真实切换仍需在维护窗口按同一脚本执行并保留原 JSON backup。

## 6. 初始施工阶段的 OPEN（历史边界，非当前 cut-in 的失败）

- **本阶段的三个包在产品路径上没有任何 importer**，这是刻意的：它们是 M4/M5/M6 cutover 的被接入方，不是接入本身。
  因此 M1 证明的是"这套东西自己成立"，**没有**证明任何一条 legacy 路径可以被替换——那要 sabotage + 正向 YATU + 物理删除
  三件齐备，属于后续 lane。
- **ZSwarm 仍然没有可执行证明**。本阶段没有改变这一点，也不该被读作改变了：仓库里依然没有 production importer。
- **locality 的两个洞原样存在**：网络文件系统魔数从内核头转录、**从未在真实网络挂载上执行**（本机没有）；
  macOS/Windows 没有 detector，缺失时一律拒绝（fail closed 是默认，不是遗漏）。唯一的越过方式是显式的
  `--assume-local-storage` 旗标，它不能由环境变量或配置文件打开。
- **root build 仍未接线**（§4.2）：等真的有产品路径依赖这三个包的那个里程碑。
- 引擎契约 §13 的全部 OPEN 项原样保留：真实网络挂载上的 locality 判定、macOS/Windows detector、
  reader-blocks-writer 在真实 adopter 负载下的表现、sweep 节奏、retention/purge、备份运维、`ANALYZE` 维护、Rust 第二实现。
