---
concern: same-hash scrubber 空白 + fullscreen Esc:① 从 feed 自动选中的首行切到同 video blob-hash 的读数,进度条时间标签空白、fill 0 直到首次播放(媒体 paint effect 只 key videoEntry.hash,同 hash 切换不重绘);② fullscreen-control 的 escCleared=false(Esc 未退出全屏)。fe-eventdetail 重测发现,均带图。
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: landed
nodes: event-detail
created: 2026-07-06T18:33:49.300Z
---

(no detail given — same-hash scrubber 空白 + fullscreen Esc:① 从 feed 自动选中的首行切到同 video blob-hash 的读数,进度条时间标签空白、fill 0 直到首次播放(媒体 paint effect 只 key videoEntry.hash,同 hash 切换不重绘);② fullscreen-control 的 escCleared=false(Esc 未退出全屏)。fe-eventdetail 重测发现,均带图。)

<!-- reply: 859280f9-bb09-4da1-9e5b-6bdda0162349 @ 2026-07-17T08:25:58.651Z -->
已修:①媒体 paint effect 现在 key 到所看读数而非仅 clip hash(EventDetail.jsx:276-279 依赖数组含 entry.node/scenario/histIdx),同 hash 切换/AB 翻转都重跑,缓存 clip 走 onMeta 自绘(267-270);②全屏改原生 Fullscreen API(Evidence.jsx:121-122),Esc 原生退出,fullscreenchange 同步按钮态(109-116)。
