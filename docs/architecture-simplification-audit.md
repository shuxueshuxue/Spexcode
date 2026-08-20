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
