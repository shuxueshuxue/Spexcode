---
title: context-menu-chrome
hue: 205
desc: One compact Obsidian-like right-click menu chrome with icon-led text rows, groups, separators, and theme-native states.
code:
  - spec-dashboard/src/ContextMenu.jsx
related:
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/NodeContextMenu.jsx
  - spec-dashboard/src/icons.jsx
  - spec-dashboard/src/styles.css
---

# context-menu-chrome

## raw source

Dashboard right-click menus should scan like Obsidian's: compact, icon-led, quiet, and dense enough to stay
near the cursor. Icons clarify commands but never replace their words, and no emoji enters the menu.

## expanded spec

One shared menu shell is used by the session-row and spec-node menus. It owns the cursor-anchored surface,
semantic menu/group/item/separator structure, and the visual row grammar; callers own only which commands
exist and what they do. A new context menu joins this shell instead of cloning its markup or CSS dialect.

Every action row has a fixed leading column containing a small semantic linear [[icon-system]] glyph and a
restrained control-size text label. Rows are tight but tappable, the longest current command fits without
clipping, unbounded overlay-session headlines ellipsize on one line without overflowing, and the surface
clamps inside the viewport. Related actions form groups; hairline separators mark
real boundaries, especially before destructive actions. Danger colour is reserved for destructive words and
icons, never used as decoration.

The surface uses only [[dashboard-shell]] theme tokens for its background, border, shadow, hover/selected wash,
text, and icon colour, so every preset retains its own palette. It has a modest radius, no oversized type, no
emoji, and no component-local SVG. Keyboard focus is visibly equivalent to hover; menu items keep native button
activation and accessible menu roles while [[esc-layers]] continues to own dismissal order. The menu is
**inert chrome for pointer focus** ([[focus-return]]): pressing or picking an item acts but never moves focus,
so whichever input surface owned typing before the right-click still owns it after the pick.
