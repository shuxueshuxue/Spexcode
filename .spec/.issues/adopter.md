---
concern: adopter 大屏消费数据资产的原生缺口：批量查询/事件流/退休后留存/缓存
by: 206ab57c-2906-48c3-8084-e9eca97eb478
status: open
nodes: spec-cli
created: 2026-07-24T03:39:08.085Z
---

zcode CR 审阅台（zcode-base :8088 大屏）作为首个纯消费 SpexCode 数据资产的 adopter 展示面，暴露四个应属 SpexCode 原生的缺口（分界原则：数据的获取/留存/推送/性能归 SpexCode 原生；GitLab/ledger/verdicts 等业务 join 与呈现归 adopter）：① 批量查询 API 友好度——大屏要 sessions+最终 note+eval readings 的一次性有界查询（过滤/分页/字段选择），现在只有全量 /api/sessions 轮询+逐 session 下钻；② 事件流——sessions/note 变更缺推送面（大屏被迫 30s 轮询整表；backend 内部已有 SSE/WS 基建，缺 adopter 可订阅的稳定契约）；③ 退休后数据留存——session close 后其 note/eval 深链从 API 消失，adopter 只能自己落盘副本（zcode 靠 reports/*.note.md 兜底）；session 是记录属性的 headless 时代，note/readings 应长期可查；④ adopter 规模的缓存/性能——/api/graph 冷构建（zcode 曾 71s）与详情视图卡死（66d1cfb7 正在查前端面，另见 #39/#40）。本 issue 求的是机制级 API 契约，不是给 zcode 的专例。
