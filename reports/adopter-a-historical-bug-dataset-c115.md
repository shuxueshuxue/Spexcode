# adopter-a 严重历史 Bug 数据集：2026-07-24 快照

## 快照边界与证据范围

- 历史源码基线：adopter-a commit `5eae8f0dcb`。本文件描述该基线时已修复事故与当时的模型边界，不代表后续 HEAD 的当前能力清单。
- 文件路径全部是 adopter-a 仓库相对路径；每条历史证据固定到完整或唯一前缀 commit，不依赖 checkout 位置或宿主机状态。
- 收录条件：至少同时具备修复 commit、可定位的根因代码或设计说明、回归测试；连续补丁修同一根因时合并为一个事故族。
- `formal` 表示形式化反例发现，`observed` 表示提交/事故文档明确记录真实可复现表现，`review` 表示评审或 bot 发现，
  `regression` 表示代码与测试可复现但没有生产事故声明。它们描述证据来源，不代表严重度。
- 这是历史取证快照，不是对当前产品重新执行的验证报告；状态与测试结论只按所列 commit 和归档证据解释。

## 模型关系代码

| 代码 | 含义 |
| --- | --- |
| `COVERED` | 在快照基线中，产品修复与 `control-protocol-model` 已覆盖该事故；仅保留模型假设、边界与实现映射的复核建议。 |
| `EDGE` | 与现有性质相邻，但模型在真实组合接口前结束；不能简单添加一个 guard。 |
| `OUT-SM` | 独立状态所有者，尚无对应状态机模型。 |
| `OUT-REL` | 多权威数据或物化投影一致性，适合关系模型，不属于 control protocol。 |
| `CONTRACT` | 主要是类型、能力或算术契约，不应状态机化。 |
| `OVERCLAIM` | 现有性质名称容易被解释得比实际证明边界更宽。 |

## 主数据集

| ID | 事故与修复链 | 状态所有者 | 最小反例 trace 与被破坏不变量 | 机制标签 | 模型关系 |
| --- | --- | --- | --- | --- | --- |
| ZB-01 | Owner command result 穿越 lease ABA；`f133a17671becb03` | `TaskRealtimeBus` lease、pending command、result route | 历史反例：`lease e0 -> release -> acquire e1 -> result(e0) late -> accepted by e1`。基线已用 `leaseEpoch` 与 P8 隔离旧 command/result；边界复核只需继续检查 acquire 往返原子性及 run/runtime generation 的抽象。 | `incarnation`, `late-result` | `COVERED` |
| ZB-02 | Recovery successor 被旧 flight 污染；`5fdb2beb044fd5cf` | UI subscription、seq、recovery flight | 历史反例：`flight0 frame -> successor flight1 -> old aligned frame/ACK -> flight1 settles`。基线已用 recovery flight 状态与 P9-P11 覆盖 stale flight；边界复核只需确认模型 correlation 可由真实可观察字段实现。 | `incarnation`, `reorder` | `COVERED` |
| ZB-03 | Settings timeout 后旧写仍可 late rename；`da37a61691592c58` -> `f94f45b9d2925361` | 写队列、write generation、filesystem commit | `write0 prepare -> caller timeout -> write1 commit -> write0 late rename`；timeout 不得授权旧 generation 发布。 | `settlement-frontier`, `commit-fence` | `OUT-SM` |
| ZB-04 | Provider retry 前 stream/body 未真正释放；`bde8925194b1329b` -> `5e14d8f10b31bbd0` -> `b4e81a3c0a93a837` | AI SDK iterator、Response tee、Undici connection slot | `attempt0 error -> logical retry -> attempt0 still owns stream/slot -> attempts exhaust pool`；retry 前须跨 cleanup barrier。 | `settlement-frontier`, `resource-debt` | `OUT-SM` |
| ZB-05 | WSL pending owner double release 与 abandoned generation；`cfdbe017f76dd14a` -> `3c53287e308c3815` | host-pool retain、workspace runtime generation、Acquire ACK | `acquire sent -> cancel/reject -> two release paths`，或 `generation allocated -> timeout -> late ACK -> orphan runtime`；两本账分别幂等补偿。 | `incarnation`, `compensation`, `settlement-frontier` | `OUT-SM`, `OVERCLAIM` |
| ZB-06 | 删除任务在重启后复活；`cfaad04df8ae4190` | CLI session store、task-index tombstone、UI membership cache | `session exists + deleted tombstone -> restart projection -> visible`；negative membership 必须支配正向存在事实。 | `multi-authority`, `tombstone`, `restart` | `OUT-REL` |
| ZB-07 | Agent cleanup 遗留 detached 后代或误杀复用 PID；`6bc9a7c83c23ee4d` | Node child、进程树快照、OS process identity | `root exits -> PID reused -> delayed cleanup signals bare PID`；只可清理由 incarnation evidence 证明仍归属的资源。 | `incarnation`, `settlement-frontier`, `ownership` | `OUT-SM`, `OVERCLAIM` |
| ZB-08 | Subagent 审批在多客户端下静默 deny；`d0a989d4a0f3d928` | permission broker route、parent/child session、subscriber registry | `child asks -> no child subscriber -> multi-client disables fallback -> route error -> deny`；审批必须送达可观察 owner 并恰好终结一次。 | `scope-routing`, `authority-identity` | `EDGE` |
| ZB-09 | 同路径远端 workspace 借用错误 services；`3a4580746631c7c9` -> `6f60a1488228b535` | renderer target identity、remote session registry、service handle | `A.path == B.path -> B identity unresolved -> path fallback -> RPC to A`；service target 必须匹配 source workspace identity/session。 | `scope-routing`, `identity` | `EDGE` |
| ZB-10 | 远程文件动作丢失 workspace context；`814135644fefeb29` | UI file target、workspace identity、remote session | `two remotes share path -> preview carries path only -> editor opens wrong host`；文件动作 capability 必须携带来源 identity/session。 | `scope-routing`, `capability` | `EDGE` |
| ZB-11 | CUA timeout 后旧 native generation 继续副作用；`5912f7d5598ea9ff` | Helper identity、native capture epoch、app/window policy、worker admission | `capture e11 admitted -> timeout -> e12 succeeds -> e11 late -> screenshot/input on stale target`；副作用需重新验证同一 identity 与 epoch。 | `incarnation`, `settlement-frontier`, `native-effect` | `OUT-SM` |
| ZB-12 | 显式 fork 在重启后从任务列表消失；`3270dcc2c2fbae51` | durable session store、sessions-index membership | `persist fork(parent != null) -> restart -> roots-only cold query -> omitted`；live 与 cold membership 必须采用同一 task-type 语义。 | `multi-authority`, `restart`, `projection` | `OUT-REL` |
| ZB-13 | Subagent ready 前不能取消/超时，background provenance 过期；`603f06fd760af700` | subagent registry、ready gate、AbortSignal、watchdog、event provenance | `register -> setup hangs -> parent abort -> still await ready`；watchdog/abort 必须覆盖 setup 全程，事件读取 live provenance。 | `settlement-frontier`, `snapshot-drift` | `OUT-SM` |
| ZB-14 | Remote task identity 被陈旧投影字段改写；`9cff9856edec0882` | task-index entity key、workspace identity projection、sessions-index enrichment | `row.key=A + projected identity=B/empty -> join fails or path fallback joins B`；实体主键权威高于派生投影。 | `multi-authority`, `identity`, `projection` | `OUT-REL` |
| ZB-15 | Cold-resume hydration 失败时 command 可能提前 admission；`7c2cd96d1d1b8b53` | durable event log、hydration flight、CommandInbox | `subscribe starts load -> command joins -> load fails -> command executes on partial state`；command admission 蕴含 authoritative hydration 成功。 | `settlement-frontier`, `authority-gate`, `recovery` | `EDGE` |
| ZB-16 | Off-peak 永久配置错误被无限 retry，耗尽 ready ticket；`e50f08b78e118c12` | DB claim、failure kind、retry schedule、ticket budget | `claim -> deterministic credential/model failure -> release/reclaim forever`；permanent failure 必须 terminal，且不再消费 retry/ticket。 | `failure-classification`, `budget`, `liveness` | `OUT-SM` |
| ZB-17 | Output token budget 在 core/adapter/compact 间不一致；`8330903731320ce0` -> `ec8538fc3eb07c1e` | model capability、core effective budget、adapter wire、compact threshold | `model=64K -> compact reserves 32K -> input 64001 + output 64000 > context`；所有消费者必须派生同一 effective budget。 | `arithmetic`, `single-authority` | `CONTRACT` |
| ZB-18 | RPC cancellation 丢失，第一次修复又向所有方法过宽注入 token；`3899bc70ffabcba6` -> `a309137af9a4bd37` | queued/sent RPC、server CTS、proxy ABI、business retry | `cancel before init -> local reject -> queued request later sent`；过宽修复又使 `logout()` 把 token 当 provider。取消能力必须 descriptor opt-in 且端到端传播。 | `settlement-frontier`, `capability-contract`, `over-hack` | `OUT-SM`, `CONTRACT` |
| ZB-19 | SSH deploy lock 已释放但 JS 永久等待 channel close；`0798b186d12d78fd` | remote lock owner、heartbeat process、SSH channel、release Promise | `remote removes lock -> orphan sleep owns stdio -> no close -> release Promise hangs`；业务 release marker 而非 transport close 定义完成。 | `settlement-frontier`, `cross-process` | `OUT-SM` |
| ZB-20 | Atomic file lock ABA：waiter 删除 later writer 的新锁；`9bbf4201b01f4043` -> `ba3978a001e14c2e` | filesystem lock namespace、writer owner token/PID | `W1 releases L1 -> W3 acquires L2 -> old waiter uses elapsed time -> deletes L2`；stale recovery 必须验证当前 lock incarnation。 | `incarnation`, `ABA`, `ownership` | `OUT-SM` |
| ZB-21 | Deferred draft ACK 早于 task-index 持久化；`48cf3780d4dcfdb4` | Agent persistence、Host deferred registry、SQLite task index、command ACK | `accepted ACK -> crash before SQLite sync -> conversation exists but list omits task`；ACK 的线性化点必须在 durable sync 后。 | `settlement-frontier`, `multi-authority`, `linearization` | `EDGE`, `OUT-REL` |
| ZB-22 | WSL 把 `sendPrompt` ACK 当执行完成，release 杀死 active Agent；`23c737438279587a` | Host active-run tracker、Agent ready event、workspace lease/release | `begin -> sendPrompt ACK -> active count zero -> release -> tool still running`；只有 terminal ready event 可结束 active run。 | `settlement-frontier`, `ownership`, `workspace-isolation` | `OUT-SM`, `OVERCLAIM` |

## 关键证据索引

| ID | 根因实现或设计证据 | 回归证据 | 来源 |
| --- | --- | --- | --- |
| ZB-01 | `packages/desktop/src/main/taskRealtimeBus.ts:47,335-337,914-931` | 同 commit 的 bus 测试及 formal-proof eval 链 | `formal`, `regression` |
| ZB-02 | `packages/ui/src/v4/conversationProjectionStore.ts:144-155,442-531` | recovery-flight eval/trace-binding 链 | `formal`, `regression` |
| ZB-03 | `packages/services/src/setting/settingsWriteQueue.ts@f94f45b9:22-58` | `packages/services/test/settingService.test.ts` | `regression` |
| ZB-04 | `apps/adopter-a-cli/packages/adapters/src/model/registry.ts@5e14d8f1:491-510`; `apps/adopter-a-cli/docs/design/v2/model/stream-error-retry.md` | `registry.test.ts`; `runner-provider-business-network.test.ts` | `regression` |
| ZB-05 | `packages/desktop/src/main/desktopRemoteSessions.ts@3c53287e:599-674,1476-1484,1644-1651` | `packages/desktop/test/desktopRemoteSessions.test.ts` | `regression` |
| ZB-06 | `packages/services/src/session/taskIndexRepo.ts@cfaad04d:1900-1920`; `docs/task-list-membership-cache-sync.md` | services/UI membership tests in commit | `observed`, `regression` |
| ZB-07 | `packages/services/src/process/processTreeTerminator.ts@6bc9a7c8:137-205,335-339` | `processTreeTerminator.test.ts`; `adopter-aStdioTransport.test.ts` | `regression` |
| ZB-08 | `apps/adopter-a-cli/packages/core/src/permission/broker.ts@d0a989d4:56-92`; incident note in commit | `apps/adopter-a-cli/packages/core/tests/permission-broker.test.ts:98-148` | `observed`, `regression` |
| ZB-09 | `packages/ui/src/lib/workspaceServiceResolver.ts@3a458074:23-75`; follow-up hook at `6f60a148` | `workspaceServiceResolver.test.ts:33-70`; `useWorkspaceServices.test.ts:366-389` | `regression` |
| ZB-10 | `docs/wsl-open-in-editor.md`; `useWorkspaceOpenInEditorTarget.ts@81413564` | `workspaceOpenInEditorTarget.test.ts:26-47` | `regression` |
| ZB-11 | `packages/services/src/cua-permission-broker/nativeAxSource.ts@5912f7d5:341-440,565-653` | native source/electron backend/AX input tests in commit | `review`, `regression` |
| ZB-12 | `task-list-session-membership.ts@3270dcc2:1-24`; `v4-bridge.ts:1129-1179` | real SQLite cold-resume test `v4-cold-resume.test.ts:842-935` | `observed`, `regression` |
| ZB-13 | `apps/adopter-a-cli/packages/core/src/subagent/runner.ts@603f06fd:182-300,1104-1118`; `docs/subagent-timeout-policy.md` | `subagent-explore.test.ts:167-218,286-340`; tool-event tests | `observed`, `regression` |
| ZB-14 | `packages/services/src/session/taskIndexRepo.ts@9cff9856:185-235`; sidebar authority design | `taskIndexRepoWorkspaceIdentity.test.ts:66-175` | `observed`, `regression` |
| ZB-15 | `v4-gateway.ts@7c2cd96d:361-369,1480-1492,1750-1811` | `v4-cold-resume.test.ts:250-350` | `regression` |
| ZB-16 | `offPeakDispatchSettlement.ts@e50f08b7:22-84`; implementation notes | `offPeakDispatchSettlement.test.ts:33-76` | `observed`, `regression` |
| ZB-17 | `docs/model-request-output-tokens.md@ec8538fc:8-99`; core/adapter budget functions | compact, wire and real desktop E2E tests in fix chain | `observed`, `regression` |
| ZB-18 | `packages/rpc/src/proxy-channel.ts@a309137a:53-183`; `channelClient.ts:56-137` | `packages/rpc/test/proxy-channel.test.ts:195-349` | `review`, `regression` |
| ZB-19 | `packages/server/src/remote/remoteDeployLock.ts@0798b186:69-91,191-277` | `packages/server/test/remoteDeployLock.test.ts:61-198` | `observed`, `regression` |
| ZB-20 | `packages/services/src/fs/atomicFileUtils.ts@9bbf4201:87-200` | `atomicFileUtils.test.ts:186-274`; invalid PID follow-up tests | `review`, `regression` |
| ZB-21 | `packages/services/src/adopter-a-session/adopter-aSessionService.ts@48cf3780:243-332,559-582` | `adopter-aSessionService.test.ts:177-668` | `observed`, `regression` |
| ZB-22 | `hostWorkspaceTaskTracker.ts@23c73743:12-71`; WSL lifecycle plan | tracker/proxy-state tests in commit | `review`, `regression` |

## 隔离候选：不计入主样本统计

`59cbad3ea8260377` 与 `3602309134d488c3` 修复 Repo Wiki 文件读取 TOCTOU：路径预检后若文件或目录被替换，
旧实现可能读取 workspace 外 inode。`repoWikiSafeFileRead.ts` 与
`repoWikiLocalWorkspaceRepoReader.test.ts:149-206` 给出稳定 fd identity、containment 和大小上界反例。
这是高价值安全机制样本，但现有证据只证明评审/测试发现，没有用户或生产事故声明，因此暂不与“真实出现的产品事故”混计。

## 分类结果

### 不是一个全局状态机

22 个事故至少分属 12 个状态域：task control、conversation recovery/hydration、settings/filesystem、provider/RPC、
remote runtime/WSL、task membership/index、OS process ownership、permission/subagent、workspace target resolution、CUA native、
off-peak scheduler、token budget。没有证据表明这些域共享一个线性化点或一份权威状态。

### 重复的是机制形状

标签非互斥：

- 11/22 涉及 **logical settlement 与真实 owner completion 不一致**：ZB-03/04/05/07/11/13/15/18/19/21/22。
- 10/22 涉及 **弱 identity 或缺失 incarnation**：ZB-01/02/05/07/08/09/10/11/14/20。
- 5/22 涉及 **多权威投影或 durable authority**：ZB-06/12/14/15/21。
- 3/22 是 **workspace/session scope routing**：ZB-08/09/10。
- 2/22 是 **预算或 failure-kind 契约**：ZB-16/17。

因此，重复根因是跨边界把本地对象、Promise、路径或缓存当成外部权威状态，而不是七个模块共享了同一个变量。

### 对快照基线模型的判定

- **基线时已经覆盖**：ZB-01、ZB-02 已分别进入 lease-incarnation 与 stale-recovery-flight 的产品修复、性质和回归链，
  不能再作为“现有模型漏了”的证据。保留的审查点是模型边界：ZB-01 的 lease request/response 原子假设与
  `runId == runtimeGeneration` 抽象；ZB-02 的 flight correlation 是否完全来自实现可观察量，以及有界深度之外的时序。
- **组合边界过早终止**：ZB-08、ZB-09、ZB-10、ZB-15、ZB-21。现有 approval/isolation/recovery/command 性质在
  subscriber、resolver、hydration 或 durable ACK 之前停止。
- **没有对应模型**：其余异步资源、远程 runtime、持久化锁、进程、scheduler 事故。它们不能用来证明
  `control-protocol-model` 内部少了一条转移。
- **不应使用状态机**：ZB-17 主要是一个派生值的算术一致性；ZB-18 还包含 RPC descriptor 的能力契约。
- **现有命名容易过度解释**：P4 不能生成真实 resolver/file target 误路由；P7 只证明模型信道存在 cleanup 路径，
  不证明 WSL/进程/stream 等物理资源最终释放。

### 形式化层级分组

- **已有有界回归资产**：ZB-01/02 的 lease incarnation 与 stale recovery flight 覆盖应保留，并持续校验实现映射和假设。
- **适合另建有界状态机/模型检查**：ZB-03/04/05/07/08/09/10/11/13/15/16/18/19/20/21/22。状态必须按真实
  owner 分成多个模型；这里只表示技术层级相同，不表示共享状态。
- **关系模型与持久化状态生成测试**：ZB-06/12/14，重点是 authority 优先级、negative fact、restart/replay 收敛。
- **类型、能力契约与 SMT 算术**：ZB-17，以及 ZB-18 的 RPC descriptor 部分。
- **定理证明**：当前 22 条没有一条需要先上无界定理证明；规格和抽象仍在快速校准，有界反例与组合契约的收益更高。

主数据集每条均为高代码置信度（fix + 根因实现/设计 + regression）；`来源` 列只区分是否另有 observed/formal/review
证据。隔离候选不参与这一置信度声明。

## 后续分类用的最小模型族

1. **Control composition**：保留 owner/lease/approval/recovery，并补 subscriber route、workspace target、hydration gate、durable ACK 接口；
   不把其它资源塞入同一向量。
2. **Async effect and ownership**：通用变量为 operation incarnation、logical state、physical phase、commit/admission fence、
   owned resources、cleanup debt、compensation；各 adapter 只映射自己的真实状态。
3. **Authoritative projection**：显式列出 source-of-truth、negative fact、projection/cache generation、restart/replay，验证支配关系与收敛。
4. **Contract and arithmetic**：用判别联合、能力 descriptor、refinement/SMT 算术验证预算和 API 形状，不建立时间状态机。

这个拆分复用了共同机制词汇，但不制造跨实现不存在的原子关系，符合“复杂度必须买回统一机制”的约束。
