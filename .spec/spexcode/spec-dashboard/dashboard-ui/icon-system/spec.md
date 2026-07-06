---
title: icon-system
status: active
hue: 205
desc: The dashboard's ONE icon vocabulary — icons.jsx exports <Icon name/> (a single Lucide-derived stroke-SVG contract in the Obsidian/Notion linear style) and <IconButton/> (icon-only button that FORCES title+aria-label), so every glyph lives in one file and icon buttons never ship without a tooltip.
code:
  - spec-dashboard/src/icons.jsx
---

# icon-system

## raw source

Inline SVGs had scattered across the dashboard — the side rail drew five glyphs in SideBar.jsx, the
attach/busy/lock/fullscreen/search glyphs each lived in their host component, and several actions were
still unicode text (`＋`, `×`, `⏸`/`▶`, `‹`/`›`, `⏱`, `export ↗`). Each new surface hand-drew its own
mark, styles drifted (stroke widths, viewBoxes), and an audit found icon buttons with no tooltip at
all. The fix is a foundation node: one icon module, one visual contract, one button wrapper that makes
the accessible name impossible to forget.

## expanded spec

- **One file, one contract.** `icons.jsx` is the single home of every dashboard glyph. `<Icon name
  size/>` renders from an inlined registry — Lucide-derived paths (Obsidian's icon family, MIT,
  copied in so there is zero runtime dependency) plus the dashboard's own hand-drawn marks (the side
  rail's 18-grid page glyphs, the 16-grid utility set). Every stroke icon obeys the same contract:
  `fill=none`, `stroke=currentColor`, round caps/joins, ~1.4–2 stroke width, `aria-hidden` — so any
  glyph inherits its host's color and hover exactly like text. An unknown name throws (fail loud, no
  silent blank button). The two fill-based vendor marks (Anthropic/OpenAI, re-exported through
  `harness.jsx`) live here too but deliberately outside the stroke contract — they are brand marks,
  not linear icons.
- **`<IconButton icon label onClick/>` is the icon-only button.** `label` is required and becomes BOTH
  the tooltip — `data-tip`, the app's singleton tooltip layer ([[tooltip]]) — and the `aria-label`
  (the accessible-name gap the audit found — e.g. the issues New button had neither).
- **Components never hand-write an `<svg>`.** The side rail ([[side-nav]]), the fold glyph
  ([[fold-toggle]]'s `panel-left`), the session console's New/search pills and attach/busy glyphs, the
  lock badge, the annotator's play/pause/fullscreen and A/B `‹›` walkers ([[event-detail]]), the modal
  close `×`, the issues New `＋`, the eval export `↗`→download, and the thread's `⏱` anchor stamp all
  draw from here — the former unicode glyphs are now real stroke SVGs with kept tooltips.
- **Text stays text where text won.** Verb actions with room to breathe (merge/promote/close/resolve/
  retract/send/cancel/save, tab labels, context-menu rows, settings) keep their words — the icon system
  reclaims edge space, it does not iconify prose.
