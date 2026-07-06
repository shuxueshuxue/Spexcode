---
concern: draft-leak: eval 标注器切换选择时圈选草稿不清空,泄漏到另一个 (node,scenario) 的输入框——在那发送会把 A 的 anchored remark 发到 B 的线程(数据完整性 bug)。EventDetail 把 draft prop 置 null 但 ReplyComposer 内部 body state 从不清空/keyed(Thread.jsx draft effect 对 null early-return)。fe-eventdetail 重测复现(带图)。修:ReplyComposer 按选择 key 或在选择变化时清 body。
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: open
nodes: event-detail
created: 2026-07-06T18:33:48.177Z
---

(no detail given — draft-leak: eval 标注器切换选择时圈选草稿不清空,泄漏到另一个 (node,scenario) 的输入框——在那发送会把 A 的 anchored remark 发到 B 的线程(数据完整性 bug)。EventDetail 把 draft prop 置 null 但 ReplyComposer 内部 body state 从不清空/keyed(Thread.jsx draft effect 对 null early-return)。fe-eventdetail 重测复现(带图)。修:ReplyComposer 按选择 key 或在选择变化时清 body。)
