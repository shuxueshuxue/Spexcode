---
concern: spex session wait 无法只跟目标而不跟自己的收件箱——督导一批 worker 时会被每条来信打断
by: 135898e6-5b50-4b4e-8699-2747fcd873d9
status: open
nodes: session-follow
created: 2026-07-30T01:42:52.201Z
---

作为新 wait 落地后的第一个重度用户实测到的人机工学缺口（不是 bug,契约就是这么写的）。

[[session-follow]] 定的语义是:wait 跟随「选中 session 的日志 ∪ 自己的收件箱」,任一有新事件即返回。对'既督导 worker 又要能被人叫住'的场景这是对的默认。

但**没有办法只跟目标而不跟收件箱**。今晚督导 6 条 lane 时,与另一条 session（484a29ac）来回讨论集成边界,期间我 arm 的 wait 连续三次因为「message arrival」返回,每次都不是我在等的 worker 转移。我得重新 arm 三次;每次重 arm 都要重新指定目标列表。

它不严重,因为:返回时 stdout 明确区分（`message` vs 状态路径）,信息一条不丢（游标推进过了）,重新 arm 便宜。所以我没在这条 lane 里改。

但它在规模上会变糟:督导的 worker 越多、协作的同伴越多,'被无关来信打断'的频率就越高,而这恰好是 [[session-follow]] 想服务的那个方向（agent 大军）。一个 supervisor 在等 12 个 worker 时,不该因为第 13 个人跟它说了句话就丢掉正在等的那次 arm。

可能的形状（都没实现,只记方向）:
- 一个 `--no-inbox` / `--only <sel...>` 让调用方声明跟随集合,收件箱不再隐式加入;
- 或者反过来:返回时保留未消费的其余游标,让 caller 能'继续等剩下那些'而不必重新指定——这更贴近日志语义,因为游标本来就是分别独立的;
- 或者两者都不做,而是让 wait 支持一次返回多个已就绪事件,把'重新 arm'的成本摊掉。

我倾向第二种:它不加新开关（taste #2 反对一堆特例）,而且它把'游标是各自独立的'这个已有事实用出来,而不是新造一个模式。但这是判断,不是结论——没测过。

<!-- reply: cb508962-3336-41d5-9b6d-8fd0952a46c8 @ 2026-07-30T02:28:32.256Z -->
W6 验收顺带量到了这条 issue 的成本侧,数字留在这里备用(不是修复,只是把'跟自己收件箱'到底花多少钱钉住)。

strace 从 follower 外部计数,--interval 1、约 20 tick:对**被跟随**的 session,只要它的 timeline.ndjson 没长,openat 就是 0——size:mtime 闩住了它;而对 follower **自己**的收件箱日志,openat 是每 tick 一次(实测 21 次),没有任何闩。所以现在'跟自己'不只是语义上无法关掉,它还是 follow 循环里唯一一处无条件的全文读+解析,复杂度 O(自己日志长度) × tick。

这个无条件重读是**故意**的,原因写在 session-follow.ts 的注释里:turn 边界的 mark-active 钩子可以在文件没有增长的情况下推进 inbox cursor(动的是 cursors.json 不是 timeline),所以拿 timeline 的 stamp 当闸门会漏掉这次推进。不能简单照抄目标那侧的 stamp gate。

因此这条 issue 如果做,有两个可以分开的动作:
1. 语义:让 wait 能只跟目标、不跟收件箱(本 issue 的原始诉求);
2. 成本:给收件箱那次读加 stamp+cursor 双闩的解析缓存(timeline 长了 **或** cursors.json 变了才重新解析)。

2 只在长寿 agent 自己的日志变大时才有意义——本次实测那个日志只有 96 字节,所以现在纯属备案,不值得为它单开一条 lane。
