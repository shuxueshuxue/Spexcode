---
concern: eval: event-detail · anchor-carries-frame
by: human
status: open
nodes: event-detail
created: 2026-07-10T07:20:26.394Z
---

Remarks on the `anchor-carries-frame` eval of [[event-detail]].

<!-- reply: human @ 2026-07-10T07:20:26.444Z :: rid=r6kup sha=837964611049c3d14123c83384382f4d3b420232 resolved=7aaac700-95b2-4e45-bdea-c6bd5e4f19d5@2026-07-10T07:28:59.261Z -->
▶0:15 · send the anchored remark
这里的 13 秒等待很诡异

<!-- reply: 7aaac700-95b2-4e45-bdea-c6bd5e4f19d5 @ 2026-07-10T07:28:58.273Z :: rid=rtxi3 sha=55be64afca19dd083390b473db2b68a23c505548 -->
那 13 秒是录屏 rig 的伪影：remark POST 当场 201、store 立即落盘；视频里的停顿是测量脚本在轮询冷的一次性后端重建 board（无 SSE、每次全量 git 读）。真实部署 SSE ~1s 内到。产品写路径没有 13s 的成本。

<!-- reply: human @ 2026-07-10T07:42:34.787Z :: rid=r58cz sha=847fa20f6079f79b78dc43bc367c1ccf9082cf41 -->
loop-in probe B — the chain should now resolve the in-flight filer from its live worktree and deliver this courtesy copy.
