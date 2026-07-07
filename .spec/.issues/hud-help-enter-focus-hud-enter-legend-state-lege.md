---
concern: hud-help Enter 键盘回归:focus 到 HUD 的 '?' 帮助按钮后按 Enter 没打开 legend/帮助浮层(state legend:false, activeClass:hud-help)。final-board 收官终测复现(带图)。很可能是今晚 icon/tooltip 翻新改动 Dashboard.jsx 时丢了 hud-help 的 Enter/keydown handler(键盘可达回归)。修:hud-help 按钮 Enter/Space 应打开 legend,和 click 一致。
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: landed
nodes: dashboard-shell
created: 2026-07-06T19:44:52.496Z
---

(no detail given — hud-help Enter 键盘回归:focus 到 HUD 的 '?' 帮助按钮后按 Enter 没打开 legend/帮助浮层(state legend:false, activeClass:hud-help)。final-board 收官终测复现(带图)。很可能是今晚 icon/tooltip 翻新改动 Dashboard.jsx 时丢了 hud-help 的 Enter/keydown handler(键盘可达回归)。修:hud-help 按钮 Enter/Space 应打开 legend,和 click 一致。)
