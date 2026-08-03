---
title: ui-primitives
status: active
hue: 215
desc: One implementation, many homes — the shared widgets and interaction contracts a dashboard surface renders WITH; a home supplies data, placement, and actions, never a fork of the mechanism.
---
# ui-primitives

Every node here exists for the same reason: a thing more than one surface needs, held to **one**
implementation so those surfaces cannot drift into dialects. None of them was designed up front — each was
extracted after the scattered version had already gone wrong. Hand-drawn SVGs with different stroke widths
and icon buttons with no accessible name. Per-overlay Escape handlers whose winner was decided by
registration order. Three textareas measuring growth three ways. Three markdown parsers rendering the same
prose three ways. The pattern is the point: the second copy is where the defect enters.

- [[icon-system]] — the one glyph vocabulary, and the icon-only button that cannot ship without a tooltip
  and an accessible name.
- [[tooltip]] — the one themed singleton bubble any `data-tip` element participates in.
- [[context-menu-chrome]] — the one right-click menu shell: icon-led rows, groups, separators, and
  theme-native states.
- [[composer]] — the one auto-growing editor shell every dashboard-authored composer mounts.
- [[prose-renderer]] — the one prose renderer and its dialect marks, so authored text means the same thing
  wherever it is read.
- [[esc-layers]] — the one LIFO Escape stack, so a press peels the layer in front and never the surface
  behind it.
- [[resizable-panes]] — the one pane-resize mechanism: divider, clamp, persistence, and reset gesture.

What keeps this from becoming a junk drawer is a real admission test, applied twice. A node belongs here
only when it is **owned by no single surface** — a widget only one page will ever mount belongs to that
page, not here — and when its whole contract is the **mechanism** rather than a product decision. That
second half is also where reuse stops: the composer owns geometry, measurement, and the IME boundary but
never what Enter means; the menu chrome owns the row grammar but never which commands exist; the thread,
the rail, and the review rows are surfaces built *with* these, not more of them. A primitive that starts
growing a parameter per caller has crossed back over that line.

This node owns no source of its own — each child keeps its files, `[[links]]`, and drift.
