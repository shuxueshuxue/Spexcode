# Session platform 架构简化审查

本文只做减法审查，不改代码、不删设施、不动被审对象。审查基准是 campaign head `2099f5960`。范围是
`docs/session-platform-architecture.html`、`docs/session-management-refactor.html`、
`docs/session-platform-construction-roadmap.html`、`docs/session-architecture-concept-map.md`、
`docs/session-protocol-sqlite-engine.md`、`docs/session-adopter-cutin-plan.md`、
`docs/session-legacy-deletion-gate.md`、`docs/session-platform-m2-integration.md`，以及
`.spec/spexcode/session-protocol/**`、`.spec/spexcode/session-runtime/**` 与 `spikes/`。

每条发现必须钉在 `file:line` 上。没有证据的直觉不写进来。判定只有两种：**CROSS** 是判定冗余、给出最小删减建议；
**CHECK** 是看着像冗余、证明不能删。本文不执行任何一条建议——被审文档的所有权在各自 lane owner 手里。

最大的一类冗余不是重复的设计，而是**已经做完却仍被记成待做的账**。`a6f85d6f1` 与 `0eca88314` 两个提交
（均在 `2099f5960` 内）已经把三份 HTML 与 spec 节点同步到 v1 契约，但三份 lane 文档的待改清单和一条"已知缺陷"
都还按同步前的状态写着。下表的第 4、5 条是这一类。

## Fail-first：先证明什么不能删

减法审查的失败方式是把"看起来复杂"当成"可以删"。所以先给三个反例，它们都通过了"看着冗余"的第一眼，
但证据站在保留一侧。

**FF-1｜9 份版本化 self-test 证据目录，不能删。** `spikes/legacy-sabotage/` 下有
`self-test-evidence` 与 `self-test-evidence-v3` 到 `-v10` 共 9 个目录（`-v3` 到 `-v9` 合计 62,696 字节），
外加 27 个 `self-test-run-v*.{stdout,stderr,exit}` 文件。文档正文只点名一个：
`docs/session-legacy-deletion-gate.md:498` 的 canonical `self-test-evidence-v10/`。
第一眼结论是"留 canonical 那份，其余八份是迭代垃圾"。证据反对这个结论：`docs/session-legacy-deletion-gate.md:517-521`
给每一版都写了互不相同的诊断角色——v2 是 fixture 路径规范化 bug，v3 是缺可执行权限，v4 是污染了 dist 与 tarball
的非最小 mutation，v5 首次证明五个计数彼此独立，v6–v8 是被否决的常驻 fixture 路线（sabotage 必须留在
`mktemp -d` 之下），v9 恢复了这条安全边界，v10 才是最终参数化 self-test 的 canonical run。
并且 `docs/session-platform-m2-integration.md:70` 立的证据纪律第一条禁止原始失败证据被删或被重跑结果覆盖。
实测也不支持"后一份包含前一份"：`self-test-evidence-v9` 与 `-v10` 字节数同为 8,759，但 12 个文件逐个都不同。
**判定：不可删。** 它是一条 lane 的返工史，删掉就无法回答"为什么 sabotage 必须在 `mktemp -d` 之下"。

**FF-2｜`protocol_messages_pending_fifo` 是 `protocol_messages_history` 的严格子集，删掉会炸。**
`docs/session-protocol-sqlite-engine.md:330-335`：两个索引的键完全相同（`target_session_id, enqueue_seq`），
前者只多一个 `WHERE dequeued_at_ms IS NULL`。任何索引审查都会把它标成可合并的重复索引。
`:474-477` 的实测把这条路堵死：只留 pending 索引，`readMessages` 要 11.13 ms 且随全表增长；两个都留，
没跑过 `ANALYZE` 时 dequeue head 从 0.0064 ms 退化到 0.0448 ms，因为 planner 会改用全量索引。
出路不是删索引而是 `:487-499` 的 `INDEXED BY` 钉死，`:501-504` 有现成反例 `stubs/unpinned-indexes.mjs`
守着 vector `every declared index is the one the planner actually uses`。**判定：删任一侧都破坏语义**——
删 partial 索引打掉最热的协议操作（concept-map F06 `docs/session-architecture-concept-map.md:89` 也已判 KEEP），
删 `INDEXED BY` 把正确性重新挂回"有没有人跑过 `ANALYZE`"。

**FF-3｜`STRICT` + 内存校验 + DDL `CHECK` 三层看着是防御性仪式，中间层删掉会静默损坏地址。**
`docs/session-protocol-sqlite-engine.md:288-296` 的 DDL 同时有 `STRICT` 与成串 `CHECK`，而
`:365` 又要求"每个值在 bind 之前先在内存里做类型校验"。三层校验同一件事，是过度设计的标准形状。
`:355-363` 的实测反转了这个判断：把数字 `7` bind 进 `STRICT` 表的 `TEXT NOT NULL` 列**不会失败**，
column affinity 先把它转成字符串 `"7.0"`——一个被搅烂且不可恢复的协议地址。`STRICT` 只保护 INTEGER 方向，
不保护 TEXT 方向（`:363`）。所以内存校验不是 `STRICT` 的重复；`:366` 明写 DDL `CHECK` 的角色是防第二个直写者，
不是主闸门。`:368-372` 的反例 `stubs/unvalidated-session-id.mjs` 只要两处改动就能让三条 vector 同时触发。
**判定：删中间层会破坏语义**，而且是静默的那种。

## 逐条清单

| 判定 | 元素 | 证据 | 它解决的具体问题 | 为什么可保留/为什么是冗余 | 最小删减建议 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| CROSS | §9.1 中 `PROTOCOL_DATABASE_BUSY` 规则所附的 WAL 理由 | `docs/session-protocol-sqlite-engine.md:765-766` | 禁止把写竞争降级成空队列，让 busy 与"队列真的空"是两个可分状态 | 规则与 vector 都成立，冗余的只是理由：它写成"Readers are not blocked in WAL mode"，而 v1 禁用 WAL。同文档 `:259` 已给出 DELETE 时代的同一事实（"Read during an open write transaction: **allowed**"），所以结论不受影响，但论证挂在一个被禁模式上，且未按 `:26-30` 的两代规则标注为 WAL era | 把"in WAL mode"换成引 `:259` 的 DELETE 实测；规则文本与 vector 引用一字不动 | 低。结论不变，所以改写不能顺手删掉规则本身——`:766` 的 vector 仍要求 busy 与空队列可分 |
| CROSS | WAL 时代吞吐对照数字的第三份副本，且与另两份不一致 | `docs/session-protocol-sqlite-engine.md:830` 对 `:273` 与 `docs/session-platform-m2-integration.md:141-142` | 给 v1 的 1266 次/10s 一个历史参照 | `:273` 与 m2 `:141-142` 都是 3556 / p99 6.14 ms，`:830` 是 3611 / p99 6.99 ms。而 `:830` 明写 "see §4.5 for the comparison"——被指向的表里没有这两个数，`:269` 还声明该表是"same host, same vector, both eras"，所以两组数不能用"不同 vector"解释掉 | §10.2 删掉括号里的数字，只引 §4.5 | 中。3611 可能是另一次真实测量而非笔误，合并前必须回查 `spikes/sqlite-m2/evidence/`，不能择一保留 |
| CROSS | §5.6 正文重述本节表格的派生数字 | `docs/session-protocol-sqlite-engine.md:483-484` 对 `:474-475` | 用一句话概括索引取舍的代价 | 表格已给出全部数字并自带比值标注（`:475` "0.0448 ms ← 7× worse"），正文又存了一份且两处都不一致：`:484` 写 "degrades the hottest protocol operation **tenfold**"，而 0.0064→0.0448 是 7.0 倍；`:483` 写 history 读 11.6 ms，表格 `:474` 是 11.13 ms，且未按 `:26-30` 标注是否属 WAL era。派生值存两份，其中一份错 | 正文不再复述数字，改为指向本节表格；比值只在表格里出现一次 | 低。派生自同一张表，不需重测；但"tenfold"若是另一次测量的真值，应补测而不是就地改成 7× |
| CROSS | 三份 lane 文档的 HTML 待改清单，条目已在 HEAD 落地却仍记为待做 | `docs/session-platform-m2-integration.md:156-177`、`docs/session-adopter-cutin-plan.md:169-185`、`docs/session-legacy-deletion-gate.md:523-550` | 在不改冻结 HTML 的前提下留下待改账 | 两重冗余。一是互相重复：ROADMAP §4 同时出现在 `m2:174`、`gate:530`、`cutin:177`；ARCH §9 在 `m2:163` 与 `gate:542`；REFACTOR §7 在 `cutin:176` 与 `gate:545`。二是已经过期：`a6f85d6f1` 已执行其中多项——`m2:162` 要的 ARCH §8「3.38.0 及推导」见 `docs/session-platform-architecture.html:408-414`，`m2:166-167` 要的 `journal_mode` 只断言与网络 FS 反转见 `docs/session-management-refactor.html:233`、`:238-240`，`m2:177` 要的 M2 exit 改用 1266–1313 见 `docs/session-platform-construction-roadmap.html:302`。而 `m2:172` 要的 REFACTOR §9 六项在 `:511-527` 仍全部缺席。清单没有逐条状态，`m2:158-159` 只笼统说"其中数项已作废或反转" | 由集成账 §7 单独持有清单，逐条标注 landed commit 或删除已落地条目，只留经复核仍 open 的（如 REFACTOR §9）；两份 lane 文档保留自己的 delta 并指过去 | 中。必须逐条复核 HEAD 再删，不能整段清扫：部分条目只被执行了一半（REFACTOR §2 已同步，同页 §9 未同步），误删会丢掉剩余部分。清单所有权要跟着 HTML 的落地人走 |
| CROSS | m2 §6「已知文档缺陷」里的里程碑编号冲突条目 | `docs/session-platform-m2-integration.md:151-154` 对 `docs/session-management-refactor.html:460-476` | 记录 refactor §8 的 M0–M6 与 roadmap M0–M9 混读陷阱 | 该条目自己提的第二个修法（"或显式标注为「本页局部阶段编号，与施工路线 M0–M9 不对应」"）已由 `a6f85d6f1` 实现：`:460-463` 是同样措辞的红框警告并给出同一个 M4=M7 例子，`:463` 明确"调度、分工与门禁一律以施工路线的 M0–M9 为准"，`:464-476` 还多给了一张 8 行 crosswalk，`:477-478` 连 importer 先行的顺序修正一并写入。条目仍以"**未自行重编号。**"结尾，把已修状态写成当前真相 | §6 该条改为已解决并指向 `refactor:460-476`，或直接删除（§6 的定位是"保留为显式缺陷"） | 低。删前确认 `refactor:462` 的"crosswalk 是唯一权威对照"与 `docs/session-architecture-concept-map.md:189-191` 的编号权威不冲突——前者管映射，后者管台账编号，目前一致 |
| CROSS | concept-map F02、F07 两行的 WAL 表述 | `docs/session-architecture-concept-map.md:85`、`:90` | F02 给"用一个 SQLite 库做跨进程 authority"作理由；F07 裁定 SQLite 边车文件不由应用层解释或清理 | v1 固定 rollback journal `DELETE` 并禁用 WAL（`docs/session-platform-m2-integration.md:43-45`），`-wal`/`-shm` 在 v1 永不产生（`docs/session-protocol-sqlite-engine.md:263`、`:611`）。已同步的 ARCH 页 `docs/session-platform-architecture.html:425` 写的正是"v1 是 `DELETE` 模式，写事务期间出现 `-journal`；不产生 `-wal`/`-shm`"。F07 因此治着一个 v1 不存在的设施，F02 的理由指向被禁模式；`docs/session-platform-m2-integration.md:4` 说明本轮刻意未动 concept-map，故属残留 | F07 改名为 SQLite journal/边车文件，裁定不变、范围覆盖 `<db>-journal`；F02 理由里删去 WAL | 中。concept-map 是人类冻结的决策台账，只能由冻结持有人改；F07 的 KEEP 裁定要重新划范围，不是删行 |
| CROSS | refactor §9 验证矩阵与 §10 运维条目里的 WAL 时代内容，且无任何清单跟踪 | `docs/session-management-refactor.html:515`、`:517`、`:527`、`:534`、`:537` | 规定 crash/checkpoint 的验证面与人工检查、备份做法 | v1 不产生 `-wal`/`-shm`、没有 checkpoint，所以 `:515` 的"WAL/SHM 留存"、`:517` 整格"long reader、checkpoint starvation、WAL growth"、`:527` 的性能目标"WAL 不持续增长"验证的是不存在的机制；`:534`、`:537` 给的是 WAL 模式运维建议，v1 下正确的说法是写事务期间存在 `-journal` 时同样不能只复制主库。三份待改清单都没有列到这些行——`m2:172` 只要求给 §9 **增补**六项，没提删除 WAL 项 | §9 删掉 `:515` 的 WAL/SHM 子句与 `:517` 整格，`:527` 的 WAL 目标换成有界 `-journal` 生命周期；§10 两条改写为 DELETE 模式的等价约束 | 中。这是冻结检阅面，须由 ARCH/REFACTOR owner 改；删 `:517` 前确认 long reader 的场景另有归宿——DELETE 下"读事务挡住写"仍是真实约束（`docs/session-protocol-sqlite-engine.md:265`），不能连它一起删掉 |
| CROSS | adopter-cutin §5 表第 4 列里的删除里程碑 | `docs/session-adopter-cutin-plan.md:145-157` 对 `docs/session-architecture-concept-map.md:195`（列头）与 `:197-207` | 把每条 legacy 的最小 API 后果落到时间轴上 | concept-map G.1 第 5 列已被声明为"替代 authority 与删除里程碑"的台账，并在 `:189-191` 统一编号。cutin 表第 4 列（`:145` 列头「adapter 或删除后果」）把同一批 L01–L11 的里程碑再存一份，且不指回去 | cutin 第 4 列只留"最小 API 后果与 adapter 归属"，里程碑改引 G.1 | 中。cutin 那份带 per-adopter 作用域（谁的 reader 在哪个里程碑被切），G.1 不带。合并必须把这层作用域搬进 G.1，否则丢信息 |
| CROSS | M3 consumer-journal 裁决的第三份完整正文 | `docs/session-adopter-cutin-plan.md:81-94` 对 owning 契约 `docs/session-protocol-sqlite-engine.md:783-818` 与集成账 `docs/session-platform-m2-integration.md:57-64` | 防止 adopter 把自建 journal 说成协议级 at-least-once | 三处正文实质同构，连 vector 名与 stub 名都一样（`a handler that dies after dequeue never makes the message reappear`、`at-least-once-redelivery`）。契约由 `sqlite-engine` 节点治理，另两处是转述 | adopter 文档只留一句 adopter 侧后果加一个指向 §10.1 的指针，删掉重述的 vector/stub 细节 | 中。这段重复是刻意的防误读；缩写后指针必须显眼，否则退回"adopter 自己发明 at-least-once"的老坑 |
| CROSS | adopter-cutin 内部三处 storage locality 前提 | `docs/session-adopter-cutin-plan.md:64`、`:98`、`:129` | 保证两个 adopter 的 path resolver 都在 `openProtocol` 之前 fail closed | 同一前提在一份文档里整段说三遍（`:98` 还有专门小节 `#### Storage locality precondition`）。`:129` 已明写"它的 resolver 与 self-launch 相同"，随后仍整段重述；`:17` 另有一句关于 detector 仍是实现 OPEN 的说明，那句不重复 | 完整表述只留 `:98` 一处，`:64` 与 `:129` 各留一句引用 | 低。每个 adopter 段原本要能被独立阅读；缩写后必须保留"detector 缺失即拒绝"这句硬话 |
| CHECK | `sqlite-engine` spec 节点正文与被治理文档同构 | `.spec/spexcode/session-protocol/sqlite-engine/spec.md:28-129` 对 `docs/session-protocol-sqlite-engine.md` | 给 governed 文档一个 owning intent | 看着是把 900 行文档又写了一遍。实际上节点正文刻意不带任何数字、PRAGMA 值与 `file:line`，只留意图与边界；两者是意图层与契约层，不是两份契约。删掉会让 `code:` 无主并触发 lint 的 coverage 警告 | 不动 | 保留即无风险 |
| CHECK | L01–L11 在三份文档里各有一份台账 | `docs/session-architecture-concept-map.md:195-207`、`docs/session-adopter-cutin-plan.md:145-157`、`docs/session-legacy-deletion-gate.md:129` 起 | 分别记录清单与最后消费者、最小 API 后果、可执行删除证据 | 三份的列不重叠：G.1 记 last product consumer 与 shared-writer 答案，cutin 记协议调用与 adopter 表，gate 逐条记 sabotage 脚本与 trace 选择器。删任一份都会丢掉一整列事实 | 不动。唯一该删的是里程碑那一列，见上方对应 CROSS | 保留即无风险 |
| CHECK | 删除门禁的五个独立计数与五条前置条件行 | `docs/session-legacy-deletion-gate.md:464-468` | 判定 legacy 是否真的消失 | 五个计数看着是"同一件事测五遍"。实测 baseline 证明它们会分叉：`static_legacy_imports=94`、`legacy_dist_files=29`、`legacy_tarball_files=40`、`legacy_materialized_files=0`、`runtime_legacy_reads=2`。合并任意两个都会让 source=0 顶替其余三面，那正是 `docs/session-platform-m2-integration.md:65-66` 记录的 G.5 #11 缺陷 | 不动 | 保留即无风险 |
| CHECK | `spikes/sqlite-m2/evidence/` 与 `evidence/v1-delete/` 两代证据并存 | `docs/session-protocol-sqlite-engine.md:26-30`、`docs/session-platform-m2-integration.md:103-104` | 保留裁决所依据的 WAL 时代原件，同时给出 v1 现行值 | 看着是"旧的那套可以清了"。`:26-30` 说明 WAL 数字正是裁决依据；证据纪律第一条（`docs/session-platform-m2-integration.md:70`）禁止原始证据被覆盖；`counterexamples.txt`（被取代的 9/9）与 `counterexamples-gated.txt`（现行 10/10）是刻意配对，`fail-first-note.md` 说明哪份现行、哪份被取代 | 不动 | 保留即无风险 |

## 审查方法与它的边界

四个角度来自 `/simplify`：复用、简化、效率、层次。落到文档审查上分别是——同一事实是否存在第二份可写副本（复用）、
同一概念是否有两套编号或两层抽象（简化）、同一派生值是否被算了两遍（效率）、事实是否记在了正确的所有者那里（层次）。

被审材料的自我减法密度本来就很高：concept-map 的 F 表（`docs/session-architecture-concept-map.md:164-175`）
是八点最终减法测试，F08 与 F09（`:91-92`）已自行判 REMOVE；gate、cutin 与集成账都自带"只列不改"的缺陷清单。
所以本文的 10 条 CROSS 全部落在四类上：跨文档的第二份副本、同一派生值的第二份副本、已冻结决定的模式残留，
以及**已落地却仍记为待做的账**。没有一条主张删除设施或能力。

三类东西被明确排除在建议之外：任何生产代码、`spec-cli/src/sessions.ts` 与 `packages/session-core/**`；三份冻结检阅
HTML 与 concept-map 的正文；以及全部历史证据。上表凡涉及这些位置的条目，最小建议都写成"由 owner 改"，
本审查不动它们一个字节。

有一处被明确判为导航缺陷而非冗余，故不进上表：`docs/session-platform-m2-integration.md` 的章节顺序是
§4.1（`:77`）→ §4.3（`:106`）→ §4.2（`:121`），编号与出现次序不一致。它不产生第二份事实，改它属排版而非减法。

## Skill provenance

这次审查用了两把工具，来源都可复核。

**`/simplify`——磁盘上没有对应文件，随 CLI 编译进二进制。** Skill 工具报告的路径是 `bundled:simplify`，
不是文件系统路径；`~/.claude/skills` 与 `~/.claude-glm/skills` 两个目录下都没有 simplify 条目
（前者只有 `deslop` 与 `shuorenhua` 两条软链，后者只有 `shuorenhua`）。它来自装好的 CLI 包，这点可以直接验：

```
$ claude --version
2.1.236 (Claude Code)

$ grep -m1 '"version"' \
    ~/.nvm/versions/node/v22.21.0/lib/node_modules/@anthropic-ai/claude-code/package.json
  "version": "2.1.236",

$ grep -a -o -m2 "4 cleanup agents in parallel" \
    ~/.nvm/versions/node/v22.21.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe
4 cleanup agents in parallel
4 cleanup agents in parallel
```

命中两次是对的：该串在 skill 正文里出现两次，一次在首行摘要
（`/simplify → 4 cleanup agents in parallel → apply the fixes`），一次在 `## Phase 1` 的标题里。
`find` 在整个包树下找不到任何 `*simplify*` 文件，所以正文只存在于二进制内。

读到的与用到的不是一回事，这点必须写明。skill 正文要求并发起四个 review agent，再**直接应用修复**。
本会话的操作规则禁止未经请求调用 agent，任务本身也禁止改动被审对象。所以四个角度（复用、简化、效率、层次，
见上一节）是当透镜用的，由一个审查者逐份读，一条修复也没有应用。这个偏离是刻意的，不是没读到。

**shuorenhua v2.3.0——软链安装，跟随 upstream。**

```
$ ls -l ~/.claude-glm/skills/
lrwxrwxrwx 1 jeffry jeffry 23  8月 20 07:48 shuorenhua -> /home/jeffry/shuorenhua

$ git -C /home/jeffry/shuorenhua remote -v
origin	https://github.com/MrGeDiao/shuorenhua.git (fetch)
origin	https://github.com/MrGeDiao/shuorenhua.git (push)

$ git -C /home/jeffry/shuorenhua rev-parse HEAD
a9145e38875f116d65235a728cd0048b7c3d9003

$ git -C /home/jeffry/shuorenhua describe --tags --exact-match HEAD
v2.3.0

$ git -C /home/jeffry/shuorenhua rev-list --left-right --count HEAD...origin/main
0	0
```

HEAD 即 `origin/main`，落在 tag `v2.3.0` 上，commit 时间 `2026-08-14T12:23:18+08:00`，工作树干净。

**为什么走的不是推荐的方式 1。** `install/claude-code.md:6` 的方式 1 是
`/plugin marketplace add MrGeDiao/shuorenhua`——一条交互式 slash command，本会话无法以工具调用触发，
所以它**没有被执行过，也就没有它的失败输出可以贴**；这是能力边界，不是它报了错。
退到 `install/claude-code.md:41-45` 的方式 4「跟随更新」，即
`ln -s "$PWD/shuorenhua" ~/.claude/skills/shuorenhua`，正合该仓库 `AGENTS.md:22` 那条
「永远不要往 skills 目录拷贝文件」。两个配置目录下都建了这条软链；本会话经 `claude-glm` 启动，
`CLAUDE_CONFIG_DIR=$HOME/.claude-glm`，所以生效的是 `~/.claude-glm/skills/shuorenhua`。

**按其要求落到本文的哪几处。** 场景取 `docs`（`SKILL.md:76-82`：操作文档、技术说明、事故复盘，
默认档位 `minimal`）。无源引用按 `audit-only` 处理（`SKILL.md:113`、`:340`），所以本文没有一句
「研究表明」「数据显示」式的转述，每条结论都钉在 `file:line` 上。protected spans（`SKILL.md:40`、`:119-120`）
覆盖了本文绝大部分正文——数字、日期、版本号、commit sha、命令、路径、字段名、错误码、vector 名与 stub 名
一字不改，这正是上表能被逐条复核的前提。用户指定的七字段行格式**覆盖** skill 的默认输出契约，
而这条覆盖是 skill 自己给的：`SKILL.md:279` 写明用户当前要求与项目既有规则优先于它的默认规则。

## 第二轮：架构本体是否冗余

第一轮审的是文档，这一轮审文档所描述的架构。判定前缀改为 **ARCH-CROSS** / **ARCH-CHECK**，仍是七字段一行，
风险一栏里多带一句 `删后语义：`——删掉该元素之后哪条用户可观察语义会破坏，没有就写没有并给出证明。
本章同样不改产品代码与架构，只记录判定。

三个标签贯穿全章，不混用：**CURRENT** 指 `2099f5960` 上真的存在并跑得起来的代码；**PLANNED** 指已冻结但尚未实现的
契约文本；**SPIKE** 指 `spikes/` 下可执行、但不在产品路径上的证明。把 PLANNED 当成既成事实是这一轮最容易犯的错，
而第 1 区就是纯 PLANNED：`databasePath`、`stateRoot`、`artifactsRoot`、`materializedRoot` 在全部产品 `.ts` 源码里
各 0 次命中，所以"root 划分是否过细"目前无法在 CURRENT 上成立为冗余。

### 架构清单（八个审查区）

| 区 | CURRENT | PLANNED | SPIKE |
| --- | --- | --- | --- |
| 1 SQLite 与 root 划分 | 只有两个导出 root：`mainRoot`（`packages/spec-core/src/layout.ts:209`）与 `runtimeRoot`（`:237`），会话状态是 `runtimeRoot` 下的 per-session 目录（`:256`）。`configRoot` 的 5 次命中全是形参名与 spec 发现用的局部函数（`packages/spec-core/src/project-identity.ts:25`、`packages/spec-core/src/specs.ts:416`），不是存储 root | 每个 application state instance 一个 adopter 拥有的库，`databasePath` 为显式绝对路径，resolver 在 `openProtocol` 之前 fail closed（`docs/session-adopter-cutin-plan.md:98`、`.spec/spexcode/session-runtime/adopter-cutin/spec.md:21-24`） | 唯一一份实测 `databasePath` 在 `spikes/adopter-api/pass-self-launch.log` |
| 2 包边界 | 两个包：`spec-core` 持 layout 与 record schema，`session-core` 持 message、delivery-queue、cursors、record-lock 与 runtime bridge（`packages/session-core/src/index.ts:1-25`） | protocol 与 topology 是兄弟，runtime 是组合层（`.spec/spexcode/session-protocol/spec.md:96-114`、`.spec/spexcode/session-topology/spec.md:8-11`） | 三个 adopter contract 共用一份 `spikes/adopter-api/protocol.mjs` |
| 3 状态 | `session.json`（schema `packages/spec-core/src/layout.ts:263-280`）、`pending.json`（`packages/session-core/src/delivery-queue.ts:20`，空即删除 `:83-92`）、`cursors.json`、timeline 分段、`watchers.json`（两套实现，见 L04） | 一个库内的 message state；pending FIFO 是查询而非第二份投影；reader cursor 不持久化（`.spec/spexcode/session-protocol/spec.md:73-80`） | — |
| 4 topology 与 adopter metadata | 记录 schema 里没有 `project_id`；唯一 projectId 权威是 gateway 的路径派生路由（`spec-cli/src/gateway-hub.ts:14-17`）；父子关系有两种表示——`watchers.json` 边与 `runtimeSessionChildren` 的全量扫描（`packages/session-core/src/runtime-session.ts:382-389`） | topology 独立成兄弟包；`project_id` 是 Spex 拥有的 adopter metadata，不得扩进协议行（`.spec/spexcode/session-runtime/adopter-cutin/spec.md:19-21`、`.spec/spexcode/session-protocol/spec.md:75-76`） | — |
| 5 三个 adopter | 一个都不在产品路径上：runtime bridge 至今无 importer（`docs/session-legacy-deletion-gate.md:227`） | 三者共用同一协议表面，不为 adopter 加 id 或 callback（`.spec/spexcode/session-runtime/spec.md:49-50`） | self-launch 与 spex-governed 有可执行 contract；`spikes/adopter-api/zswarm-contract.mjs` 只有 8 行，断言一个文档标记后 `process.exit(77)`（`:7-8`） |
| 6 跨进程边界 | 三条唤醒路径：store `fs.watch`（`spec-cli/src/graphStream.ts:461-478`，1000 ms）、冷巡（`:1002-1016`，15000 ms）、投递巡（`spec-cli/src/sessions.ts:1777-1793`，2000 ms）。正确性权威是锁而不是进程（`:1779`） | 删掉 `fs.watch`，保留 DB revision 信号加有界巡查这一对（`docs/session-legacy-deletion-gate.md:399-405`） | — |
| 7 状态机 | 7 个存储 lifecycle（`packages/spec-core/src/layout.ts:285`）、14 个派生 `DisplayStatus`（`spec-cli/src/sessions.ts:72`）、4 个 `Liveness`（`:73`）、proposal 到 status 的映射（`:74`） | — | — |
| 8 gate 与 evidence | `spikes/legacy-sabotage/gate.sh` 277 行，承载 L01–L11、R 行与五个独立计数（`docs/session-legacy-deletion-gate.md:464-468`） | — | 9 份版本化 self-test 证据（见第一轮 FF-1） |

### 权威图：一个事实有几个写者

| 事实 | CURRENT 唯一权威 | 有第二个写者吗 |
| --- | --- | --- |
| 会话记录 | `session.json`，schema 在 `packages/spec-core/src/layout.ts:263-280` | 有。runtime bridge 自带一套 `readRaw`/`writeRaw`（`packages/session-core/src/runtime-session.ts:112-150`），并在同一次 publish 里既写 raw 又写 status（`:342-350`） |
| 记录互斥 | `.session-locks`（`packages/session-core/src/record-lock.ts:5`） | 没有第二个位置，但有两条几乎相同的取锁循环（`:16-36` 与 `:53-74`） |
| 消息债务 | `pending.json`（`packages/session-core/src/delivery-queue.ts:20`） | 没有 |
| 投递声明权 | `.delivery-locks/<id>.lock`（`packages/session-core/src/delivery-queue.ts:24-30`） | 没有 |
| 读取位置 | `cursors.json`（`packages/session-core/src/session-cursors.ts:18-33`） | 没有 |
| 通知目标集 | `watchers.json` | 有。`packages/session-core/src/runtime-session.ts:152-178` 与 `spec-cli/src/sessions.ts:473-535` 各一套（gate L04 已覆盖） |
| harness 身份命名空间 | `spec-cli/src/harness.ts:3222` 的注册表，用会抛的 `harnessById` 解析（`:3234-3238`） | 有。bridge 把 runtime owner 名写进 `harness`（`packages/session-core/src/runtime-session.ts:198`） |
| 项目路由 id | gateway 的路径派生 `projectId`（`spec-cli/src/gateway-hub.ts:14-17`） | 没有。记录 schema 里不存在该字段 |

### Fail-first：先证明什么不能删

**AFF-1｜两个锁家族看着该合并，合并会破坏跨进程的"恰好一次"。** `.session-locks`（`packages/session-core/src/record-lock.ts:5`）
与 `.delivery-locks`（`packages/session-core/src/delivery-queue.ts:25-31`）是两套锁根、两套获取路径，任何架构审查
第一眼都会问为什么不是一把锁。`:24-30` 的注释给出的不是偏好而是死锁事实：drain 必须把锁一直持有到 adapter insert
返回，而 native turn 会在那期间跑 lifecycle hook 重入记录写入者——记录锁跨不过那个调用，跨过去就死锁在 adapter
自己的确认上。PLANNED 也没有合并它们：`docs/session-legacy-deletion-gate.md:381-397` 把 `.session-locks` 拆成四道
具名 fence，并明写它们"不是 `.session-locks` 的别名"。**判定：不可合并。删后语义：两个进程会同时把同一条消息交给
worker，"消息只被送达一次"这条用户可见语义直接破坏。**

**AFF-2｜`cursors.json` 与 `pending.json` 看着是同一个计数器的两份副本，合并有回归记录在案。** 两者都以会话为键、
都记"还有什么没处理"。`packages/session-core/src/session-cursors.ts:6-11` 把合并的后果写成了历史：把两者绑到一个
计数器，会让会话自己的状态行被当成邮件消费掉，并且把"还有没有未办事项"变成对全部历史的扫描。`:65-74` 另记一条：
timeline observer 已被删除，因为游离的 `spex serve` `fs.watch` 进程会在约 200 ms 内把一次状态迁移重复记成最多 6 行，
而 `at[i]` 正是"取一条并等待"能精确推进到 `at[i]+1` 的依据。`pending.json` 的静息态是文件不存在（`packages/session-core/src/delivery-queue.ts:83-92`），
cursor 的静息态是一个单调数——两者连表示法都不同构。**判定：不可合并。删后语义：`spex session take` 类的取一条并等待
会重复取到同一条，或把自己的状态行当成收到的消息，用户看到的是"我没发的消息"。**

**AFF-3｜真正可合并的架构边界：整个 runtime bridge。** `packages/session-core/src/runtime-session.ts` 389 行，
自称临时混合桥，重新实现了记录 IO（`:112-150`）、`watchers.json` 读写（`:152-178`）、pending 投影（`:270-278`）
与一条自带三个幂等键的发布路径（`:301-375`）。它不是"看着重复"，它就是重复，而且是可以立刻收掉的那种：
产品侧至今没有任何 importer（`docs/session-legacy-deletion-gate.md:227`），spec 已排定第 4 步删除它
（`.spec/spexcode/session-runtime/spec.md:61-62`），第 1 步还禁止留兼容再导出、别名、双读或回退。
**判定：可合并，且此 head 上合并成本为零。删后语义：没有一条破坏——没有产品调用者，也没有 API 路由经过它。**
这条 fail-first 的作用是划出对照线：AFF-1 与 AFF-2 的重复各自扛着一条跨进程或恢复语义，这一条什么都不扛。

### 逐条清单（架构层）

| 判定 | 元素 | 证据 | 它解决的具体问题 | 为什么可保留/为什么是冗余 | 最小删减建议 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| ARCH-CROSS | `RawRecord` 里四个 `runtime_*` 字段 | `packages/spec-core/src/layout.ts:277-280`，写读方唯一是 `packages/session-core/src/runtime-session.ts:198-211`；gate L09 选择器只点模块与三个函数名（`docs/session-legacy-deletion-gate.md:232`） | 给一个外部 runtime owner 在共享记录 schema 里留位置 | 是 bridge 的私有字段长在了公共 schema 上。L09 通过之后这四个字段会留在 `spec-core` 里成为无主列——选择器不覆盖 schema 字段。同一条 L09 还把实现范围写成 `runtime-session.ts:1-239`（`:227`），而该文件现有 389 行，`publishRuntimeSessionState`（`:301-375`）与 `runtimeSessionChildren`（`:382-389`）都在这个范围之外 | 把这四个字段名补进 L09 的删除选择器，让它们随模块一起消失；同时把实现范围更正为整文件 | 低。必须与模块同批删，不能先删字段——bridge 还在写它们。删后语义：没有一条破坏，产品侧无读者（`:227`），也没有 API 路由 |
| ARCH-CROSS | bridge 把 runtime owner 名写进 `harness` 与 `harness_session_id` | `packages/session-core/src/runtime-session.ts:198-199` 与同次写入的 `:208` `runtime_owner` | 让 runtime session 复用现成的 harness 别名查找路径 | 同一事实存两遍，而借用的那个命名空间不是中性的：board 投影用会抛的 `harnessById(rec.harness \|\| defaultHarness.id)` 解析（`spec-cli/src/sessions.ts:1201-1202`、`spec-cli/src/harness.ts:3234-3238`），注册表里没有任何 runtime owner（`:3222`）。别名扫描对这类记录本来也到不了——`packages/spec-core/src/layout.ts:454` 的 store-dir 短路先返回，`:455-457` 的 `harness_session_id` 扫描不会执行。所以这份副本既是重复，又只在借来的命名空间里有效 | bridge 只写 `runtime_owner`，`harness` 留空；按计划整体随模块删除 | 中。今天不可达仅因为没有任何东西注册 runtime session，这是潜在缺陷而非现行 bug，必须照此陈述。删后语义：现在没有一条破坏；反过来说，一旦真有 runtime session 注册，board 会抛而不是降级显示 |
| ARCH-CROSS | 一次 publish 携带三个幂等键 | `packages/session-core/src/runtime-session.ts:240-245`（`snapshotPending`）、`:315-318`（`runtime_revision`）、`:329-338`（receipt `payloadHash`） | 让重复 publish 不产生重复投递 | 一个操作三个键、三种作用域，彼此不互相校验。投递侧本来就有权威：锁（`packages/session-core/src/delivery-queue.ts:24-30`）加 drain 里 receipt 与队列的逐字节交叉校验（`:173-176`）。三键之中只有 receipt 那一层被真正校验过 | 随 bridge 一并删除；若短期必须保留 bridge，只留 receipt 这一层 | 低。不要单独摘掉 `runtime_revision`——`snapshotPending` 还在守父 watch 的写入。删后语义：没有一条破坏，无产品调用者 |
| ARCH-CROSS | 父子关系的第二种表示：`runtimeSessionChildren` 全量扫描 | `packages/session-core/src/runtime-session.ts:382-389`（经 `packages/spec-core/src/layout.ts:465-469` 列全部会话再逐个读记录），对同一模块 `:240-245` 写下的父 watch 边 | 回答"这个父会话有哪些子会话" | 关系已经以边的形式写下来了，这里又用一次 O(N) 记录扫描把它算第二遍。PLANNED 把这层关系整体移进 topology 兄弟包（`.spec/spexcode/session-topology/spec.md:8-11`），那里父子是被持有的关系而不是被扫描出来的 | 随 bridge 一并删除；不要在 bridge 内部改成索引，那是把生命有限的模块做厚 | 低。删后语义：没有一条破坏，无产品调用者 |
| ARCH-CROSS | `record-lock.ts` 两条几乎相同的取锁循环 | `packages/session-core/src/record-lock.ts:16-36` 与 `:53-74`，差别只有等待方式（`syncPause(10)` 在 `:33`，`await pause(signal)` 在 `:71`） | 同一把锁要同时服务同步与异步调用者 | 循环体重复一份，而 PLANNED 会把 `.session-locks` 拆成四道具名 fence（`docs/session-legacy-deletion-gate.md:383-397`），届时活下来的那个形状会被复制四次。这是唯一一条现在改比拆分后改便宜的条目 | 抽出一个接受等待回调的循环体，两个入口都调它 | 低。同步入口必须保留——同步调用者无法 await，要删的是循环体的第二份而不是那个表面。删后语义：没有一条破坏，行为不变 |
| ARCH-CROSS | `pendingFor` 与 `keyedPending` 两份同义投影 | `packages/session-core/src/runtime-session.ts:270-278` 对 `packages/session-core/src/message.ts:24-30`，同一个包 | 从 pending 队列里筛出带 key 的消息 | 同包内两份同形投影。这个投影正是 drain 逐字节交叉校验的输入之一（`packages/session-core/src/delivery-queue.ts:173-176`），两份就是两个可以各自漂移的入口 | bridge 改调 `keyedPending`；或随 bridge 整体删除 | 低。删后语义：没有一条破坏 |
| ARCH-CROSS | `spec-cli/src/session-timeline.ts:4` 的通配再导出 | `export * from '@spexcode/session-core'`，而 `packages/session-core/src/index.ts:3-14` 正是 bridge 的导出块 | 让 CLI 侧一次拿到 session-core 的全部表面 | 一个以 timeline 命名的模块把 bridge 符号一起再导出去，于是"谁 import 了 bridge"这个问题没法靠搜 bridge 的名字回答——而 `docs/session-legacy-deletion-gate.md:227` 回答的正是这个问题。gate R05（`:305-315`）已经点名此处 | 按名字显式导入，删掉通配 | 低，机械改动。删后语义：没有一条破坏 |
| ARCH-CROSS | ZSwarm 的 fail-first 与 pass 两份日志逐字节相同 | `spikes/adopter-api/fail-first-zswarm.log` 与 `spikes/adopter-api/pass-zswarm.log` 内容同为一行 `no executable proof available at this base: repository has no production ZSwarm importer`（`cmp` 相同），`spikes/adopter-api/zswarm-contract.mjs:8` 的 `process.exit(77)` 磁盘上没有任何 `.exit` 记录 | 记录 ZSwarm 在此 base 上无可执行证明 | 状态本身该留（见下一条 ARCH-CHECK），冗余的是这对文件：一对不能区分的 fail/pass 提供零信息量，而 `pass-` 前缀又把 NOT MEASURED 写成看起来像 GATED。对照 `spikes/adopter-api/pass-self-launch.log` 里是真实结果 JSON | 补一个记录退出码 77 的 sidecar，让三态从文件层面可读；不要改名也不要重写这两份日志——`docs/session-platform-m2-integration.md:70` 的证据纪律禁止改动原始证据 | 低。修法必须是增量的：重命名会动到历史证据，正是纪律禁止的那类操作。删后语义：删掉这两份文件会让 NOT MEASURED 退化成"没跑过"，与 GATED/UNGATED 不可分 |
| ARCH-CHECK | `spikes/adopter-api/zswarm-contract.mjs` 这个 8 行 contract | `:4-6` 断言 concept-map 里的证据标记，`:7-8` 写出无证明并以 77 退出 | 把"此 base 上无可执行 ZSwarm 证明"变成一个会跑的断言 | 看着是三个 adopter contract 里唯一的空壳，删掉最省。它守的是标记还在这件事：`.spec/spexcode/session-runtime/adopter-cutin/spec.md:16-17` 明写 ZSwarm 在此 base 上没有可执行 adopter proof，这个脚本让该结论随文档一起被检验 | 不动 | 保留即无风险。删后语义：三态里的 NOT MEASURED 失去执行面，"ZSwarm 已验证"这类误读不再有东西挡 |
| ARCH-CHECK | `project_id` 与全局 session id 并未被双重建模 | `packages/spec-core/src/layout.ts:263-280` 里没有 `project_id`；唯一 projectId 权威是 gateway 的路径派生路由（`spec-cli/src/gateway-hub.ts:14-17`、`:55`）；PLANNED 把 `project_id` 定为 Spex 拥有的 adopter metadata（`.spec/spexcode/session-runtime/adopter-cutin/spec.md:19-21`） | 分别解决 HTTP 路由归属与 adopter 侧的项目归属 | 第 4 区的怀疑在 CURRENT 上不成立：记录里根本没有这个字段，所以"记录、gateway、adopter metadata 三处重复"是没有的。前向风险要记一句——PLANNED 落地时不能把 gateway 的路由 id 与 adopter metadata 悄悄做成同一列，`.spec/spexcode/session-protocol/spec.md:75-76` 明禁用产品字段扩展协议行 | 不动 | 保留即无风险 |
| ARCH-CHECK | 7 个存储 lifecycle 之外还有 14 个 `DisplayStatus` 与 4 个 `Liveness` | `packages/spec-core/src/layout.ts:285`、`spec-cli/src/sessions.ts:72`、`:73`、`:74` | 存储层记会话自己声明的状态，展示层记用户看到的状态 | 看着是三套状态机并存。实际只有一处存储加一层派生投影：`offline`/`starting`/`unknown` 纯由 liveness 派生，`review`/`done`/`close-pending` 由 proposal 经 `PROPOSAL_STATUS` 映射（`:74`）。没有第二处写入。删掉投影层只会把 liveness 与 proposal 挤回 lifecycle 枚举里，那才是真正的双写 | 不动 | 保留即无风险。删后语义：board 无法区分"进程没了"与"会话自己声明 idle"，用户看到的在线状态与真实进程脱钩 |
| ARCH-CHECK | 三条唤醒路径并存 | `spec-cli/src/graphStream.ts:461-478`（1000 ms `fs.watch`）、`:1002-1016`（15000 ms 冷巡）、`spec-cli/src/sessions.ts:1777-1793`（2000 ms 投递巡） | 分别求低延迟、跨进程收敛、对离线或重启中的 worker 重投 | 看着是同一个"轮询 store"抄了三遍。三者答的问题不同，且都不是正确性权威——`spec-cli/src/sessions.ts:1779` 明写"是队列的锁而不是进程，让交接恰好一次"。PLANNED 也只删 `fs.watch` 这一条，保留信号加巡查这一对（`docs/session-legacy-deletion-gate.md:399-405`） | 不动。唯一该删的是 `fs.watch`，已在 gate L08 | 保留即无风险。删后语义：删冷巡则一次未被观察到的 store 变更不再收敛，dashboard 停在旧图；删投递巡则消息一直挂在 `pending.json` 直到该会话下次有人碰它 |
| ARCH-CHECK | legacy deletion gate、sabotage vectors 与现行 lint 门禁职责不重叠 | `spikes/legacy-sabotage/gate.sh` 277 行与 `docs/session-legacy-deletion-gate.md:464-468` 的五个计数，对 `spex spec lint` 的图完整性检查 | 一个判"legacy 是否真的消失"，一个判"spec 与代码的图是否自洽" | 第 8 区的怀疑在这一层不成立：两者问的不是同一个问题，也不读同一批事实。真正的重叠只有一处，第一轮已判为 CROSS——三份 HTML 待改清单互相重复。gate 这一侧唯一的缺口是覆盖不全而不是重复，见本表第一条 | 不动 | 保留即无风险 |

### 本章的边界

本章没有一条建议动产品代码。全部 ARCH-CROSS 的最小建议落在三类上：把已排定删除的 bridge 按 spec 既定顺序删掉
（`.spec/spexcode/session-runtime/spec.md:52-62`）、把 gate 选择器的覆盖补齐、给一份证据加增量 sidecar。
`packages/session-core/**` 与 `spec-cli/src/sessions.ts` 依旧只被读取和引用。

两处刻意没有列入。一是 `watchers.json` 的两套实现——它是真重复，但 gate L04（`docs/session-legacy-deletion-gate.md:164-175`）
已经点名两侧，本章再列一遍就是本章自己在做的那件事的反面。二是第 1 区与第 2 区的 root 与包划分：PLANNED 的
`stateRoot`/`artifactsRoot`/`materializedRoot`/`databasePath` 在 CURRENT 产品源里各 0 次命中，`.spec/spexcode/session-topology`
也还只是一个没有实现的节点，所以"划分是否过细"此刻无法用 `file:line` 证明——按本文的收录标准，它不进表。
