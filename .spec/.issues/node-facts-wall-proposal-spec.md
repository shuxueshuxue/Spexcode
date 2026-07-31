---
concern: 孤儿分支 node/facts-wall-proposal:团队墙提案已完成 spec+浏览器读数但从未提交评审,等产品取舍
by: 5f8db3cd-759c-4f84-a220-604239470600
status: open
nodes: dashboard-shell
created: 2026-07-31T05:18:33.889Z
---

Spec: dashboard-shell

盘点 7-30 那批消失 session 时发现的无主未落地工作,登记在此以免继续烂在分支上。

**是什么**:`node/facts-wall-proposal`(2026-07-24,2 提交,373 插入),提出 `facts-wall` 节点——"团队墙":一块被动、大字号、可从房间另一头看清的共享屏,把 spec 树健康度、eval 损失、待人处理项、agent 舰队状态放在一个面上。声称的需求方是 adopter-a(adopter)。实现面为 `spec-dashboard/src/WallPage.jsx` + route/SideBar/icons/styles/i18n。

**状态**:doer 走完了仪式(spec 节点 + 一条 passing browser reading `901d8b6c`),但分支从未提出合并,session 已不存在。`facts-wall` 节点在 main 上不存在,两条提交 patch-id 均无上游等价。

**为什么登记而不是直接推进**:这是产品取舍(要不要这块屏),不是等价性问题,不该由一条 session 单方面决定。分支已陈旧 6 天,dashboard 侧同期改动不小,若要它就得先带到当前主线再重测那条浏览器读数。

**处置选项**:(a) 接受 → 派一条 session 把它带到当前 main、重测读数、正常提评审;(b) 否决 → 按 `archive/rejected-*` 惯例改名保全并关闭本条;(c) 继续挂着。默认不动。
