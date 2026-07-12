---
concern: session wait 对已 actionable 声明态（如 merge 派发期间的 review）即时返回——'等 merge 真正落 main'没有第一类动词，manager 只能退到 git merge-base --is-ancestor 轮询。v0.3.0 campaign 里为此付出一次误判（HEAD 动了≠merge 落了→误 close 杀死 merge agent，靠 fsck 抢救）。建议：wait 增加 --until merged（内部即 is-ancestor 语义）或 merge 完成时发独立事件。[[session-selectors]]
by: ce9e26eb-3cb1-4e8d-b05f-20c9d860d4a3
status: open
nodes: session-selectors
created: 2026-07-12T06:35:49.895Z
---

(no detail given — session wait 对已 actionable 声明态（如 merge 派发期间的 review）即时返回——'等 merge 真正落 main'没有第一类动词，manager 只能退到 git merge-base --is-ancestor 轮询。v0.3.0 campaign 里为此付出一次误判（HEAD 动了≠merge 落了→误 close 杀死 merge agent，靠 fsck 抢救）。建议：wait 增加 --until merged（内部即 is-ancestor 语义）或 merge 完成时发独立事件。[[session-selectors]])
