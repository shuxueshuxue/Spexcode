---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
---
# keyboard-nav

Left/right = siblings, up = parent, down = child. Logical keys on a stable tree.

## v2 — flat camera
Replaced React Flow's Van Wijk zoom arc (the "jump too high") with a flat
constant-zoom rAF pan that centres the focused node. +/- adjust the zoom.
