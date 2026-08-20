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

（集成阶段填写。每一门都由集成方在合并树上独立执行，不采信 lane 自述。）

## 5. 仍然 OPEN

（集成阶段填写。）
