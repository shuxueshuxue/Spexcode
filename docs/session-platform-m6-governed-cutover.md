# Session platform M6 governed cutover 账

本文是路线图 **M6（Spex governed adopter cutover：CLI / hook / dashboard / backend 落在同一个 DB authority 上）**
的施工与门禁台账。基线是 2026-09-12 的 main `d140cca18`；所有数字在 ThinkPad 的活部署上量得，证据目录
`~/.spexcode/evidence/m6-governed-cutover/`（仓库外，只存计数与判定，不存进程环境或原始 trace）。

它不重开 M4/M5 的任何决定。M4/M5 台账正文一字未动（M4 §6 末尾两条逐字重复的 bullet 除外，已删去重复的那一份）。

## 0. 判定先写：M6 是对的标签，但内容和"缺一份施工台账"不是一回事

开工前给的读法是"缺 M6 的施工台账 —— 让 self-launch 会话拿到 record，从而能进消息路径"。逐条量过之后，
这个读法**一半对、一半反**：

1. **M6 的主体施工已经落地并在生产上运行了三周，只是没有台账。** 活着的 `:8787` backend 打开的是
   `~/.spexcode/sessions.sqlite`（含 `-wal`/`-shm`），里面 618 个 session、6506 条消息、896 条拓扑边；
   旧 JSON 树里 `pending.json` / `watchers.json` / `cursors.json` / `session.json` 四类文件**一个都没有**；
   `spec-cli/src` 里对前三者的引用为 **0**。一次受控的 live cutover 在 2026-08-22 跑过、留有 `success.json`。
   这些不是"声明的"，是这台机器上今天量到的（§2）。所以 M6 的台账首先是**补录 + 补门**：把已经发生的切换
   按 Inventory / Sabotage / Delete 的判据钉住，不是从零规划一次切换。
2. **"让 self-launch 拿到 record"是反方向。** `session-runtime` spec 对 self-launch 的定义是
   "no governed lifecycle record, board row, parent, resident backend, or automatic drain"。self-launch 进消息路径
   的正确缝不是 governed record，而是它在 M4 就已经有的**裸协议地址**（`protocol_sessions` 一行）加上两件缺的东西：
   一个接受裸地址的 producer，和一个由接收方自己拥有的 receive 动词（§3）。
3. **self-launch 的收信链在 2026-09-02 被人类决定倒退了一步，且没有入账。** M4 交付的 listener 会在
   `UserPromptSubmit` 上 `dequeue` 并把消息交给 harness 输入缝（M4 台账 D-17）。提交 `0cc9813ad` 按人类 prompt
   的第 4 条明令把它删成只剩 `SessionStart` 登记（"收信由 backend 推送或调用方自己决定何时取"）。这个决定
   没有更新 M4 的证明脚本和 M4 的 owning spec 节点，所以 **M4 自己的正向 YATU 今天在 main 上是红的**（§4.1）。
4. **顺序问题不存在。** 路线图的依赖是"M8 在所有 adopter cutover 落地前绝不启动"，M6 不依赖 M5。
   反而是 M8 的一行（删 `@spexcode/session-core`）在 2026-08-24 已被执行（`81c7e9f7e`），早于 M5 宣称的阻塞解除；
   这条记在 §7，不在本里程碑内解决。

所以本账的形状是：**§2 把已落地的 governed cutover 量成一份可失败的 Inventory；§4 记录本次实测的门；
§5 把剩下的施工（证明修复、self-launch 地址缝、sabotage 门）切成互不重叠的 lane；§3 写清哪些决定已经由人类
做了、哪些还等着。**

### 0.1 对开工时给的四条起点，逐条复核

| 起点 | 复核结果 |
|---|---|
| M4 已完成并关闭 | **不变**，M4 的四步在其基线上成立。但 head 上 M4 §4.2 "synced YATU 11/11" 已不成立：`scripts/m4-self-launch-yatu.mjs` 在 worktree 与 main 各跑一次，均在第 142 行 `JSON.parse('')` 抛错（前 8 条断言通过），因为 listener 的 manifest 只剩 `SessionStart`。M4 台账 §2 D-17、§4.2 两条刻意断言、以及 owning 节点 `self-launch-cutover` 正文"hands what it took to the harness input seam"，在 head 上描述的都是已被删掉的行为 |
| "self-launch 收不到消息，是 M4 有意留的" | **措辞要修**。M4 有意留的是 *governed producer*（`spex session send` → `sendText`）不能投给无 record 的地址（`spec-cli/src/sessions.ts:3620`，行号自 M4 的 4262 漂到 3620）。*adopter producer*（`spex-session enqueue`）→ listener 这条路 M4 是交付了的；把它撤掉的是 2026-09-02 的 `0cc9813ad`，不是 M4 |
| `session-listen` 在我们所有部署里是 no-op | **确认**。活 backend 的环境里 `SPEX_SESSION_*` 出现 0 次，本会话环境同样为 0；hook 第 11–13 行在两个变量都未设时 `exit 0`。补一条量到的事实：hook 的"是否采用"看的是 env，而 CLI resolver（`packages/session-selflaunch/src/path.ts:50-55`）和 backend（`spec-cli/src/session-application.ts:10,36`）都会落到同一个默认路径 `~/.spexcode/sessions.sqlite`——**同一台机器上 backend 已经在那个库里跑，hook 却因为没有 env 而认定"本项目没有采用"**。活库里"有协议地址但无 application 行"的 session 数为 **0**，即三周内没有任何一次 self-launch 登记发生过 |
| M6 没有台账 | **确认没有台账；否认没有施工**（§2） |

## 1. 收口的决定

**D-19（已决，2026-09-02，人类）：self-launch 的收信不由 prompt hook 承担。** `session-listen` 只做 `SessionStart`
登记；收信由 backend push（governed）或调用方显式 dequeue（self-launch）负责。依据：session `c7a5e3ce` 的
prompt 第 4 条与提交 `0cc9813ad`；hook spec `.spec/spexcode/.plugins/core/session-listen/spec.md` 已同步。
本账接受这个决定，并把它的两处未完成后果（M4 证明脚本、M4 owning 节点正文）记为 lane G 的工作。

**D-20（已决，2026-09-12，人类："重构吧……理顺一下"）：self-launch 登记的"采用"判据是店，不是 env。** hook 调
`spex internal session-register <native-id>`；CLI 只在解析出的 canonical store **已存在且 `ready`** 时 initialize，
其它 cutover 状态回 `skipped: <state>` 并退出 0，绝不为了有地方写而建库。env 变量不再参与采用判定。

**D-21（已决，2026-09-12，人类）：receive 是 governed CLI 的三个动词，三种形状刻意不同。** `spex session dequeue`
（一次性：取至多一条，空队列是正常的 `null`）、`spex session wait-dequeue`（background command：阻塞到一条到达，
取走、打印、退出——它的退出就是唤醒；超时退 1 且不消费）、`spex session stream-dequeue`（persistent monitor：每条一行，
不自行退出，SIGINT/SIGTERM 干净结束）。三者都只读**调用方自己**的地址（或显式 `--session <FULL-ID>`），走同一个
`configuredSessionApplication()`，每条打印出来的消息都是在那一瞬间 at-most-once 取走的。归 [[inbox]] 节点。

**D-22（已决，2026-09-12，人类）：裸地址是合法收件人。** `sendText` 在 `readRecord` 为空时改查 `application.readAddress(id)`：
地址存在且未 retire → 入队一条 `session.text.v1`，回 `ok, delivery:"queued", recordless:true`，不 drain（没有这个 backend
拥有的 adapter 可推）；地址不存在 → 仍拒绝，**一个打错的 id 不得铸出一个没人读的队列**。CLI 侧 `send` 对 FULL id 在
governed 解析落空后查本地 store 的地址；backend 不可达时走原有离线入队分支。这正是 M4 D-18 留给 M6 的那一步。

**D-24（已决，2026-09-12，人类："把这个包整个删了"）：`@spexcode/session-selflaunch` 退役。** 它的两块中立逻辑
（`resolveDatabasePath` / `requireLocalDatabasePath`）搬进 `@spexcode/session-application`（`storage-path.ts` /
`storage-locality.ts`，节点 [[storage-path]] / [[storage-locality]]，测试同迁）；spec-cli、graphCache/graphStream、
migrate-session-json、session-live-cutover 全部改 import。零消费者的 `bindSelfLaunchRuntime` 三件与 `spex-session` 四个动词
删除，不迁；hook 改调 `$SPEX internal session-register`。M4 D-16 那道"spec-cli 不 import 协议栈"的边界，本来就是 M6
的接入消解的，这次只是让包的形状跟上事实。已发布包名的退役随下一次 release 记录。

**D-23（本账定）：证明脚本的存活判据。** 台账引用的每一个证明脚本，要么在 `npm test` / CI 路径里，要么在台账里
挂着**最后一次绿的 commit**；两者皆无的脚本不得被任何台账当作"已证明"引用。理由见 §4.1：两个证明脚本在 main 上
红了 10 天和 3 周，没有人知道。

## 2. Inventory：governed 路径在 head 上的每一行

判定词汇沿用 M4：**CUT**（旧 reader/writer 已不存在，新 authority 在用）、**RETAINED-BY-DESIGN**（cut-in 计划
明确保留的外部效果围栏或 adopter 状态）、**NOT-CUT**（旧 reader/writer 仍在正常路径上）、**RESIDUE**（无 caller
的根/文件，归 M8）。每行同时给源码证据与活部署证据。

### 2.1 G.1 消息与记录

| 行 | 判定 | 源码证据 | 活部署证据 |
|---|---|---|---|
| L01 `pending.json` / delivery queue | **CUT** | `spec-cli/src` 非测试文件引用 0；`sendText` 走 `application.enqueueConversationMessage`（`sessions.ts:3620-3640`）；重启补投走 `superviseDelivery` 读 `readPendingMessages`（`sessions.ts:1350`） | 573 个 session 目录里 `pending.json` 为 0；`protocol_messages` 6506 行（prompt 3784 / 待取 134；state.changed 2722 / 待取 61） |
| L02 timeline send authority | **CUT** | `spec-core` 无文件 timeline 写者；`'timeline'` artifact 引用 0；历史读 `application.readMessageHistory`（`sessions.ts:3634`） | 旧树无 timeline 文件（与 L01 同一次 find） |
| L03 `cursors.json` | **CUT** | 引用 0；`session-follow.ts:83,87` 用 `readFollowCursor` / `advanceFollowCursor` | `session_follow_cursors` 757 行；`cursors.json` 0 个 |
| L04 `watchers.json` + record `parent` | **CUT** | 引用 0；`readRecord` 的 `parent` 从 `application.readState` 覆盖（`session-record.ts:97-104`） | `topology_edges` 896（parent 446 / watch:parent 437 / watch:manual 13）；573 个 `runtime.json` 里含 `"parent"` 键的为 **0** |
| L05 `session.json` / 旧目录形状 | **部分 CUT，RESIDUE 一处** | 记录文件改名 `runtime.json`，仅存 worktree/launcher 信封；lifecycle 从 SQLite 覆盖，无 canonical 行时 `readRecord` 抛 `ResourceConflict`（`session-record.ts:102`）。**唯一残留的旧名读者**：`spec-cli/src/host.ts:183` 读 legacy `session.json` | `session.json` 0 个；`runtime.json` 573 个，近 2 天有写（29 次）——这是 production-cutin spec 允许的"operational worktree metadata" |
| L06 `.delivery-locks` | **RETAINED-BY-DESIGN（需改名归类）** | `delivery-lock.ts:5` 仍在 `<runtimeRoot>/.delivery-locks`；两个 caller：reparent（`sessions.ts:314`）与 `drainSession` 的 adapter 交接（`sessions.ts:3698`）。两处守的都是**外部效果**（adapter 输入），不是 DB 事实——属 cut-in 计划 L07 "Git/harness fences 留在 adapter" 那一类，不是 L06 的 queue lock | 目录 mtime 为今天（锁文件创建即删），近 7 天残留锁文件 0 |
| L07 record locks | **RETAINED-BY-DESIGN** | 根已迁到 `.session-record-locks`（`session-record-lock.ts:5`），守 `runtime.json` 信封写入 | 旧根 `.session-locks` 最后修改 2026-08-25，**无 caller → RESIDUE，归 M8** |
| L08 fs observer correctness | **CUT** | `sessions.ts` / `index.ts` 无 `fs.watch`；剩余 `fs.watch` 仅 `graphStream.ts`（spec 图 freshness，计划明确保留的合法 watcher） | — |
| L09 `runtime-session` bridge | **CUT（且已物理删除）** | `packages/session-core` 目录不存在，`@spexcode/session-core` 在非文档源码引用 0；删除提交 `81c7e9f7e`（2026-08-24） | 见 §7：这是 M8 的行，提前执行了 |
| L10 `.revoked-senders` | **CUT** | 引用 0 | 无文件 |
| L11 dispatch receipts | **CUT** | handover 结果写回 `application.dequeueForRuntime`（`sessions.ts:3711`），HTTP 面 `/api/session-runtime/:id/dequeue`（`index.ts:603`） | `session_runtime_bindings` 469 行，全部 namespace `spex-governed` |

### 2.2 G.2 根、包与生成物

| 行 | 判定 | 证据 |
|---|---|---|
| R04 固定 Spex root | **NOT-CUT，按设计**：hook 侧 `hp_runtime_dir`/`hp_store_dir` 仍从 git-common-dir 推 `<runtimeRoot>/sessions/<sid>`（`spec-cli/hooks/harness.sh` 的 `hp_store_dir`，以 `runtime.json` 存在为 governed 判据）；spec 哨兵近 2 天写入 `spec-checked` 14 / `spec-of-file-seen` 17 次。协议侧则已是显式绝对路径（`path.ts`）。cut-in 计划的 R04 删除条款针对的是**协议**对 cwd/global locator 的隐式假设——那半已 CUT；hook 状态目录不在其内 |
| R05 `@spexcode/session-core` root/internal | **CUT**（同 L09） |
| R06 generated dist | **RETAINED**：活 dist 保留；`~/.spexcode/session-application.sqlite` 是一个 0 字节文件（2026-08-24），无任何 reader → **RESIDUE，归 M8** |
| R07 manifest global fallback | **CUT**：`dispatch.sh:54` 只读 `$slot/hooks-manifest`（per-tree），无 global 路径 |

### 2.3 依赖方向：M4 D-16 所预告的接入已经发生

M4 D-16 写"spec-cli 在 M4 不获得对协议栈的任何依赖……那是 M6"。head 上：`spec-cli/src/session-application.ts:10`
import `@spexcode/session-selflaunch`（`resolveDatabasePath` / `requireLocalDatabasePath`），`sessions.ts:19-20`
import `session-application`，`graphCache.ts:14` / `graphStream.ts:6` 同样解析同一个库路径。这是 M6 的接入，
方向正确，归属正确；记在这里是为了让 M4 台账里那句"那是 M6"有一个可指的落点。

### 2.4 一次性迁移（M7 的行）实际发生过两次，第二次改写了 marker

| 时间 | 事件 | 证据 |
|---|---|---|
| 2026-08-21 | 应用层切到 canonical SQLite | 提交 `d76c75407` |
| 2026-08-22 06:17 | 受控 live cutover 第一次尝试，**失败回滚** | `~/.spexcode/live-cutover-backup-20260822-061739/failed-attempt/…json-migration.json`：63 records |
| 2026-08-22 15:21 | 重试**成功** | `runs/final-20260822-081349-retry/success.json`：old/new `/health` sessionCount 73/73；migration 73 records / 59 parent edges / 60 watch edges / 74 events / orphanParents 1 |
| 2026-08-24 19:35 | 旧信封二次备份 | `legacy-envelope-backup-20260824-1935/` |
| 2026-09-02 22:14 | **marker 被改写**为 `records:1, events:1, sourceDigest:"old-importer"` | `~/.spexcode/sessions.sqlite.json-migration.json`（253 B） |

最后一行是一个要点名的事实：现在的 marker 不再记录 08-22 那次 73 条记录的迁移，只剩一次"残留吸收"的计数。
production-cutin spec 说残留吸收"runs the same migration entry point"，所以 marker 被同一入口覆盖是**实现使然**，
但它让 M7 的"equality proof"失去了原始锚点——原始数字只剩备份目录里的 `success.json` 一份。归 M7 处理，本账只记录。

顺带一条事实漂移：cut-in 计划写"v1 使用 rollback journal DELETE、禁用 WAL"，而 `packages/session-protocol/src/engine.ts:87`
是 `JOURNAL_MODE = 'wal'`，活库 `PRAGMA journal_mode` 也是 `wal`。协议 spec 是否已同步，本账未查，记为 lane J 的核对项。

## 3. self-launch 地址缝：M6 里真正剩下的施工是什么

把 self-launch 会话接进消息路径需要三段，每段今天的状态：

| 段 | 需要 | head 上的状态 | 决定 |
|---|---|---|---|
| 登记 | `SessionStart` → `protocol_sessions` 一行 | 机制在（`session-listen.sh` + `spex-session initialize`），但门是 env-only → 所有部署里从未发生（活库 0 行） | D-20 |
| 投递 | producer 能给裸地址入队 | `spex session send` 离线分支已能 `enqueueMessage`，但地址解析要 governed record；`sendText` 同样拒绝 | D-22 |
| 取件 | 接收方在自己的回合边界取 | governed CLI 无动词；adopter CLI 有 `dequeue` 但要 env + PATH | D-21 |

三个决定已在 §1 由人类做出并在同一天施工完毕（§3.1）。lane H 的正向 YATU 即 `scripts/self-launch-yatu.mjs`
（节点 [[self-launch-yatu]]）：**真实 `spex init` + `spex materialize` + 真实 `dispatch.sh`，无 store 时 SessionStart 什么都不建；
有 ready store 后同一事件登记出一个无 application 行的地址；plain shell 的 `spex session send <裸地址>` 在 backend 不可达
（端口由脚本自己刚关掉的 server 取得——fetch 的 bad-port 黑名单如 :9 会失败但**不带** ECONNREFUSED，M6 头一次跑就撞上）时
入队一条；未登记地址被拒且不被铸出；三种收信形状各按各的进程形态驱动；前后残留进程为 0，且探针先看见过本次的 canary。**
2026-09-12 实测 **26 / 26**。

### 3.1 施工结果（2026-09-12，同日落地）

| 件 | 位置 | 证据 |
|---|---|---|
| 包退役 | `packages/session-selflaunch/` 删除；path/locality 迁入 `packages/session-application/src/storage-*.ts` | `npm test --workspace=@spexcode/session-application` 40/40（含迁入的 path/locality 测试）；lockfile、CI、release 顺序、build 顺序、launcher 闭包、governedRoots、dependencyBoundary 全部去名，`check-init-plugins` 36/36 |
| `readAddress` | `packages/session-application/src/production.ts`（只读 `protocol_sessions` 一行，不建地址） | 被 `sendText`、CLI `send`、三个收信动词共用作"已登记"判据 |
| 登记 | `spex internal session-register`（`spec-cli/src/session-inbox.ts`）+ hook 两份拷贝 | hook-dispatch 40/40（新增 3 条：prompt 事件零调用、SessionStart 恰一次调用、CLI 失败 exit 2） |
| 三个动词 | `spex session dequeue` / `wait-dequeue` / `stream-dequeue`（`session-inbox.ts` + `cli.ts` + `help.ts`） | `session-inbox.cli.test.ts` 5/5：一次性恰取一条、空队列 null、未登记 exit 2；wait 先阻塞后随一条到达退 0、超时退 1 不消费；stream 三条三行、不自退、SIGTERM 退 0、全部消费；离线 send 到裸地址入队、未登记拒绝且不铸址 |
| 裸地址 producer | `sessions.ts` `sendText`；`cli.ts` `resolveSendTarget` | 同上第 5 条 + YATU |
| **顺手修的真缺陷** | `spec-cli/bin/spex.mjs` 启动器只镜像退出码、不转发信号：`kill <spex-pid>` 会把任何长跑动词的真实进程孤儿化（YATU 第一次跑到 stream 那一步就超时——被杀的是 launcher，`stream-dequeue` 还在读队列） | 现在转发 SIGINT/SIGTERM/SIGHUP 并按子进程方式退出；`launcher-midmerge.test.ts` 新增一条实测；节点 [[merge-tooling-resilience]] 正文补一段 |

**活部署上的产品级证明（落地后，main `e904c1f96`，backend 子进程 23:32:30 重载）**：用主检出的 `spex` 走真实 `dispatch.sh`
给一个 Claude 形状的原生 id 发 `SessionStart` → 活库出现地址、无 application 行；plain shell（无会话身份，默认 API 即活着的
`:8787`）`spex session send <id> …` → backend 侧 `sendText` 的裸地址分支回 `sent`；以该 id 为 `CLAUDE_CODE_SESSION_ID`
跑 `spex session dequeue --json` → 取到同一条。第一次用非 UUID 形状的 id 试时登记成功但 `send` 答 "no such session"——
落地版 `resolveSendTarget` 只对 UUID 形状查本地地址；随即放宽为"governed 解析落空后，任何**精确**登记过的地址都接受"
（原生 id 是各 harness 自己铸的形状），测试加了一个非 UUID 形状的用例。活库残留两个测试地址（见证据 `live-proof-2026-09-12.txt`）。

**一条对 09-02 提交的更正**：`0cc9813ad` 声称给 `spex session send` 加了"够不到 backend 时退到本地 enqueue"。本次量到：
仓库里没有任何测试走过那条分支；而且它依赖 `backendConnectionRefused` 在错误链里看到 `ECONNREFUSED`，我第一版测试用
`127.0.0.1:9` 得到的是 undici 的 `bad port` 错误，分支根本不进。分支本身是对的，但"已交付"在 09-12 之前没有测量支撑。

## 4. 门禁与结果（2026-09-12 实测）

### 4.1 证明脚本：两红一绿一未测

| 脚本 | worktree | main `d140cca18` | 归因 |
|---|---|---|---|
| `scripts/m4-self-launch-yatu.mjs` | **红**：8 ok → `SyntaxError: Unexpected end of JSON input`（:142） | **红**，同点 | 断言的是 D-17 的投递；`0cc9813ad`（09-02）删了投递却没改脚本。脚本最后一次实质修改 `b2b0c6df6`（08-20），此后仅 lint（`a6dba095e` 08-31）。**不在任何 spec 节点的 `code:`/`related:` 里，`scripts/` 不在 governedRoots**，所以 lint 看不见它 |
| `scripts/session-production-cutover-yatu.mjs` | **红 8/10**（连跑两次同样两条） | **红 8/10**，同两条：`multiple watchers receive one ordered stream`（期望 2 条 state.changed，得 `[]`）、`ordered batch delivery is FIFO and at-most-once` | 断言的是"状态转移直接给 watcher 入队"；owning spec `production-cutin-yatu` 现在写的是"backend 把 cursor 对账成队列消息后再 dequeue"。脚本最后修改 `53e225443`（08-22），语义此后变了。它是该节点的 `related:`，不是 `code:` |
| `spec-cli/src/session-production-cutover.yatu.test.ts`（`npm test` 会跑的那份） | **绿 1/1** | — | 最后修改 `3ecf24e09`（09-11），跟着契约走 |
| `spec-cli/src/hook-dispatch.test.ts` | **绿 30/30**（含 session-listen 两条） | — | — |
| `scripts/session-application-yatu.mjs` | **NOT-MEASURED**：`npm install` 五个打包 tarball 返回 status 254、stdout/stderr 皆空 | — | 未定位（可能是 `--silent` 吞掉的网络或沙箱错误）；不当作红，也不当作绿 |

两条红的共同形状与 M4 §4.3 那五条一样：**证明守的是一个已经过期的契约，而它过期之后没有任何门再跑它。**
D-23 由此而来。

### 4.2 静态与活部署门

| 门 | 结果 |
|---|---|
| `spex spec lint`（Node 22.21.0） | **0 error** / 54 warning（既有 coverage/drift） |
| 旧 queue/watcher/cursor/record 文件（573 个 session 目录） | **0 / 0 / 0 / 0** |
| `spec-cli/src` 对 `pending.json` / `watchers.json` / `cursors.json` / `.revoked-senders` / `session-core` 的非测试引用 | **0 / 0 / 0 / 0 / 0** |
| 活 backend 打开的库 | `~/.spexcode/sessions.sqlite` + `-wal` + `-shm`（fd 21/49/50） |
| 活库地址无 application 行 | **0**（618 / 618） |
| 活库 binding namespace | 仅 `spex-governed`（469 行；claude 21 / codex 213 / codex-headless 230 / opencode 3 / zcode 2） |
| schema 版本 | application 4 · events 2 · protocol 1 · runtime-bindings 1 · topology 1 |

### 4.3 本里程碑**没有**做的门

- **Sabotage 未做。** 路线图 M6 的负向证明（旧 queue 缺失/损坏、旧 timeline 投毒、cursor 缺失、旧关系冲突、锁目录只读、
  observer 关闭）一条都没在 head 上跑过。原先的 `spikes/legacy-sabotage/gate.sh` 随 `8fb1cfed4`（08-24）一起删除；
  M5 的 `scripts/zswarm-sabotage/` 是 ZSwarm 形状的，不覆盖 governed 路径。这是 lane I 的全部内容。
- **Delete 未按判据关闭。** 判据同 M4："被 governed 消费 **且** 已被新路径以同等行为替代"。§2 里 CUT 的行满足前半，
  但"已删除"的证明只有静态引用归零，没有 file-access trace；RESIDUE 三处（`.session-locks`、`host.ts:183`、
  0 字节 `session-application.sqlite`）有 caller 归属但未删。Delete 门在 lane I 的 trace 之后才能关。

## 5. Lane 分工（文件面互不重叠）

| Lane | 角色 | 独占文件面 | 明确禁止 | 门 |
|---|---|---|---|---|
| **G** | 证明修复 | `scripts/session-production-cutover-yatu.mjs`、`.spec/spexcode/session-runtime/self-launch-entry/self-launch-cutover/spec.md` 正文（只改被 D-19 推翻的 listener 描述，不改 M4 台账）。`m4-self-launch-yatu.mjs` **已退役**（2026-09-12，随包一起删；继任者 `self-launch-yatu.mjs` 有 owning 节点） | 不改产品代码；不改 hook 脚本 | rehearsal 脚本在 main 上绿且被节点 `code:`/`related:` 引用，或退役并记 commit |
| **H** | self-launch 地址缝 | （**已完成 2026-09-12**，见 §3.1）hook 两份拷贝、`session-inbox.ts`、`cli.ts`/`help.ts`、`sessions.ts` 的 `sendText` 裸地址分支、`session-application` 的 `readAddress` 与 storage 模块 | 未给协议加列；`sessions.ts` 只加了 `readRecord` 为空后的一个分支 | `self-launch-yatu.mjs` 26/26 · `session-inbox.cli.test.ts` 5/5 · hook-dispatch 40/40 |
| **I** | governed sabotage + trace | 新建 `scripts/governed-sabotage/**`（形状沿 `scripts/zswarm-sabotage/`：计数 + `openat` 标定） | 不修被审路径；不降低 expected | 路线图 M6 六条负向证明各一；`legacyFileSyscallHits=0` 且标定命中 ≥1；RESIDUE 三处的 caller 归属逐条 MEASURED |
| **J** | spec 正文对齐 | `docs/session-adopter-cutin-plan.md`（WAL 一句）、`.spec/spexcode/session-protocol/**` 的 journal 描述核对、production-cutin 节点里 marker 改写行为的说明 | 不改 M4/M5 台账 | `spex spec lint` 0 error；改动只到被 §2.4 点名的句子 |

集成方在合并后的树上独立复跑每一门，不采信 lane 自述——与 M4 相同。

## 6. 什么不属于 M6

- **M7 的 equality proof 与 marker 的历史保全**：§2.4 只记录，不修。
- **M8 的物理删除**：`.session-locks`、`host.ts:183`、0 字节 `session-application.sqlite`、`.delivery-locks` 的归类改名。
  本账给出 caller 归属；删除在 M8。
- **ZSwarm / z-code 侧的任何事**：§7 那条提前删除的行要不要补证，属 M5/M8 的 owner。
- **hook 状态目录（R04 hook 半）的去向**：哨兵写在 `<runtimeRoot>/sessions/<sid>` 是治理 hook 自己的状态，不是消息路径；
  不因 M6 而动。
- **让 self-launch 获得 governed record、board 行、parent 或 backend**：与 `session-runtime` spec 直接冲突，不做。

## 7. 仍然 OPEN，以及点名的事实问题

- **`@spexcode/session-core` 在 2026-08-24 被物理删除（`81c7e9f7e`）**，而 M5 台账 §1 写"在该 adopter 迁移之前删除
  `runtime-session.ts` 会打断一个活着的外部产品"，并把 M8 的拆除标为"被 M5 阻塞"。两者只能有一个是现状：
  要么 z-code 已接受 `m5/zswarm-protocol-cutover` 提案（M5 §4 说需要对方所有者同意），要么一个外部消费者的依赖已断。
  本账 **NOT-MEASURED(z-code 侧未查)**，只点名矛盾。
- **M4 台账在 head 上的四处过期**（不改正文，点名）：§2 D-17 与 §4.2 描述的 listener 投递已被 D-19 撤销；
  §1/§4.2 引用的 `sessions.ts:4262-4264` 现为 `:3620`；§6 末尾两条重复 bullet（已顺手删）；
  owning 节点 `self-launch-cutover` 正文同样描述投递（归 lane G）。
- **路线图本身已不在树里**：`docs/session-platform-construction-roadmap.html` 等六份于 `a15028b59`（09-03）删除。
  本账引用的 M6 定义、删除表和合并公式取自 `a15028b59^` 那一版；`adopter-cutin` 节点里"the milestones named by the
  architecture ledger"这句现在指向一个不存在的文件。要不要把里程碑定义重新落在某个 spec 节点里，是人的决定。
- **`session-application-yatu.mjs` 未测**（§4.1），原因未定位。

## 8. 里程碑状态：一个声音

**M6 未完成。** 但未完成的部分和开工前以为的不同：

| 步 | 状态 | 依据 |
|---|---|---|
| **Adopt** | 完成（生产上运行 3 周） | §2.1–2.3；`session-production-cutover.yatu.test.ts` 1/1；活库计数 |
| **Inventory** | 完成 | §2：G.1 十一行 + G.2 四行逐行判定，全部 source-backed 且有活部署证据；RESIDUE 三处点名 |
| **Sabotage** | **未做** | §4.3；归 lane I |
| **Delete** | **未按判据关闭** | 静态引用归零已量到，file-access trace 未做；归 lane I |
| **self-launch 地址缝** | **完成（2026-09-12）** | §1 D-20/21/22/24 已决并施工；§3.1；`self-launch-yatu.mjs` 26/26 |

两个在 main 上红着的证明脚本不是 M6 的施工，但它们是本账能否被信的前提，所以 lane G 排在最前。

## 9. 复盘：这一次学到的不变量

一个 hook 被 materialize 了、在 manifest 里、在板子上画着，和它真的跑过一次，是四件事。这次多了第五件：
**一个证明脚本存在、被台账引用、最后一次跑是绿的，和它今天还绿，也是四件事。** M4 的 YATU 红了 10 天，
production cutover 的 rehearsal 红了 3 周，两者都不在 `npm test`、不在 CI、不在任何 spec 节点的 `code:` 里。
D-23 把这条写成判据。它该住的地方是 `session-runtime` 节点（每个里程碑的证明脚本都归它管），不是本账。
