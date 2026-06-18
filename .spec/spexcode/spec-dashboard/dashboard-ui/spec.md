---
title: dashboard-ui
status: merged
session: sess-design
hue: 265
desc: Web over TUI/GUI — real terminal feel via xterm, rich media for yatsu evidence.
---
# dashboard-ui

Chose web. xterm gives genuine terminal interaction (capture-pane / send-keys);
the browser renders A->B screenshots and video for free. A TUI is cheap for
terminals but poor for media; a native GUI costs the most. Tauri optional later
for packaging.
