---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
code:
  - spec-dashboard/src/App.jsx
---
# keyboard-nav

Move by relationship on a stable, depth-aligned tree — not by raw pixel distance.

`←` / `→` go to the parent / nearest child (the child closest in y). `↑` / `↓` move
within the focused node's **column** to the nearest node in that direction: depth
pins x exactly (`x = depth · X_GAP`), so a column is a clean vertical line and
vertical nav never changes column or dives into a child. Columns are aligned and
rows aren't, so we navigate the organised axis — and it's reversible, since a
column's nodes are already ordered in y. `+` / `-` zoom, `0` resets.

The tree never re-plots. The camera flat-pans at constant zoom to centre the focused
node — a Van Wijk zoom arc once caused a "jump too high", so it's a plain rAF pan.
