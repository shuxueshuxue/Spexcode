---
title: fold-toggle
status: active
hue: 200
desc: The ONE sidebar fold/unfold affordance — an Obsidian-style panel icon button (outlined panel, filled inner bar) shared by every fold site — the eval/issues master-detail shells ([[evals-view]], [[issues-view]]), the session console's Eval-tab list strip, and the eval detail's remark rail ([[event-detail]]) — so folding reads as one grammar, never four hand-drawn arrows.
code:
  - spec-dashboard/src/FoldToggle.jsx#FoldToggle
  - spec-dashboard/src/FoldToggle.jsx#FoldToggleIcon
---

# fold-toggle

## raw source

Three surfaces let a human fold a master list to a thin strip — the Evals page, the Issues page, and
the session console's Eval tab — and all three used to draw their own text arrow (`‹` / `›`). The human
called the arrows odd: a fold toggle is a known idiom, and the known face for it is **Obsidian's sidebar
toggle** — a small outlined panel with a filled bar marking the sidebar column. So the affordance becomes
ONE shared icon button, drawn once, worn everywhere a list folds.

## expanded spec

- **One component, every fold site.** `FoldToggle.jsx` exports the icon (`FoldToggleIcon`) and the button
  around it; the fold sites — [[evals-view]]'s shared `EvalMasterDetail` shell (`fv-fold` / `fv-unfold`),
  [[issues-view]]'s master column (same classes), the session console's `si-list-unfold` strip, and the
  eval detail's remark-rail fold ([[event-detail]]) — render it instead of holding their own copy of the
  SVG. The className stays the site's: it carries the geometry (a 22px square badge riding the filter
  bar, or a full-height slim strip), never the glyph. A site may ride a small badge as the button's
  `children` (the remark rail's count on its folded strip), and may pass a `label` override when the
  default "the list" wording doesn't name what folds (the rail names its review track) — the button
  still owns the tooltip/aria plumbing either way.
- **The glyph is Obsidian's sidebar toggle.** A 24×24 outlined panel (`fill=none`,
  `stroke=currentColor`, width 2, round caps/joins): an outer rounded rect with an inner filled vertical
  bar (`sidebar-toggle-icon-inner`, its own class so the bar can be styled apart later) marking the list
  column. **Fold and unfold wear the SAME icon** — Obsidian keeps one glyph for a sidebar open or
  collapsed, and the direction lives in the button's `title`/`aria-label` (`masterList.fold` /
  `masterList.unfold`), not in a mirrored drawing.
- **Tint is the button's.** The SVG inks `currentColor`, so each site's existing rest/hover colors
  (muted → blue) keep working with no icon-specific palette. On the folded strip the icon sits at the
  top — where the fold badge sat — so the toggle never moves under the pointer across a fold.
