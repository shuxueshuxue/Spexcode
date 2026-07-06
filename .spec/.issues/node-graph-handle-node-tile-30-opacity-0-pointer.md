---
concern: node-graph 隐形 handle 点:node tile 上有约 30 个 opacity:0 但 pointerEvents:all 的 5x5px 拖拽 handle 元素(看不见却可点击,可能干扰 tile 点击)。node-graph scenario tiles-carry-no-handle-dots 期望没有 handle 点,fe-board 重测复现(带图,handleStyle opacity=0 pointerEvents=all edges=30)。修:handle 点应 pointerEvents:none 或移除。
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: open
nodes: node-graph
created: 2026-07-06T19:04:46.385Z
---

(no detail given — node-graph 隐形 handle 点:node tile 上有约 30 个 opacity:0 但 pointerEvents:all 的 5x5px 拖拽 handle 元素(看不见却可点击,可能干扰 tile 点击)。node-graph scenario tiles-carry-no-handle-dots 期望没有 handle 点,fe-board 重测复现(带图,handleStyle opacity=0 pointerEvents=all edges=30)。修:handle 点应 pointerEvents:none 或移除。)
