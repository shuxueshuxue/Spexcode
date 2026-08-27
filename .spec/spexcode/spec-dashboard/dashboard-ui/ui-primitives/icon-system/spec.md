---
title: icon-system
status: active
hue: 205
desc: The dashboard's ONE icon vocabulary — icons.jsx exports <Icon name/> (one data-driven SVG contract, stroke-first with explicit fill geometry for official semantic marks) and <IconButton/> (icon-only button that FORCES title+aria-label), so every glyph lives in one file and icon buttons never ship without a tooltip.
code:
  - spec-dashboard/src/icons.jsx
related:
  - spec-dashboard/src/iconConsistency.test.mjs
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
  rail's 18-grid page and dock-projection glyphs — the files stack and the sessions list with status
  points — and the 16-grid utility set). Every stroke icon obeys the same contract:
  `fill=none`, `stroke=currentColor`, round caps/joins, ~1.4–2 stroke width, `aria-hidden` — so any
  glyph inherits its host's color and hover exactly like text. A definition may declare its official
  fill/stroke geometry as data when fidelity is the point — notably Primer's MIT-licensed 16px
  `issue-opened` and `issue-closed` Octicons used by [[issues-view]] — without a component-local SVG or a renderer branch.
  An unknown name throws (fail loud, no
  silent blank button). The fill-based harness product marks (Claude Code / Codex / opencode / pi,
  re-exported through `harness.jsx`) live here too but deliberately outside the stroke contract — they
  are brand marks, not linear icons. Each is the harness's OWN official product mark, not its vendor
  company's logo (the Claude spark, not the Anthropic wordmark; the Codex ring, not the OpenAI flower),
  sourced from AionUi's multi-CLI icon set and monochrome-adapted: hardcoded brand fills stripped so
  the mark inherits `currentColor` (readable in both themes), a two-tone original keeping its second
  tone as an opacity step. The console's `corner-up-left` mark names the session-tree move back to top
  level, retaining the same stroke vocabulary rather than a component-local arrow. The explorer head's
  `collapse-all` mark ([[dock-modes]]) is VS Code's official Codicon (`microsoft/vscode-codicons` 0.0.35,
  `src/icons/collapse-all.svg`, CC BY 4.0), kept path for path as fill geometry the way the Primer pair is —
  the mark every VS Code reader already knows, not a redrawn cousin of it; the icon test pins its paths so a
  later tidy cannot drift it.
- **Identity marks are a data adapter, not scattered glyphs.** [[project-identity]] renders the named
  [[icon-presets]] registry because the same data must serialize into browser favicons. That one renderer
  is the deliberate sibling to the chrome glyph vocabulary; pages still never hand-write SVG variants.
- **Review state never falls back to text glyphs.** [[review-chrome]]'s ONE data mapping composes this
  registry's Primer issue pair with solid-ring circle-check/circle-x for current verdicts, dashed-ring
  circle-check/circle-x for stale verdicts, and circle-minus/circle-dashed for empty/missing. Fresh and
  stale therefore never reuse one shape with only colour or tooltip carrying the semantic difference.
  The same mapping feeds eval list, detail status, and every A/B selector, plus issue list/detail. ListView
  state marks share a normalized 16-grid outer ring and optical stroke with the Primer pair, then
  [[review-chrome]] places them in one fixed box — domain/state changes never shift a row. ListView
  query/facet chrome also takes search, chevron-down, the secondary Filters trigger's filter/funnel,
  comments, and check marks from here; that filter-only menu never masquerades as an ellipsis/kebab action
  menu, and no Unicode check/cross or component-local triangle appears.
- **`<IconButton icon label onClick/>` is the icon-only button.** `label` is required and becomes BOTH
  the tooltip — `data-tip`, the app's singleton tooltip layer ([[tooltip]]) — and the `aria-label`
  (the accessible-name gap the audit found — e.g. the issues New button had neither).
- **Components never hand-write an `<svg>`.** The side rail ([[side-nav]]),
  the session console's New/search pills, attach/busy glyphs, and compact type/merge/relaunch toolbar tools, the
  lock badge, the annotator's play/pause/fullscreen and A/B `‹›` walkers ([[event-detail]]), the modal
  close `×`, the issues New plus, the eval export `↗`→download, and the thread's `⏱` anchor stamp all
  draw from here — the former unicode glyphs are now real stroke SVGs with kept tooltips. The Issues
  drain's complete lifecycle also draws from here as the official filled `issue-opened` / `issue-closed`
  pair rather than mixing one Octicon with CSS-made dots.
- **A glyph says what the control is about, not where its panel sits.** The mirrored panel pair —
  the same 18-grid frame with the left column tinted and the right column tinted — is the LAYOUT
  vocabulary: it means *which side a dock opens*, and it reads as a pair because the two toggles that
  spend it sit a few pixels apart, each one's whole message being the side. Today only the right context
  dock draws one; the mirror stays declared beside it, because half a mirrored pair is a glyph whose
  meaning nobody can recover. The rail's explorer PROJECTION is not one of those toggles — it names what
  the dock will list — so it wears the files stack instead: two sheets with folded corners, the shape
  every editor's file tree already uses. Wearing the panel frame there made a file tree read as a card
  or a folder, which is one glyph carrying two meanings and the law this registry exists to keep.
- **Text stays text where text won.** Verb actions with room to breathe (promote/close/resolve/
  retract/send/cancel/save, tab labels, context-menu rows, settings) keep their words — the icon system
  does not replace prose with mystery glyphs. Context-menu rows pair those labels with a small leading
  icon from this registry, the Obsidian/Lucide grammar that makes a scan faster without hiding the command.
  The desktop terminal toolbar is the deliberate compact exception: familiar icon-only command tools preserve
  their localized prose in tooltip/`aria-label`, while the ONE session-command registry supplies their meaning.

The `collapse-all` mark is the official VS Code Codicon from
<https://app.unpkg.com/@vscode/codicons@0.0.35/files/src/icons/collapse-all.svg>, retained path-for-path
under its CC BY 4.0 terms and rendered with `fill=currentColor` and no stroke. It remains a registry entry,
not a component-local SVG.

`spec-dashboard/src/iconConsistency.test.mjs` is the executable boundary for this rule. It rejects component-local
SVGs (with the deliberate `IdentityIcon` favicon adapter exception), checks every literal `<Icon>`/`<IconButton>`
name against the registry, and keeps the shared stroke/tooltip/accessibility contract visible in the test suite.
