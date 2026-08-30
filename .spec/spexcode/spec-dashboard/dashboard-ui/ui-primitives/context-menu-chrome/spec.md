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
restrained control-size text label. A row standing for a domain OBJECT may spend that column on the mark the
board already gives that object instead — a spec node's overlay glyph, say — because repeating one
decorative icon down a list of different things says less than the vocabulary the reader already knows.
Such a mark is decoration: it is hidden from assistive technology, and the row carries an accessible name
that still contains its visible label. Rows are tight but tappable, the longest current command fits without
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
Ordinary actions close before they run. A copy action may keep its own row visible briefly only to report
copied/failed, then dismisses through the same menu close path; it never grows a separate toast vocabulary.

**One shell, two openings.** A menu the POINTER opened stays inert chrome exactly as above. A menu the
KEYBOARD opened must be walkable by the keyboard, so it takes focus on its first command and owns
↑/↓/Home/End while it is open — the walk cannot leak to the surface underneath and move the very subject the
menu is aimed at. Enter/Space remain native button activation and [[esc-layers]] still owns dismissal; the
opener returns focus to whatever it borrowed it from. The two openings differ only in who owns focus, never
in which commands exist.

**A row may be a DOOR instead of a verb.** When one entry stands for a SET whose members are each their own
destination, listing them flat would bury the menu's commands under data — so that entry carries no action of
its own and opens a second panel beside it. It reads as an ordinary row ending in the shell's disclosure
chevron, stays lit while its panel is open, and answers the pointer (hover opens; leaving closes after a
grace long enough to cross the gap to the panel) and the keyboard (ArrowRight/Enter opens, ArrowLeft closes)
alike. The panel is the SAME shell wearing the same row grammar, placed from the row's measured rect and
clamped into the viewport — it opens to the left at the right edge and rides up at the bottom — because the
menu surface clips its own overflow and a panel laid out inside that box would be cut off. A door whose set
is capped SAYS what the cap hid, in a quiet line that is visibly not a row you can press.

A command row may print the binding it also answers to, in a trailing quiet column. That cap is READ from
the key registry ([[keyboard-nav]]'s hint reader), never typed into the label, so a rebind moves the printed
cap with the finger and a menu can never name a key the keyboard no longer fires. The hint is decoration for
assistive technology (`aria-hidden`): the command's word is the accessible name.
