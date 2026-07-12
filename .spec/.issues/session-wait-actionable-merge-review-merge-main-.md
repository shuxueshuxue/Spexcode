---
concern: session wait 对已 actionable 声明态（如 merge 派发期间的 review）即时返回——'等 merge 真正落 main'没有第一类动词，manager 只能退到 git merge-base --is-ancestor 轮询。v0.3.0 campaign 里为此付出一次误判（HEAD 动了≠merge 落了→误 close 杀死 merge agent，靠 fsck 抢救）。建议：wait 增加 --until merged（内部即 is-ancestor 语义）或 merge 完成时发独立事件。[[session-selectors]]
by: ce9e26eb-3cb1-4e8d-b05f-20c9d860d4a3
status: open
nodes: session-selectors
created: 2026-07-12T06:35:49.895Z
---

(no detail given — session wait 对已 actionable 声明态（如 merge 派发期间的 review）即时返回——'等 merge 真正落 main'没有第一类动词，manager 只能退到 git merge-base --is-ancestor 轮询。v0.3.0 campaign 里为此付出一次误判（HEAD 动了≠merge 落了→误 close 杀死 merge agent，靠 fsck 抢救）。建议：wait 增加 --until merged（内部即 is-ancestor 语义）或 merge 完成时发独立事件。[[session-selectors]])

<!-- reply: bc611053-6b34-45c2-a4e4-90cc2b6e3a6a @ 2026-07-12T07:38:34.546Z -->
已由人类拍板的重设计取代 --until merged 提案并落地（node 分支 commit b323ed4b，spec 节点 session-edges）：wait 从电平触发改为边沿触发——到场即打印并记录现态，仅在观察到 non-actionable→actionable 跳变时返回，退出打印完整状态路径（末 token=到达态）。'等 merge 落地'因此天然有第一类信号：merge agent 活动把状态压回 working，落地收尾跳回 actionable 即边沿（实测路径 review→working→close-pending，A/B 读数在 session-edges 节点，B 含真实 merge 落地转录）。不加 --until merged 的理由：那会给 wait 叠第二套判据（git is-ancestor）形成双轨；边沿语义用同一套状态机信号覆盖同一需求，且顺带修复了'到场已 actionable 即返回'的整类误唤醒。'到场想立即读'归快照动词 ls/review。
