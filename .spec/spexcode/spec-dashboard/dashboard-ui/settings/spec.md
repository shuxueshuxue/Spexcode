---
title: settings
status: active
session: 8533a220-bbd6-4529-babe-7800cda2d9f2
hue: 160
desc: Internationalized copy + a settings popup that picks the language.
code:
  - spec-dashboard/src/i18n/index.jsx
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/src/Settings.jsx
---
# settings

## raw source

The dashboard speaks the reader's language. No user-facing string is hardcoded in a component — every
visible word lives in a per-language dictionary and is fetched at render time, so a second language is
a file, not a refactor. English is the source of truth and the fallback; at least one more language
(Chinese) ships alongside it.

The language a reader sees is chosen for them, then overridable by them: on a first visit it follows
the browser; an explicit pick in a settings popup overrides detection and is remembered across reloads.
The setting changes the whole UI live — no refresh.

A settings popup is the home for this and for choices like it later. It is reached by a hotkey, looks
and behaves like the help/legend modal, and is the deliberate place future preferences accrete — adding
one must not mean inventing a new surface. Its second accreted section is **Shortcuts**: the editable
twin of the help legend. The same [[keyboard-nav]] registry the help modal shows read-only is shown here
as a table you can edit — one row per action with its keyboard key. Clicking a cell captures the next
keypress as that action's new binding, saved per-user and reset to defaults on demand. The help legend
(`?`) stays the read-only view; this is its rebinding twin, the two projecting the one table from
different entry points. (Game-controller mapping is **not** here — it lives outside the browser as the
[[game-controller]] extension; see [[keyboard-nav]].)

Its third accreted section is **Theme**: a Light/Dark picker mirroring the language section, following
the same detect-then-defer shape (system `prefers-color-scheme` default, explicit pick overrides and
persists) — it flips the whole app live. Only the picker lives here; the palette-swap mechanism it
drives belongs to [[dashboard-shell]].

## expanded spec

### the contract

- **No hardcoded copy.** Components import a translator `t(key)` and never inline visible text. The copy
  lives in `i18n/<lang>.js` dictionaries; the only literals left in components are language-neutral
  glyphs and punctuation (`//`, `❯`, `＋`, arrow/Enter key caps, op marks). The catalogs therefore
  **track the visible strings of every feature** — a key appears the moment its string is shown and drops
  the moment it stops being shown: a whole surface removed, **or** a kept surface that sheds a state (a pane
  whose data now arrives with the board no longer flickers a loading line, so its loading key goes). Every
  such add/drop is mirrored across `en.js` and `zh.js`, so the dictionaries churning alongside the product
  is the invariant working, not drift — the yatsu eval tab's new verdict copy (pass / fail / note, expected,
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
- **The settings popup** opens on a hotkey that collides with no existing binding, renders in the shared
  `Modal` chrome (the same centered backdrop / titled header / `×` / `Esc`-close component the
  help/legend uses — see [[node-graph]]), owns the keys while open, and is the single home for future
  settings. Today it owns the language picker, the shortcuts editor, and the light/dark theme picker.

### the hotkey

`,` opens settings — chosen because it is unbound on the board (the existing keymap is `t`, `?`, `i`,
`Enter`, `hjkl`/arrows, `+`/`-`/`0`, the `n`/`d` chord leaders, `Tab`, `1`-`3`, `Esc`). It is routed by
[[keyboard-nav]]'s keydown handler like the other modal keys; `,` or `Esc` closes the popup.

### principles

- **A language is data, not code.** Adding one is writing a dictionary file and an entry in the language
  list — never editing a component.
- **Detect, then defer to the human.** The browser is a sensible default, the explicit pick is law.
- **Fail visible.** A missing translation falls back to English and then to the key itself, so a gap is
  seen and fixed, not silently empty.
- **One settings home.** Preferences accrete as sections in the one popup; a new setting is a section,
  not a new surface.
