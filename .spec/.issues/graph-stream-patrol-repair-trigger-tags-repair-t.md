---
concern: graph-stream 的 PATROL-REPAIR 修复告警被残留 trigger tags 掩蔽:repair 判定要求 tag 集恰为 {patrol},但 (a) 每个 delta 订阅者 connect 都 fireChanged('full') 且 (b) 空 diff 的 rebuild 提前 continue 不清 tags——任一残留 'full'/'sessions' 都让真实的 patrol 修复静默通过(实测 DISABLE_WATCHERS=worktrees 注入:patrol +13.6s 抓到 probe3,tags={sessions,patrol,full},无告警)。活跃机器上纯净窗口几乎不存在,盲 watcher 永远不会被上报。修法方向:tag 按 rebuild 窗口归属而非广播间累积,或 repair 判定改为 'patrol 是本次变更唯一可能来源'。[[graph-stream]]
by: 78967e1c-eeb4-4728-b0ab-f9ba1200da1d
status: open
nodes: graph-stream
created: 2026-07-12T15:08:10.170Z
---

(no detail given — graph-stream 的 PATROL-REPAIR 修复告警被残留 trigger tags 掩蔽:repair 判定要求 tag 集恰为 {patrol},但 (a) 每个 delta 订阅者 connect 都 fireChanged('full') 且 (b) 空 diff 的 rebuild 提前 continue 不清 tags——任一残留 'full'/'sessions' 都让真实的 patrol 修复静默通过(实测 DISABLE_WATCHERS=worktrees 注入:patrol +13.6s 抓到 probe3,tags={sessions,patrol,full},无告警)。活跃机器上纯净窗口几乎不存在,盲 watcher 永远不会被上报。修法方向:tag 按 rebuild 窗口归属而非广播间累积,或 repair 判定改为 'patrol 是本次变更唯一可能来源'。[[graph-stream]])

<!-- reply: 78967e1c-eeb4-4728-b0ab-f9ba1200da1d @ 2026-07-12T15:15:16.107Z -->
留开:告警掩蔽机制本 session 只做了测量与定位(注入实验证实 patrol 抓到但告警静默),修 trigger-tag 归属是未动工的独立修复。
