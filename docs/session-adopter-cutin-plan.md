# 三个 adopter 的最小 API 反推

本文是从真实入口和可执行 spike 反推的 adopter cut-in contract。它不改写三份架构 HTML 的冻结原则，也不授权生产迁移。所有数据库均为 spike 创建的临时绝对路径；没有 ORM、daemon、outbox、observer 或 production adapter import。

## 证据边界与共同结论

协议的 authority 是 adopter 解析出的显式绝对 `databasePath`。`initialize` 建立精确地址，`enqueue` 写入不可变 FIFO 消息，`dequeue` 在 commit 时完成 at-most-once 协议交付；跨进程 wake 只影响延迟。拓扑的 `attach`/`detach`/`reparent`/`subscribe`/`recipients` 属于 adopter，必要的 topology mutation 与 enqueue 用同一个数据库的同步事务 seam。

真实代码证据如下：

- self-launch 的 shell 入口是 `spec-cli/hooks/harness.sh:62-94`（payload session id）和 `:111-155`（git-common-dir 派生 runtime/session store），`spec-cli/hooks/dispatch.sh:19-40`（harness/event argv、source `harness.sh`），`:58-105`（manifest handler 调度）。仓库没有已落地的 session-protocol CLI argv surface。
- Spex producer 是 `spec-cli/src/client.ts:253-260` 的 `clientSend`，后端 producer/consumer 是 `spec-cli/src/sessions.ts:4191-4259` 的 `sendText`/`drainSession`，重启恢复 sweep 是 `spec-cli/src/sessions.ts:1772-1792` 的 `superviseDelivery`。
- G.1 L09 的真实结论仍成立：`packages/session-core/src/runtime-session.ts` 的 public export 只有 session-core tests/public-boundary 消费；本仓库没有 production importer，外部 ZSwarm 使用未经证实。

spike 证据：原始 `fail-first-self-launch.log` 与 `fail-first-spex-governed.log` 保持原字节，记录的是最初把 `file://` URL 当文件路径的 harness bug，不是契约失败证据；它们对应的原始命令分别是 `node spikes/adopter-api/self-launch-contract.mjs` 与 `node spikes/adopter-api/spex-governed-contract.mjs`。修好的 harness 通过显式 stub 开关重新运行后，`fail-first-assert-self-launch.log` 记录 `initialize stdout contract` 断言失败，`fail-first-assert-spex-governed.log` 记录 `producer contract` 断言失败；两次命令分别是 `ADOPTER_API_SELF_LAUNCH_STUB=1 node spikes/adopter-api/self-launch-contract.mjs` 与 `ADOPTER_API_SPEX_GOVERNED_STUB=1 node spikes/adopter-api/spex-governed-contract.mjs`。`pass-self-launch.log` 与 `pass-spex-governed.log` 是 canonical 真实 shim 的通过输出。ZSwarm fixture 只以退出码 77 报告 `no executable proof available at this base`。

本次 spike 未实测真实 NFS 或其它网络 filesystem，也没有把 Linux/macOS/Windows 的 locality detector 伪装成已实现；因此没有可宣称的 locality fail-closed vector。实现 OPEN 的 detector 缺失本身必须拒绝，不能把“无法判定”当作本地。

反例的最小改动和 source-backed 位置：self-launch 只把 canonical CLI 换成 `stubs/self-launch-cli-wrong-shape.mjs:2` 的 `{}`，因此 `self-launch-contract.mjs:26` 必然抛 `initialize stdout contract`；Spex governed 只把 producer/consumer 子进程换成 `stubs/spex-governed-sequence-wrong-shape.mjs:2` 的 `{}`，因此 `spex-governed-contract.mjs:22` 必然抛 `producer contract`。两个 fixture 的 canonical 路径解析分别在 `self-launch-contract.mjs:9-13` 与 `spex-governed-contract.mjs:9-13`，现在均使用 `fileURLToPath`；canonical 文件名下仍是真实实现，未被 stub 覆盖。

## ZSwarm

### 1. 真实入口

本仓库无 production ZSwarm importer、runtime loop 或配置 reader。唯一可靠证据是协议 adoption pressure、`session-runtime` spec 对 `ZSwarm topology + ZSwarm runtime adapter` 的形态描述，以及 G.1 L09 的“external ZSwarm use is unproven”。不能给出 ZSwarm 的文件:行或接口名称。

### 2. 最小调用序列（未被真实 consumer 证实）

这是协议 spec 允许的最小形状，不是现有实现的调用点：

1. ZSwarm worker 进程按自己的 config 解析绝对 `databasePath`。
2. worker 进程对 worker 的 opaque `sessionId` 调 `initialize(sessionId)`。
3. producer/worker 进程用 `recipients` 查询关系；若关系变化，使用 topology 的 `attach`/`reparent` 与 `enqueue(target, message)` 同一同步事务提交。
4. ZSwarm worker 进程对自己的地址调 `dequeue(target)`；返回即协议交付。
5. 同一 worker 的 runtime adapter 把 body/headers 交给 harness input；若 adapter 需要重试，用自己的 `messageId` journal，不回写 protocol。

没有真实 consumer，以上每一步都标为“推定”；不存在可以声称已通过的 ZSwarm YATU。

### 3. adopter 必须自己拥有

ZSwarm 必须拥有 config/path resolver、自己的 topology 表、ZSwarm runtime adapter、可选的 `messageId`-keyed consumer journal，以及进程内 wake hint。协议不读取 ZSwarm task role、workspace 或 application config。

### 4. 最薄切入包

`spikes/adopter-api/zswarm-contract.mjs` 只检查 G.1 L09 的无证据标记并以退出码 77 退出；`fail-first-zswarm.log` 保存原始结果。这是当前最薄且诚实的包：它证明我们没有伪造 importer。要把它变成已证实 adopter，必须有仓库外 clean consumer 的 source/packed dependency、绝对 DB path、topology route、worker loop、lost-wake/restart 以及 adapter input 的完整 YATU 输出，并把该证据提交到本仓库。

### 5. 推回协议的压力判定

若 ZSwarm 要求协议理解 parentage、`governed`、lifecycle、native identity 或 adapter result，判定为 adopter 边界错误：这些分别属于 ZSwarm topology、ZSwarm state、runtime adapter 或 consumer journal。只有当它发现所有 adopter 都需要同一个 DB transaction/recovery 规则时，才是协议不完整；当前冻结 v1 已由 `withTransaction` seam 覆盖。

### 6. 必须删除的 legacy

没有本仓库证据可以把任何旧 ZSwarm mailbox/projection 指派为真实 reader/writer，因此不能宣称删除完成。路线图 M5 的删除条款（旧消息持久化、关系投影、兼容 adapter）只有在外部 consumer inventory 落地后，才能分别映射到 G.1 L01（旧 pending/message authority）、L04（关系投影）和 L09（mixed bridge）；应在 M5 cutover 的 sabotage + positive proof 同一里程碑删除，M8 只清理已验证的打包/迁移残留。没有该 inventory 前，删除清单是 open，不是事实。

## self-launch

### 1. 真实入口

`spec-cli/hooks/dispatch.sh:19-40` 接收 `<harness> <Event>`，source `harness.sh`，再按 materialized manifest 执行 handler（`:58-105`）。`spec-cli/hooks/harness.sh:62-94` 从 payload 取 acting `session_id`，`:111-155` 通过 git-common-dir 派生旧的 Spex runtime/session store。这里没有 protocol CLI 的现成 argv 证据；因此薄 CLI 契约由下方 fixture 反推，而不是冒充 production API。

### 2. 最小调用序列

1. materialize 进程写 harness 可发现的 hook/command；shell hook 进程只执行 CLI，不 import Node library。
2. hook/CLI 进程按路径优先级解析 DB（显式参数 → 环境变量 → adopter 全局 config → OS 默认）；得到绝对路径后、调用 `openProtocol` 之前，adopter resolver 必须确认该路径位于本地且 filesystem 支持可靠 advisory locking，再调 `initialize(nativeSessionId)`。
3. 任意 producer 进程（可以没有 backend）打开同一绝对 DB，调 `enqueue(target, message)` 并在进程退出前等待 commit。
4. 用户显式 listener/monitor CLI 进程调 `dequeue(target)`；空队列是成功的 `null`。
5. listener 的 stdout 被 harness configuration seam 交给 harness runtime adapter；adapter 负责 native input 和自己的 journal。没有常驻 backend，也没有 wake correctness 依赖。

### 3. adopter 必须自己拥有

self-launch 拥有 path/config resolver、materialized configuration adapter、显式 listener、harness runtime adapter，以及需要重试时按 `messageId` 建立的 consumer journal。它没有 governed table、Spex lifecycle 或 resident backend；wake hint 可以不存在。

薄 CLI 的精确 argv 契约（由 `self-launch-contract.mjs` 跑出）是：

```
self-launch-cli.mjs initialize --database-path ABS --session-id ID
self-launch-cli.mjs enqueue --database-path ABS --session-id ID --message-id MID --body TEXT [--idempotency-key KEY]
self-launch-cli.mjs dequeue --database-path ABS --session-id ID
```

#### Consumer handler journal（M3 已裁决）

v1 **不要求** consumer journal 与 `dequeue` 同一事务，**也不把 handler journal 纳入 session protocol**。
同库原子 seam 只覆盖 *topology mutation + required enqueue*；`dequeue` 不在其中，仍是 at-most-once 的协议交付边界。

因此：需要下游重试的 adapter 可以自建 `messageId`-keyed journal（可以放在同一个 adopter 数据库里），但那是
**adopter 的财产**——任何 adopter **不得**把它描述成协议级 at-least-once，其 crash/retry 语义由 adopter 自己证明。
dequeue 提交与 journal 写入之间崩溃会丢掉「欠处理」这一事实，这是 v1 **明码标价的代价**，不是疏漏。

这条不是散文承诺，有反例守着：`spikes/sqlite-m2/test/concurrency.test.mjs` 的
*a handler that dies after dequeue never makes the message reappear* 在 dequeue 提交之后、任何下游动作之前
SIGKILL 消费者，然后断言 `listPending` 为空、下一次 `dequeue` 返回 `null`、history 仍记录该消息已出队。
配套 stub `at-least-once-redelivery`（其 `dequeue` 跳过状态转换）会让该 vector 触发，所以「没有 at-least-once」
是被测量出来的，不是假设出来的。

#### Storage locality precondition

路径 resolver 得到绝对 `databasePath` 后、调用 `openProtocol` 之前，必须确认 database 所在 filesystem 是本地的，并支持可靠 advisory locking。非本地或 locality 无法判定时必须 fail closed（默认拒绝），退出 1，stderr 沿用 `self-launch-cli: STORAGE_LOCALITY_UNVERIFIED: message`。协议核心不做、也不假装做这个判定；它只接收已由 adopter 判定合格的绝对路径。v1 使用 rollback journal DELETE、禁用 WAL；WAL 在网络 filesystem 上会因共享内存要求 fail loud，但 DELETE 不会替 resolver 自动提供这道闸门。macOS/Windows detector 仍是实现 OPEN，detector 缺失同样拒绝；真实 NFS 本 spike 未实测。

每个命令 stdout 为单行 JSON（`initialize` 是 `{sessionId,state}`；`enqueue` 是 message；`dequeue` 是 message 或 `null`），成功退出 0。usage/argv 错误退出 2；protocol/storage 错误退出 1，stderr 为 `self-launch-cli: CODE: message`。路径优先级是显式 `--database-path`、`SPEX_SESSION_DATABASE_PATH`、`SPEX_SESSION_CONFIG` JSON 的 `databasePath`、OS 默认。spike CLI 选择 `$HOME/.spexcode/sessions.sqlite` 作为最后兜底，但这是 adopter policy 示例，不是冻结的产品默认；产品仍应保持可重定位。CLI 只做解析和调用，不是 daemon。

### 4. 最薄切入包

文件清单：`spikes/adopter-api/self-launch-contract.mjs`、`self-launch-cli.mjs`、`stubs/self-launch-cli-wrong-shape.mjs`、`protocol.mjs`（一次性复制的 spike protocol）、`fail-first-self-launch.log`、`fail-first-assert-self-launch.log`、`pass-self-launch.log`。原始日志保留路径 bug；新日志由 `ADOPTER_API_SELF_LAUNCH_STUB=1 node spikes/adopter-api/self-launch-contract.mjs` 产生并证明 `initialize stdout contract` 有判别力；canonical pass 日志证明无 backend 时 initialize、offline enqueue、显式 dequeue、空队列 `null`、绝对路径和环境变量解析。locality detector/NFS vector 在本 spike 未实测，不能把 pass 日志解释为 locality 覆盖；不触碰任何 production adopter。

### 5. 推回协议的压力判定

要求协议读取 Spex fixed root、governed record、hook payload 或 native input 是 self-launch 边界错误；self-launch 应把它们留在 configuration/runtime adapter。若要求协议提供同一 SQLite transaction、at-most-once dequeue 或 lost-wake recovery，则属于协议共性，当前 v1 已覆盖。要求 CLI 自动 drain、claim/ack 或 observer correctness 则是越过冻结协议语言的 adopter policy。

### 6. 必须删除的 legacy

**这一段原先的删除归属已被实测推翻，下面是更正后的版本。**（更正依据：`docs/session-platform-m4-inventory.md`，
20 行 G.1/G.2 逐行判定，5 CONSUMER / 15 NO-CONSUMER / 0 NOT-MEASURED。）

原文把 G.1 L01（旧 pending queue）、L02（timeline send authority）、L03（protocol cursor）、L06（delivery lock）
的删除归给 M4。**实测这四行在本基线上没有 self-launch consumer**：`spec-cli/src/sessions.ts:4255-4264` 的
`sendText` 先 `readRecord` 再接受，无记录直接拒绝，因此 self-launched 会话从来收不到消息，也就从未写过这四类文件。
把它们记成"M4 已删除"等于把一条从来不存在的路径冒充成拆除完成，会让 M8 的最终审计拿到假账。
**这四行的真实 consumer 是 governed 路径，删除归 M6，residue 归 M7/M8。**

G.2 R04（固定 Spex root/path 假设）**确实是 self-launch consumer**，但**同样不属于 M4**：它承载的是
materialized hook 自己的状态（`spec-cli/hooks/harness.sh:111-132` 推出 `<runtimeRoot>`，
`.spec/spexcode/.plugins/core/spec-first/spec-first.sh:39` 与 `spec-of-file.sh:55` 在
`<runtimeRoot>/sessions/<sid>` 下写 `spec-checked` / `spec-of-file-seen` 两个 sentinel），
而 M4 的 listener 并不替代它们——不被替代的设施不能被删。同理 L05 的 legacy session-directory 形状、
R05/R06/R07 也都是 CONSUMER 且未被 M4 替代。

因此 **M4 的物理删除清单为空**，而这是被证明的空、不是没查：判据是"既被 self-launch 消费、又已被 M4 同行为替代"
两个条件同时成立，本基线上没有任何一行满足。M4 交付的是新增能力加上"新路径不可达旧设施"的静态引用与
file-access trace 证明；`.session-locks`（G.1 L07）里与 Git/harness 外部效果相关的部分同样不因任何 self-launch
证明被一并删除。

## Spex governed

### 1. 真实入口

producer 入口是 `spec-cli/src/client.ts:253-260` 的 `clientSend`，其后端 `/api/sessions/:id/input` 最终落到 `spec-cli/src/sessions.ts:4191-4237` 的 `sendText`；consumer/adapter handoff 是 `spec-cli/src/sessions.ts:4242-4259` 的 `drainSession`，常驻 backend 的 lost-wake recovery 是 `:1772-1792` 的 `superviseDelivery`。现有实现仍写 legacy timeline/pending/session records；这些行是 cutover 的真实 reader/writer 证据，不是目标 API。

### 2. 最小调用序列

1. Spex adopter config 进程解析 shared state root + project namespace，得到一个绝对 `databasePath`；protocol 不读取这些 config。
2. lifecycle/process 先对 parent/child opaque ids 调 `initialize`；随后 producer 进程在同库同步事务中用 topology `attach(parent, child, relation)`、`recipients(child)`，并对确定的 parent 调 `enqueue`。事务内只做 SQL/内存校验。
3. backend/runtime 进程收到 wake hint 或 bounded sweep 后查询 pending，调 `dequeue(parent)`；commit 后即协议交付。
4. 同一进程把 message 交给 harness runtime adapter（native input），按 `messageId` 写 Spex adopter 的 consumer journal；adapter crash/retry 不扩展 protocol queue。

### 3. adopter 必须自己拥有

Spex adopter 拥有 config/path resolver、`spex_governed_sessions` 与 topology edge 表、lifecycle/governance policy、harness runtime adapter、`messageId`-keyed consumer journal 和 wake hint/sweep。它的 resolver 与 self-launch 相同：绝对 `databasePath` 解析后、调用 `openProtocol` 前，必须判定本地 filesystem 和可靠 advisory locking；非本地或 locality 不可判定时默认 fail closed，不能把探测责任下放给 protocol。materialization adapter 继续独立拥有 hooks/commands/trust；protocol 只存 opaque session/message。

#### Global session identity seam

这是 adopter 与 protocol 之间唯一的地址/身份缝：一个 `databasePath` 内的 `session_id` 全局唯一，是单列主键；协议不接受 `(project_id, session_id)`，也不把 project 维度拼进自己的地址 API。`project_id` 是纯 adopter metadata，只存在于 `spex_governed_sessions` 这类 Spex-owned 表，不参与 protocol address。多项目共库时，adopter 在生成 id 时自己保证全库唯一，可以把 namespace 编进 id，也可以直接使用全局 opaque id；协议不读取 project config 来替 adopter 解析。

这条 seam 收束 G.5 #1：唯一 identity authority 落在 adopter DB 的 global opaque id；`initialize(sessionId)` 不读 `session.json`，也不接受 project 维度。Spex 的 lifecycle/native identity 仍是 adopter 表字段，不能回流到 protocol session row。self-launch 使用 native session id 时同样受一个 databasePath 内全局唯一约束；ZSwarm 也应遵守这一点，但该 adopter 结论目前只是 spec-derived 推定，因为本仓库没有 production importer 证据。

证据与 schema 空洞保持可见：架构文档第 7 节说同一 state root 共享一个数据库、用 `project_id` 区分项目；协议 spec 要求 one exact session address、未知 id 不隐式创建；refactor 第 6 节展示 `session_id TEXT PRIMARY KEY` 加 `project_id`。因此 Spex 最小 API 不能要求复合键，若产品保留人类短 id，必须由 adopter 维护 project-local alias，传给 protocol 的仍是全局 id。

### 4. 最薄切入包

文件清单：`spikes/adopter-api/spex-governed-contract.mjs`、`spex-governed-sequence.mjs`、`stubs/spex-governed-sequence-wrong-shape.mjs`、`protocol.mjs`、`fail-first-spex-governed.log`、`fail-first-assert-spex-governed.log`、`pass-spex-governed.log`。原始日志保留路径 bug；新日志由 `ADOPTER_API_SPEX_GOVERNED_STUB=1 node spikes/adopter-api/spex-governed-contract.mjs` 产生并证明 `producer contract` 有判别力；canonical pass 日志证明 producer 子进程把 governed rows、topology edge 和 `enqueue` 在一个 `withTransaction` 中提交，consumer 子进程证明 `dequeue` 后 adapter input 与 `messageId` journal。fixture 的 `project_id` 明确只存在 adopter 表，不进入 protocol row。

### 5. G.1 L01-L11 的最小 API 后果

| legacy | protocol 调用 | adopter 表/状态 | adapter 或删除后果 |
|---|---|---|---|
| L01 pending.json | `initialize`、`enqueue`、`dequeue`、`listPending` | protocol `messages`；Spex 不再写 pending JSON | dequeue 后 adapter journal 自己负责重试；M6 停止旧 queue reader/writer |
| L02 timeline | `enqueue`/`readMessages` 保存 opaque send history | lifecycle history 与 prompt/execution history 分开 | adapter 不读 timeline settlement；M6 切 authority，M7 importer 先行 |
| L03 cursors | `readMessages(afterSequence?)`，cursor 不进 protocol | consumer-owned durable/ephemeral cursor policy 必须由 Spex 明写 | G.5 #2 的缺口要求最小 API 选择 restart 语义后才能删；M6 cut、M8 residue |
| L04 watchers/parent | topology `attach`/`detach`/`reparent`/`recipients` + 同事务 `enqueue` | topology edges；project/lifecycle policy | 删除 parent/watch 双 authority；M6 cut，M8 fallback/import |
| L05 session.json | `initialize(sessionId)` 只建 protocol address | `spex_governed_sessions(project_id, lifecycle, native_identity, ...)` 与 lifecycle/worktree 表 | G.5 #1 要求唯一 identity authority；本 cutover 选 adopter DB + global opaque id，M6/M7 迁移，M8 删 codec |
| L06 delivery locks | SQLite transaction serializes protocol rows | adapter/process locks 仍由 runtime/harness 持有 | 不把 external-effect lock 塞进 protocol；M6 删 queue lock caller，M8 删无 caller 根 |
| L07 record locks | protocol transaction 只保护 DB facts | Git/worktree/files/web/harness fences 留在 adopter/adapter | 只拆 DB 部分；不能用 queue proof 宣称 L07 全删 |
| L08 fs observer | 无协议调用；wake 只是 hint，sweep 查询 DB | Spex graph freshness 可有独立 DB signal；通信 correctness 不依赖 observer | M6 停 session-store observer correctness，保留合法 Git/project watcher |
| L09 runtime-session bridge | `initialize`/topology/`enqueue`/`dequeue` 分层调用 | governed/lifecycle/topology/adopter runtime 各自表/模块 | 当前无 production importer；M5 clean-adopter proof 后冻结，M6 删 Spex calls，M8 删 package residue |
| L10 revoked-senders | 不把 sender policy 编成协议词；enqueue 的 sender 是 opaque | lifecycle close/revocation 与 topology/queue transaction 同库 | G.5 #6 的最小 API 后果是 Spex 必须在同一事务定义 sender close/send race；不能无条件删除 marker，M1/M3 冻结，M6 cut，M7/M8 迁移删除 |
| L11 dispatch receipts | `dequeue` 即 protocol delivery，无 settle/claim | `consumer_journal(message_id, result)` | adapter crash/retry 只查自己的 journal；M6 切，M7 导入未完成操作，M8 删 timeline receipts |

### 6. G.5 #1/#2/#6 的明确判定

- **#1 identity 三处矛盾：** 最小 API 必须把 protocol identity 定为 adopter DB 内全局 opaque `session_id`；Spex lifecycle/native identity 放 `spex_governed_sessions`。`initialize` 不接受 project id，不读 `session.json`。这同时解决 self-launch recordless 与 governed metadata 的冲突；若保留 universal `session.json`，就是 adopter 边界错误而非协议需求。
- **#2 cursor 没有替代契约：** 最小 API 不能继续声称“consumer-owned cursor”就算完成；Spex 必须选择 durable cursor table（无损 restart）或明确 at-least-once ephemeral cursor（允许 bounded replay），并以 `readMessages(afterSequence)` 作为读取接口。协议不添加 persisted cursor。
- **#6 sender revocation 缺失：** 最小 API 必须在 Spex adopter 的 lifecycle/topology 表中定义 sender close 与 enqueue 的同库事务顺序，或保留 adopter-owned immutable revocation tombstone；protocol 不添加 `revoked`/`settled` 状态。若三 adopter 都需要同一跨产品 revocation 事实，才是协议缺口；当前没有这种证据。

### 7. 必须删除的 legacy

Spex M6 cutover 要求 G.1 L01-L11 的正常 readers/writers 全部切到上述 authority；同时按 G.2 R04 删除 protocol 对 cwd/Spex global locator 的隐式假设、按 R05 删除 `@spexcode/session-core` mixed root/internal exports、按 R07 删除 global manifest fallback（M8）、按 R06 清理旧 dist/packed copies。G.1 L07 仅删除 DB-state lock callers，保留 Git/harness/resource fences；G.2 R01-R03、R08-R09 是 adapter/lifecycle state，不因协议切换整体删除。M6 先 sabotage + positive YATU，M7 再运行隔离 importer，M8 才删除 codec、package、生成物与无 caller lock roots。

## HTML 待更新与冲突清单（只列，不改）

### 需要更新的具体段落

- `session-platform-architecture.html` §6：三条 adopter flow 需要补上每一步的进程归属、Spex 的 global opaque id 结论和 self-launch 薄 CLI argv；ZSwarm flow 必须标为 spec-derived/unproven。
- `session-platform-architecture.html` §7：补充 Spex `project_id` 只是 adopter metadata、`protocol_sessions.session_id` 在共享 DB 内全局唯一，以及 config→absolute path 的 self-launch CLI 证据。
- `session-platform-architecture.html` §11：Self-launch 与 Spex 验收条目应引用可执行 fixture；ZSwarm 条目应要求外部 clean consumer evidence，而不是暗示仓库已有实现。
- `session-management-refactor.html` §5：补充 producer/commit/wake/dequeue/adapter 的进程边界和 at-most-once 后的 consumer journal；§6 的 `spex_governed_sessions` 示例需要明确全局 `session_id` 与 `project_id` 不构成复合主键；§7 L01-L11 映射应指向本计划的 adopter-owned replacement。
- `session-platform-construction-roadmap.html` §3：M4/M5/M6 owner rows 应分别写入 self-launch CLI contract、ZSwarm evidence gate、Spex global-id/cursor/revocation decisions；§4 的 M4/M5/M6 exit/delete 条款应引用 fail-first/pass logs 与“先 importer 后删除”。

### 与真实证据冲突的段落

- `session-platform-architecture.html` §6 ZSwarm flow、§11 ZSwarm “不 import …”验收：文档把 ZSwarm 当作可运行 adopter，但仓库没有 production importer；只能作为目标形态，不能当当前证据。
- `session-management-refactor.html` §6 的 `spex_governed_sessions` 示例：`project_id` 看起来像作用域字段，但 `session_id` 单列主键与共享 `spexcode.db` 的全局地址语义未解释，存在实际作用域空洞。
- `session-management-refactor.html` §8 “三 adopter YATU 全部通过”：当前只有 self-launch/Spex in-spike proof，ZSwarm 没有 executable proof，因此该句超出真实证据。
- `session-platform-construction-roadmap.html` M5 exit “ZSwarm workflow PASS”：在没有外部 clean consumer 证据前不能标记 PASS。
- `docs/session-architecture-concept-map.md` G.1 L09 已正确记录无 production importer；任何把 `runtime-session.ts` public export 视作现有 ZSwarm consumer 的文字都与其自身 ledger 冲突。
