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
text, and icon colour, so every preset retains its own palette. Its background is specifically the **raised**
rung of [[typography]]'s ground ladder — a menu is a thing that has left the plane, so it is painted the one
tone that is above the plane, never a chrome tone borrowed from below it. A menu opens over whatever happens
to be under the cursor, which is exactly why it cannot take its ground from any one of them: painted `--panel`
it was the sidebar's own value in every preset and the terminal's in most of them, so the surface a reader had
just summoned had no boundary at all against the thing it covered. It has a modest radius, no oversized type, no
emoji, and no component-local SVG. Keyboard focus is visibly equivalent to hover; menu items keep native button
activation and accessible menu roles while [[esc-layers]] continues to own dismissal order. The menu is
**inert chrome for pointer focus** ([[focus-return]]): pressing or picking an item acts but never moves focus,
so whichever input surface owned typing before the right-click still owns it after the pick.
Ordinary actions close before they run. A copy action may keep its own row visible briefly only to report
copied/failed, then dismisses through the same menu close path; it never grows a separate toast vocabulary.

**One shell, two openings.** A menu the POINTER opened stays inert chrome exactly as above. A menu the
KEYBOARD opened must be walkable by the keyboard, so it takes focus on its first command and owns
↑/↓/Home/End while it is open — the walk cannot leak to the surface underneath and move the very subject the
menu is aimed at. Enter/Space remain native button activation and [[esc-layers]] still owns dismissal; the
opener returns focus to whatever it borrowed it from. The two openings differ only in who owns focus, never
in which commands exist.

A command row may print the binding it also answers to, in a trailing quiet column. That cap is READ from
the key registry ([[keyboard-nav]]'s hint reader), never typed into the label, so a rebind moves the printed
cap with the finger and a menu can never name a key the keyboard no longer fires. The hint is decoration for
assistive technology (`aria-hidden`): the command's word is the accessible name.
