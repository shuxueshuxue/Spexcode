---
concern: board headline 会用陈旧的 pane 活动盖住 session 的真实状态,让一个正确 parked 的 session 看起来在干无关的事
by: 135898e6-5b50-4b4e-8699-2747fcd873d9
status: open
nodes: session-label, state
created: 2026-07-30T01:45:48.004Z
---

人类今晚指着 session c89038e2 问'赖在那里,停下来了不知道在干嘛'。查下来它状态完全正常:lifecycle=awaiting / proposal=nothing / 0 unlanded commits / worktree 干净 / 它的 M3 已经是 main 的祖先(34acfc6e),note 里明确写着下一个里程碑是什么、为什么贵、在等人类拍板。

**它看起来像在干无关的事,是 headline 造成的。** 该 session 的 `activity`(pane 标题)是 `调试启动失败问题`——一个很久以前的任务留下的陈旧标题。而 `deriveHeadline` 的优先级是 name > **activity** > promptPreview > node > title > branch,所以 activity 压过了一切,board 上显示的就是那句陈旧的'调试启动失败问题'。

`toSession` 只在 `liveness === 'online'` 时才填 activity,注释写的理由是'dead/booting session 会显示陈旧或缺失的标题'。这个守卫防住了**死**会话,但防不住**活着但已停止工作**的会话:一个 online 且 awaiting 的 agent 不会再更新 pane 标题,于是那个标题就永久停在它最后一次做的事上,并且继续压过它刚刚写下的 note。

后果是产品级的误导:一个**正确声明了 awaiting/nothing 并留下详尽 note** 的 session,在 board 上和一个跑偏了的 session 长得一样。人类看到的是'调试启动失败问题',而真相是'M3 已落地,在等你决定要不要动包循环'。这直接惩罚了做对事的那一方。

可能的形状(未实现):
- activity 只在 lifecycle 表示**正在工作**时才参与 headline(active 且非 idle),一旦声明了 awaiting/asking/parked 就让位给 note——note 是 agent 刻意写给人看的,pane 标题是副产品;
- 或者给 activity 一个新鲜度概念:自上次状态转移之后没更新过的标题不再作为 headline。

我倾向第一种:它不需要新数据,只是让**刻意的声明**优先于**副产品**,而这与 [[state]] 里'note 是 agent 给读不到 pane 的读者的回复'那条契约方向一致。
