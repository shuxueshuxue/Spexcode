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

## 3. 门禁与结果

（施工阶段填写。）
