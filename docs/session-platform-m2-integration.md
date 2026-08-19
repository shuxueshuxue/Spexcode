# Session platform M2 integration ledger

本文是 M2 实现细节冻结与三个 adopter 切入包的集成检查点记录。它记录**集成了什么、跑了哪些门、结论是什么**，
不重复各 lane 交付物的正文。三份 HTML 与 concept-map 表达已冻结原则与施工约束，本次集成**未改动它们**。

## 1. 集成范围

集成头是 campaign head `6ea863b22`（**不是 `main`**；main 另有 35 个无关提交）。三条 lane 均以该 commit 为 base，
文件面互不重叠，按 lane 顺序 no-ff 合并。

| Lane | Session | 交付 | 分支 head |
|---|---|---|---|
| M2 SQLite engine 细节冻结 | `de57398c` | `docs/session-protocol-sqlite-engine.md`、`.spec/…/session-protocol/sqlite-engine/`、`spikes/sqlite-m2/` | `8d4a80b7a` |
| 三 adopter 最小 API 反推 | `189f7b4f` | `docs/session-adopter-cutin-plan.md`、`.spec/…/session-runtime/adopter-cutin/`、`spikes/adopter-api/` | `3f3fc3129` |
| legacy sabotage 与删除门禁 | `bbb98193` | `docs/session-legacy-deletion-gate.md`、`.spec/…/concept-map/legacy-deletion-gate/`、`spikes/legacy-sabotage/` | `10dbf1736` |

## 2. 集成门禁与结果

集成前对每条分支、集成后对合并树各跑一次。全部由集成方独立执行，不采信 lane 自述。

| 门 | 结果 |
|---|---|
| ancestor gate（三条分支均以 `6ea863b22` 为祖先） | PASS |
| 文件重叠检查（三条分支改动文件取交集） | 空集，无重叠 |
| 窄 diff（各 lane 改动是否越出其独占文件面） | PASS |
| `spex spec lint`（合并树） | 0 error |
| immutable 证据锚点（合并树上逐字节复比） | 4/4 未变 |
| Node 22.21.0 / SQLite 3.50.4 引擎全套（合并树） | tests 53 / pass 53 / fail 0 |
| adopter 契约（合并树） | self-launch PASS · Spex governed PASS · ZSwarm exit 77（诚实无证据绊线） |

immutable 锚点（原始失败证据，任何时候不得编辑、删除或被重试结果覆盖）：

```
e072e7749fb240af…  spikes/adopter-api/fail-first-self-launch.log
347310331413da8c…  spikes/adopter-api/fail-first-spex-governed.log
c339db23cca67622…  spikes/legacy-sabotage/fail-first.log
225a3e4aab70ed0e…  spikes/sqlite-m2/fail-first.log
```

## 3. 本轮新增的已冻结决定

- **journal mode = rollback journal `DELETE`，禁用 WAL**（人类裁决）。理由：WAL-reset bug 仅影响 WAL 模式，
  改用 DELETE 即绕开，从而保住 Node >= 22 的 fleet 兼容，不改 `.nvmrc` / `engines` / macmini。
  WAL 仅作为未来 `SQLite >= 3.51.3` 的独立升级实验，不进 v1 contract。
- **SQLite 最低版本 = 3.38.0**，从引擎实际用到的 SQL 特性推导，卡点是 JSON 内置（3.38.0）而非 STRICT（3.37.0）：
  3.38.0 之前使用 `json_valid` 等价于依赖对方编译时是否开启 `SQLITE_ENABLE_JSON1`，**依赖编译开关不构成版本下限**。
  该下限有专门 vector 逐特性验证，且 `3.38.0 <= 3.50.4`（Node 22）自洽。
- **storage locality 是 adopter path resolver 的显式安全前提**：绝对 `databasePath` 解析后、`openProtocol` 之前判定
  本地 filesystem 与可靠 advisory locking；非本地或无法判定即 **fail closed**（allow-list，不是 deny-list）。
  **协议核心不做、也不假装做此判定**，核心内无 `statfs`、无魔数黑名单（有断言 vector）。
  本文档任何内容**不得**被读作「DELETE 使网络 FS 安全」：事实相反——WAL 因共享内存要求会自动 fail loud，
  DELETE 不会，故保护必须显式做出。
- **global session identity seam**：一个 `databasePath` 内 `session_id` 全局唯一、单列主键；协议不接受
  `(project_id, session_id)`；`project_id` 是纯 adopter metadata；多项目共库由 adopter 自行保证全库唯一；
  人类短 id 由 adopter 维护 project-local alias。
- **consumer handler journal 不进协议，且不与 `dequeue` 同事务**（M3 裁决）。同库原子 seam 只覆盖
  *topology mutation + required enqueue*；`dequeue` 不在其中，仍是 at-most-once 的协议交付边界。需要下游重试的
  adapter 可自建 `messageId`-keyed journal（可放在同一 adopter 数据库），但那是 adopter 财产，
  **不得被描述为协议级 at-least-once**，其 crash/retry 语义由 adopter 自证。dequeue 提交与 journal 写入之间崩溃
  会丢掉「欠处理」这一事实，是 v1 明码标价的代价。反例守着这条：
  *a handler that dies after dequeue never makes the message reappear*（`spikes/sqlite-m2/test/concurrency.test.mjs`）
  在 dequeue 提交后、任何下游动作前 SIGKILL 消费者，断言 `listPending` 为空、下一次 `dequeue` 为 `null`、
  history 仍记录已出队；stub `at-least-once-redelivery` 会让它触发。
- **G.5 #11 删除门禁**：生成物是四个独立面（TS source / dist / npm-pack tarball / materialized），各自带前置条件；
  任一前提不满足即 `NOT-MEASURED` 并非零退出，**不得渲染为 0**，也不得用 source=0 代替其它三面。

## 4. 证据纪律（本轮确立，后续 lane 一律适用）

1. 原始失败证据一字节不许改、删或被重试结果覆盖；它是证据链的一部分，即使事后发现记录的是 harness 自身 bug。
2. fail-first 必须有**判别力**：失败必须是本方断言抛出。模块找不到、路径拼错一类环境噪声在实现正确时同样会失败，
   对契约零判别力，不算 fail-first。
3. 每个反例三件套写进文档：source-backed `file:line`、完整可复制的 before/after 命令、最小反例（改动点与其足以致炸的理由）。
4. 收尾时工作树必须可复现：canonical 文件名下是真实实现，故意做坏的 stub 单独存放并由显式开关选择。
5. 计数类门禁必须区分「测得 0」与「没测」，后者不得渲染为前者。

## 4.1 集成期发现：一条冻结决定目前是断言而非门禁

集成方重跑 `spikes/sqlite-m2/stubs/run.mjs` 后，结果是 **flips gated by at least one vector: 9/10**。
未被任何 vector 拦住的是 **`busy-timeout-after-version-probe`**（claim：`busy_timeout` 必须是连接上的第一条语句）。

- 该 stub 触发的 vector 数为 **0**。runner 确实同时跑了 `test/engine.test.mjs` 与 `test/concurrency.test.mjs`
  （`stubs/run.mjs:14`），所以这不是"没跑到"造成的。
- lane 自述为「9/9 反例」，与实际 runner 输出不一致。lane 本身已如实记录过该条只能跨进程复现、单进程 vector 拦不住，
  并称已把冷开竞态做成正式 vector；但按当前 runner 输出，那条 vector 在此次运行中并未因该翻转而失败。
- 该决定本身有实测支撑（错误顺序 20 轮输 11 轮、正确顺序 25 轮 0 失败），**证据是真的**；
  缺的是"翻转它会让我们自己的断言炸"这一层门禁。按本轮确立的标准，这条目前是**断言，不是门禁**。
- 其余 9 条（含集成期新增的 `at-least-once-redelivery`，触发 5 条 vector）均被至少一条 vector 拦住。

处置：如实记录，不在被审分支上代为修复；是否重开该 lane 补一条能稳定复现冷开竞态的 vector，由人类裁决。

## 4.2 施工教训：parked lane 的文件由 lane owner 自己写

M3 裁决要求补一个反例，而反例的自然位置在 `spikes/sqlite-m2/`——一条**已经 parked、已通过复核**的 lane 的文件面。
集成方当时直接代写了（`worker.mjs` 的 `crash-handler` op、`test/concurrency.test.mjs` 的 handler-crash vector、
`stubs/build.mjs` 的 `at-least-once-redelivery` flip）。反例本身是对的、也证明了判别力，但这个**动作顺序是错的**：
它让那条 lane 的 worktree 与集成头在同一批文件上各写一半，于是该 lane 再次开工前被迫先做一次合并。

规则：**需要改动一条 parked lane 的文件时，先 reopen 该 lane，由 owner 自己写，集成方不代写。**
集成方的职责是跑门禁、退回精确证据、做原子合并；代写会同时破坏两件事——lane 的所有权边界，
以及「reviewer 不在被审分支上顺手修复」这条检阅规则。

若不可避免地已经代写，补救是明确的：让 lane 用普通 `git merge` 把集成头并进自己的分支并保留 merge commit，
在自己的 worktree 里解冲突，**先验收既有证明再新增**，不 rebase、不 amend。

## 5. 两个时代的数字

DELETE 裁决使此前全部并发/吞吐/crash 测量作废重测。文档中并排保留两代数字，**不得混用**：

| 项 | WAL 时代（历史依据） | v1 生效值（DELETE） |
|---|---|---|
| 短写吞吐 / 10s | 3556 | 1266–1313（Node 22：1246–1299） |
| p50 / p99 | 2.93 / 6.14 ms | 7.03 / 12.6–14.0 ms |
| roadmap M2 exit（500/10s） | 达标 | 达标，余量 2.5–2.6 倍 |

DELETE 的已知代价（实测，未写软）：reader 不挡 writer，但 **writer 会被打开的读事务挡住**
（`write_during_open_read: BLOCKED: database is locked`）。协议自身的读是单语句因而很短，但 adopter 若长期持有
读事务将阻塞该库所有写者——这是对 adopter 代码的真实约束。

## 6. 已知文档缺陷（保留为显式缺陷，本次不修）

- **里程碑编号冲突**：`session-management-refactor.html` §8 使用自有的 M0–M6 编号，与
  `session-platform-construction-roadmap.html` 的 M0–M9 冲突（例如 refactor 的 M4「一次性离线导入」= roadmap 的 M7）。
  这是导航陷阱而非原则冲突。建议修法：refactor §8 改为引用 roadmap 编号，或显式标注为「本页局部阶段编号，
  与施工路线 M0–M9 不对应」。**未自行重编号。**

## 7. HTML 待更新清单

三条 lane 共提交待更新段落清单，均**只列不改**（HTML 不在任何 lane 的独占文件面内）。清单随本次裁决有增删，
其中数项**已作废或反转**，不得照旧执行：

- ARCH §7 —— 补明地址空间在一个 `databasePath` 内是扁平全局的，`project_id` 只是 adopter metadata。
- ARCH §8 —— 版本门禁应写 **3.38.0 及其推导依据**；3.51.3 只属于 WAL 实验一节。（原清单「写上 3.51.3」**已作废**。）
- ARCH §9 / §11 —— application lock 的整体删除改为「删 DB lock + 保留具名外部围栏」；observer 仅拆通信依赖；
  增补「启动拒绝低于下限」与「一个进程不得链接两份 SQLite build 打同一个库」。
- REFACTOR §2 —— `busy_timeout` 必须是连接上第一条语句（实测 11/20 输 vs 0/25）；
  `journal_mode` 一行由「设置 WAL」改为**只断言 delete、不设置**；网络 FS 一句**反转**为
  「locality 由 adopter resolver fail-closed，核心不做也不假装做」。
- REFACTOR §3.2 / §3.3 / §4.3 —— 长度 255→256、补字符集与禁首字符 `-` 的 CHECK、**删除 `retired_at_ms >= created_at_ms`**
  （时钟回拨会使合法 retire 失败）、补 `protocol_version` 列、内联 UNIQUE 改 partial unique index、
  补 history 索引与 `INDEXED BY`、明确 `message_id` 由协议生成与 `payload_hash` 的规范编码、
  `headers_json` 长度需 `CAST(... AS BLOB)` 才是字节。
- REFACTOR §9 —— 增补冷开竞态、并发提交下 cursor 不跳过、driver parity、跨 build 锁互见、
  **rollback journal recovery**、fleet 解释器六行。
- ROADMAP §2 / §4 / §5 / §6 / §8 / §9 / §10 —— importer 的构建与证明前移至 M6 之前；M6 的 normal cut 条件化于
  importer proof；删除表拆分 record-lock/fence 并补 `/tmp` rv、global manifest、dist/tarball/materialized 三面；
  攻击表替换为 L01–L11 / R01–R09 可执行脚本；merge 证据绑定五计数与 strace 机制并区分 test-only；
  M2 exit 数字改用 **1266–1313/10s**（非 WAL 时代的 3556）。

## 8. 仍然 OPEN

driver 已按裁决冻结为 `node:sqlite`（better-sqlite3 的 45/45 parity 数据保留，作为「driver 可替换、schema 才是契约」的证据）。
其余未决项：macOS/Windows 的 locality detector（缺失时必须拒绝，不得乐观放行）；网络魔数从内核头转录、
**从未在真实网络挂载上执行**（本机无网络挂载）；sweep cadence；retention/purge；backup 运维节奏与恢复演练；
`ANALYZE`/`PRAGMA optimize` 维护（`INDEXED BY` 已将其移出正确性）；Rust 第二实现。
（「同库事务缝是否接纳 `dequeue`」已由 M3 裁决收口为**不接纳**，见 §3，不再是 OPEN。）

`session-protocol` 的 6 条 missing scenario 与 `runtime-session` 的 stale 属 M1/M6 lane 的刻意留白，
测它们需触碰 `packages/session-core/**`，不在本轮任何 lane 的授权范围内。
