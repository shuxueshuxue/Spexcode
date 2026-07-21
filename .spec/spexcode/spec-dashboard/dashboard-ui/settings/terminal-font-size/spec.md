---
title: terminal-font-size
status: active
hue: 160
desc: One browser-local terminal font-size preference drives every mounted xterm and the ordinary tmux geometry transaction without scaling dashboard chrome.
code:
  - spec-dashboard/src/terminalFont.js
related:
  - spec-dashboard/src/Settings.jsx
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
---

# terminal-font-size

The terminal's type size is a browser preference independent of dashboard UI typography. One small store reads
the shared terminal-size token as its default, validates a saved numeric override, persists explicit changes,
and notifies every mounted terminal in the page. Settings presents that one value as a numeric range with its
current pixel size visible.

Changing the value updates xterm's public font-size option and re-runs its ordinary fit. Because Settings is a
routed page, mounted terminals are hidden at that moment and adopt the typography locally without claiming tmux
geometry. The next visible claim carries the measured rows and columns through [[live-view]]'s ordinary geometry
transaction, exactly as after a browser resize; the terminal socket, renderer identity, cached buffer, and tmux
transport remain the same. Reload restores the saved choice before the terminal's first measurement.
