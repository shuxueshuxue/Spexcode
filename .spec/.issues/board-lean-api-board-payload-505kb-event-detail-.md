---
concern: board-lean 泄漏待查:/api/board payload 505KB,event-detail-fixes 和 icon-system 两个节点的 body 出现在 board 里(bodyPartsOffenders)。board-lean 契约要求 body 不进 board(单独 fetch)。fe-board 重测判 fail。需查证:是新/未提交节点 body 进 overlay 的预期行为,还是真 board-lean 回归。若前者,scenario expected 需放宽对新节点的判断;若后者,修 board 组装不带 body。
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: landed
nodes: board-lean
created: 2026-07-06T19:04:46.773Z
---

(no detail given — board-lean 泄漏待查:/api/board payload 505KB,event-detail-fixes 和 icon-system 两个节点的 body 出现在 board 里(bodyPartsOffenders)。board-lean 契约要求 body 不进 board(单独 fetch)。fe-board 重测判 fail。需查证:是新/未提交节点 body 进 overlay 的预期行为,还是真 board-lean 回归。若前者,scenario expected 需放宽对新节点的判断;若后者,修 board 组装不带 body。)
