---
title: settings
status: active
session: 8533a220-bbd6-4529-babe-7800cda2d9f2
hue: 160
desc: The routed Settings page owns browser preferences for language, theme, console surface, terminal type, and shortcuts.
code:
  - spec-dashboard/src/Settings.jsx#Settings
  - spec-dashboard/src/Settings.jsx#Shortcuts
  - spec-dashboard/src/Settings.jsx#LauncherProfiles
  - spec-dashboard/src/Settings.jsx#HarnessDelivery
related:
  - spec-dashboard/src/PageScroll.jsx
  - spec-dashboard/src/i18n/index.jsx
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/src/sessionSurface.js
---
# settings

## raw source

The dashboard speaks the reader's language. No user-facing string is hardcoded in a component — every
visible word lives in a per-language dictionary and is fetched at render time, so a second language is
a file, not a refactor. English is the source of truth and the fallback; at least one more language
(Chinese) ships alongside it.

The language a reader sees is chosen for them, then overridable by them: on a first visit it follows
the browser; an explicit pick on the settings page overrides detection and is remembered across reloads.
The setting changes the whole UI live — no refresh.

A settings PAGE is the home for this and for choices like it later. It is a top-level page of its own
(`#/settings`, the [[side-nav]] rail's bottom entry, or the `,` hotkey) rather than a popup, and is the
deliberate place future preferences accrete — adding one must not mean inventing a new surface. Its second accreted section is **Shortcuts**: the editable
twin of the help legend. The same [[keyboard-nav]] registry the help modal shows read-only is shown here
as a table you can edit — one row per action with its keyboard key. Clicking a cell captures the next
keypress as that action's new binding, saved per-user and reset to defaults on demand. The help legend
(`?`) stays the read-only view; this is its rebinding twin, the two projecting the one table from
different entry points. (Game-controller mapping is **not** here — the pad binds to action ids, not keys, in
[[game-controller]]'s controller mode; see [[keyboard-nav]].)

Its third accreted section is **Theme**: a swatch picker listing the presets (Minimal — the default,
Notion, Things, Tokyo Night, Catppuccin, Everforest, Gruvbox, Rosé Pine Dawn, Dracula) as proper-noun
labels, each under a small card painted in that preset's own ground, paper, ink, and accent so a reader
sees a theme before choosing it; the chosen card wears the selection wash and an accent ring. The swatch
values live in the theme registry beside the code, and the styles gate holds each to the preset's row in
the sheet. An explicit pick persists and flips the whole app live; absent a valid saved choice the app is
simply Minimal — there is no system `prefers-color-scheme` detection and no light/dark pair. Only the
picker lives here; the palette-swap mechanism it drives belongs to [[dashboard-shell]].

**The page has one control grammar.** Its title is sentence case at the page's statement size
([[typography]]); a section is a heading over rows separated by the divider rule; a row is a label in a
fixed left column beside its control; and a choice among a few values (interface language, default
session view) is a segmented control — the chosen segment lifted onto paper inside a quiet track, the rest
plain. No control on the page draws a bordered pill of its own.

Its terminal section controls the default base surface for newly unchosen pane-backed sessions and the embedded
terminal's font size relative to the surrounding UI. Both choices are local to this browser and project, persist
across reloads, and update their live consumers. The surface choice does not overwrite a session's explicit
Terminal/Conversation selection; it only resolves sessions without one. The font choice does not scale dashboard
chrome or introduce another terminal path. Terminals hidden behind the routed
Settings page refit locally without claiming tmux geometry; returning to Sessions sends that fit through
[[live-view]] exactly like a browser resize.

## expanded spec

### the contract

- **No hardcoded copy.** Components import a translator `t(key)` and never inline visible text. The copy
  lives in `i18n/<lang>.js` dictionaries; the only literals left in components are language-neutral
  glyphs and punctuation (`//`, `❯`, `＋`, arrow/Enter key caps, op marks). The catalogs therefore
  **track the visible strings of every feature** — a key appears the moment its string is shown and drops
  the moment it stops being shown: a whole surface removed, **or** a kept surface that sheds a state (a pane
  whose data now arrives with the board no longer flickers a loading line, so its loading key goes). Every
  such add/drop is mirrored across `en.js` and `zh.js`, so the dictionaries churning alongside the product
  is the invariant working, not drift — the eval tab's new verdict copy (pass / fail / note, expected,
  transcript) from the measure-and-score reframe is the latest such churn, not settings' own drift; the
  picker and resolution mechanism below stay fixed as they grow. Keys may be plain strings
  or `({ n }) => …` interpolators for counted/named copy.
- **English + Chinese**, with English as both the source locale and the per-key fallback: a key missing
  in another language degrades to English, never to a blank or a raw key.
- **Language resolution.** An explicit saved choice always wins; absent one, auto-detect from
  `navigator.language` (a `zh*` primary subtag → Chinese), else English. The choice persists in
  `localStorage` and overrides detection permanently until cleared.
- **Live switching.** Picking a language re-renders every `t()` immediately — the choice flows through
  React context, no reload.
- **Terminal font size.** One shared browser preference validates, persists, and publishes the selected size.
  Settings renders its numeric control; every mounted terminal consumes the same value. A live change updates
  hidden xterm typography locally, and the next visible claim enters the existing fit-to-tmux geometry
  transaction, with no reload, re-created socket, renderer swap, or font-size-specific attach logic.
- **Default console surface.** Settings presents a segmented Terminal/Conversation choice for pane-backed
  sessions with no explicit local base choice. The default is Terminal. Changing it persists within the current
  browser/project and updates any currently displayed unchosen session; a headless session remains Conversation,
  and a remembered session choice always wins.
- **The settings page** is a routed page (`#/settings`, [[side-nav]]) — reached from the rail's bottom
  entry or the `,` hotkey, rendered as a centered readable column inside the shell's shared page pane
  through [[page-scroll]] (the pane supplies the viewport, the shared primitive supplies overflow and
  scrollbar geometry, and this component supplies only its centered content), and the single home for
  future settings. Today it owns the language picker, the terminal base-surface and font-size controls, the shortcuts editor,
  the theme-preset picker, the CLI-backed launcher profile list, and project-scoped built-in harness delivery.
  Launcher profiles are read through the same `/api/settings` path as the New Session picker. Harness delivery
  reads and updates the portable project config through the existing host project API; the host invokes the CLI
  materialize operation, so the browser does not grow a second configuration or execution path. External adapter
  targets are never offered here.
  The direct route mounts that same page inside the phone shell above its tab bar, without inventing a
  mobile Settings clone or a fifth primary tab. `,` again routes home to the graph; Esc routes nothing
  ([[side-nav]] — it only closes in-page overlays).

### the hotkey

`,` opens settings — chosen because it is unbound on the board (the existing keymap is `t`, `?`, `i`,
`Enter`, `hjkl`/arrows, `+`/`-`/`0`, the `n`/`d` chord leaders, `Tab`, `1`-`3`, `Esc`). It is routed by
[[keyboard-nav]]'s keydown handler; on the settings page, `,` or `Esc` routes back to the graph.

### principles

- **A language is data, not code.** Adding one is writing a dictionary file and an entry in the language
  list — never editing a component.
- **Detect, then defer to the human.** The browser is a sensible default, the explicit pick is law.
- **Fail visible.** A missing translation falls back to English and then to the key itself, so a gap is
  seen and fixed, not silently empty.
- **One settings home.** Preferences accrete as sections on the one page; a new setting is a section,
  not a new surface.
