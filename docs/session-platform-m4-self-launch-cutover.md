# Session platform M4 self-launch cutover 账

本文是路线图 **M4（self-launch adopter cutover）** 的施工与门禁台账。基线严格为 **43f3db680**（M1 集成头）。
它不重开任何冻结决定，也不扩到 M5/M6。

M4 的最小闭环是固定的四步：**Adopt → Inventory → Sabotage → Delete**。本文先把第四步的靶子诚实地钉住，
因为这一步在本基线上**不是想当然成立的**。

## 1. 开工前必须说清的一件事：M4 的 Delete 靶子很小，而且部分为空

路线图 M4 的删除条款写的是"删除 self-launch 对旧 queue、固定 Spex root 和 governed record 的所有依赖"。
按基线实测，这三项里**只有一项在 self-launch 路径上真实存在**：

- **旧 queue（G.1 L01）与 governed record（L05）：self-launch 今天根本没有消息路径**，所以没有依赖可删。
  证据：`spec-cli/src/sessions.ts:4262-4264` 的 `sendText` 在 `readRecord(id)` 为空时直接抛
  `no session record for <id> — prompt NOT delivered`。self-launched 会话没有记录，因此**收不到任何消息**，
  也就从来没有用过 `pending.json` / `.delivery-locks` / timeline send authority / cursor。
- **固定 Spex root（G.2 R04）：存在**。materialized hook 一律经 `spec-cli/hooks/harness.sh:115-120` 的
  `hp_runtime_dir` 从 git-common-dir 推出 `${SPEXCODE_HOME:-$HOME/.spexcode}/projects/<enc>`，
  self-launched 会话也在那里拿到 store dir（`spec-first` 的 sentinel 就住在那儿）。

所以 M4 在本基线上的诚实形状是：**Adopt 是新增能力（替代的是"什么都没有"），Sabotage 是真门，
Delete 的靶子由 Inventory 决定且很可能只有一条。** 这不是把标准放低，而是不允许把"从来没有过的依赖"
记成"已经删除的依赖"——那会让 M8 的最终审计拿到一份假账。凡是本基线上没有 self-launch consumer 的删除行，
M4 **不得**声称已证明；它们留给真正持有该 consumer 的里程碑（M6 Spex governed cutover）。

## 2. 收口的决定

**D-15 listener 用既有的 hook plugin 机制交付，不新建第二套投递系统。** 本产品的每一个 materialized hook 都是
一个 `surface: hook` 的 spec 节点加一个同目录 `.sh`（`spec-cli/src/hooks.ts:14-24` 把它们编译成 per-tree manifest，
`spec-cli/hooks/dispatch.sh` 读它）。self-launch listener 就是这样一个节点，因此它自动获得 harness 发现、
per-tree 隔离与确定性顺序。新建一条投递路径只会多一个权威。

**D-16 spec-cli 在 M4 不获得对协议栈的任何依赖。** 让 `spec-cli` import `@spexcode/session-protocol` 或
`@spexcode/session-selflaunch` 就是 Spex governed 的接入，那是 M6。listener 脚本在**运行时**解析 adopter CLI：
显式 `$SPEX_SESSION_CLI` → `PATH` 上的 `spex-session`。解析不到且**该项目确实配置了协议数据库**时，
大声报错并给出修复入口；**该项目根本没配置**时静默 exit 0。后者不是 fallback（没有第二条路径被尝试），
而是"这个项目没有要这个能力"。

**D-17 listener 不是 daemon，也不是 observer。** 它在 harness 自己的事件上跑一次、查一次库、把 dequeue 到的
消息交给 harness 的输入缝，然后退出。没有轮询、没有常驻、没有 wake correctness、没有重试循环。
丢失全部 wake hint 不改变任何结果——消息在库里等着，下一次事件或用户显式 `spex-session dequeue` 时被取走。

**D-18 producer 在 M4 是 `spex-session enqueue`，不是 `spex session send`。** 让 Spex 的 CLI 能给一个无记录会话
投递，等于把新路径接进 governed 产品面，那是 M6。M4 的 producer 是 M1 就已交付的 adopter CLI。

## 3. Lane 分工（文件面互不重叠）

| Lane | 角色 | 独占文件面 | 明确禁止 |
|---|---|---|---|
| **D** | writer：materialized listener | `.spec/spexcode/.plugins/core/session-listen/**`、`spec-cli/templates/spec/project/.plugins/core/session-listen/**`、`packages/session-selflaunch/**` | 不改 `spec-cli/src/**`、不改 `packages/session-protocol|topology/**`、不碰 legacy |
| **E** | auditor：self-launch legacy inventory | `docs/session-platform-m4-inventory.md` 与其 owning 节点 | 只读产品代码，一行都不改；不替 writer 声称删除 |
| **F** | adversary：sabotage + file-access trace | `spikes/self-launch-sabotage/**` | 不在被审分支修复；不降低 expected |

## 4. 门禁与结果

每一门都由集成方在**合并后的树**上独立执行，不采信 lane 自述。

### 4.1 三条 lane

| 门 | Lane D（listener） | Lane E（inventory） | Lane F（sabotage+trace） |
|---|---|---|---|
| ancestor / 窄 diff / 禁止路径 | PASS | PASS | PASS |
| 独立复跑 | selflaunch 26/26；我另跑三条自设对抗 | 关键判定逐条复核 | 七条攻击 + 五计数 + 我自设的祖先归属 |
| 结果 | 合并 `dd228c4eb` | 合并 `0ffe2dc6e` | 合并 `2ef85b875` |

### 4.2 最终合并树（M4 head）

| 门 | 结果 |
|---|---|
| session-protocol / topology / selflaunch（Node 22.21.0） | **66 / 15 / 26**，全过 |
| `npm run build` · `sync-init-plugins --check` | PASS · 31 个生成文件全等 |
| `spex spec lint` · `spex eval lint --changed` | **0 error** · **0 flagged** |
| M1 跨层 conformance（回归） | **48 / 48** 仍全过 |
| **M4 synced YATU**（`scripts/m4-self-launch-yatu.mjs`） | **11 / 11** |
| lane F sabotage gate run-7 | A1/A2/A4/A5/A6/A7 PASS，A3 NO-CONSUMER；五计数全 0 且前置全 MEASURED |

M4 synced YATU 走的是自启动用户真正拿到的那条路：真实 `spex init --harness claude` + 真实 `spex materialize`
+ 真实 `dispatch.sh`，adopter 从打包 tarball 装进仓库外的 clean consumer。两条断言是刻意加的：
**listener 被绑进一个全新项目拿到的 manifest**（到达新 adopter 的是模板那一份，别处证不了它到货），
以及 **produce 与 consume 之间零常驻进程**（否则这次交付可能是在给一个没人声明的 daemon 记功）。

### 4.3 审查退回的五条

| # | Lane | 缺陷 | 形状 |
|---|---|---|---|
| F-D1 | D | `perl` 不可用时消息被 at-most-once 消费后渲染成空 additionalContext 并 exit 0 | 交付能力在**消费之后**才验证 |
| F-D2 | D | `$(base64 --decode)` 静默丢 NUL 与尾随换行（实测 `61 00 62 0a 0a` → `61 62`） | 在消息已被消费之后撤销 D-8 |
| F-D3 | D | `head -c -2` 的负数 `-c` 是 GNU 扩展，BSD/macOS 不支持；失败时前缀已输出、收尾照打、退出码 0 | preflight 验的是**二进制存在**，不是**所需能力** |
| F-C1 | C（M1 遗留） | locality resolver 在 ENOENT 时正常返回 | 在没建立前提的情况下断言前提已建立 |
| run-6 | F | `-e trace=%file -e trace=%process` 后者顶掉前者，tracer 对文件调用全瞎，而 calibration 匹配的是 `execve` argv 里的路径 | **calibration 本身是代理**，能在瞎的时候通过 |

五条是同一族：**守卫检查的是一个便利的代理，而不是它宣称守护的那件事本身。** 最后一条最贵，因为它是
"门之门"——lane F 把 run-6 与它的读数一并保留为 NOT-MEASURED 并 retract，而不是悄悄替换；
报告里写明 run-5 只有 file 类、run-6 只有 process 类，**run-7 之前没有任何一次同时具备两类**。

### 4.4 集成方自己的更正

我在退回 run-6 时说"我用了比你的 gate 更严的完整祖先链"——**那句话是错的，已收回**：run-5 的 trace 是
`%file` only，没有 `clone/vfork` 行，我的祖先回溯对每个 pid 都退化成它自己，与单 PID 口径测的是同一件事。
结论对它实际测到的东西仍成立，但方法不是我描述的那样。我犯的是和 run-6 同一形状的错：
**没有先验证我依赖的那类记录确实在日志里**。run-7 上我用两类记录齐全的 trace 重做了归属：
`clone-edges=49/90/6`、listener PID 可见、live-shape `0/3/0`、**from-listener-subtree 全部为 0**；
calibration 里是一次真正的 `openat` 打开 poison 的 `pending.json`，不是 argv 提及。

## 5. 里程碑状态：一个声音

**M4 完成。** 四步闭环逐条如下，其中 Delete 一步按 owning roadmap 的判据关闭——
**每一个实测到的目标都必须被删除；实测目标集为空时，用可证伪的 inventory 加 file-access trace 关闭这道门。**

| 步 | 状态 | 依据 |
|---|---|---|
| **Adopt** | 完成 | synced YATU 11/11：真实 init/materialize/dispatch.sh，adopter 从 tarball 装进仓库外 consumer，无 backend、无 governed record、零常驻进程 |
| **Inventory** | 完成 | 20 行 G.1/G.2 逐行判定，**5 CONSUMER / 15 NO-CONSUMER / 0 NOT-MEASURED**，全部 source-backed |
| **Sabotage** | 完成 | run-7 七条攻击：A1/A2/A4/A5/A6/A7 PASS、A3 NO-CONSUMER；五计数全 0 且前置全 MEASURED；calibration 要求真实文件调用行 |
| **Delete** | **完成（实测目标集为空）** | 判据两个条件同时成立：被 self-launch 消费 **且** 已被 M4 新路径以同等行为替代——本基线上**没有任何一行满足**。零删除是**测量结果**，由静态引用归零与按祖先归属的 file-access trace 归零证伪 |

**目标集为什么是空的，以及为什么这不是跳过**：被消费的五行（L05/R04/R05/R06/R07）M4 一行都没替代——
它们承载的是 materialized hook 自己的状态（`spec-first.sh:39` / `spec-of-file.sh:55` 在
`<runtimeRoot>/sessions/<sid>` 下写 sentinel）与 R07 的 per-tree manifest，两者都在 deny-list 的保留项上；
没被消费的十五行本来就没有可删的东西。**未被本 milestone 替代的 consumer 必须点名归属，不得顺手删除**：

| 行 | 归属 milestone | 理由 |
|---|---|---|
| L05 legacy session-directory 形状 | **M6**（governed cutover）→ residue **M8** | 其 consumer 是 governed record 与保留的治理 hook，不是消息路径 |
| R04 config/root placement | **M6/M8** | 协议的 placement 假设随真正的 governed adopter 一起切 |
| R05 旧 package root/internal 导出 | **M6** cut → **M8** 残留 | consumer 是 `spec-cli` 自身的 import |
| R06 generated `dist` | **M8** | 活的 dist 保留，过期编译物随最终拆除 |
| R07 materialized manifest（含 global fallback） | 保留；global fallback **M8** | materialization 是 deny-list 明确保留项 |

**`runtime_live_legacy_shape_reads=15` 原样保留**，作为 M4 **按设计不触碰**的那部分的实测大小，
作案者是 `mark-active` / `stop-gate` 的 `governed` no-op 闸门与 R07 manifest。数字留着、原因写清、归属点名。

**一条刻意保留的限定**（lane F 原话）：old message-state 归零属于 **scoped confirmation**——
那条路径是有意不存在的，无法从消费侧做出一个可失败的变更。它支撑"目标集为空"这一测量，
但它本身不是一道能失败的门；能失败的门是静态引用与 trace 的归零，以及 calibration 对 tracer 未瞎的证明。

## 6. 仍然 OPEN（不属于 M4 的范围）

- **M5/M6/M7/M8 未被本里程碑推进一步**：ZSwarm 仍无可执行证明；governed cutover、一次性导入与最终拆除
  各自持有自己的 consumer 与门禁。
- **locality 的两个洞不变**（M1 遗留）：网络 FS 魔数从未在真实挂载上执行；macOS/Windows 无 detector，
  缺失即拒绝，唯一越过方式是显式 `--assume-local-storage` 旗标。
- **listener 的交付面限于 UTF-8 文本 body**：非文本 body 被大声拒绝并打出 `messageId` 与原始 `bodyBase64`
  供人工恢复。这是刻意的边界，不是缺陷；协议本身仍然是 opaque bytes。
- **locality 的两个洞不变**（M1 遗留）：网络 FS 魔数从未在真实挂载上执行；macOS/Windows 无 detector，
  缺失即拒绝，唯一越过方式是显式 `--assume-local-storage` 旗标。
- **listener 的交付面限于 UTF-8 文本 body**：非文本 body 被大声拒绝并打出 `messageId` 与原始 `bodyBase64`
  供人工恢复。这是刻意的边界，不是缺陷；协议本身仍然是 opaque bytes。
