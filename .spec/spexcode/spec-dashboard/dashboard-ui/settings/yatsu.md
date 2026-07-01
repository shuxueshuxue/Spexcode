---
scenarios:
  - name: language-switch-retranslates
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, press `,` to open the settings popup. It lists the
      available languages (from i18n LANGUAGES) with the active one marked. Click a DIFFERENT language and
      watch the dashboard chrome (the settings hint, the HUD, labels) re-render. Screenshot the panel before
      and after the switch and confirm no error blanks the app.
    expected: |
      Picking a language immediately re-renders every translated string in that language (e.g. the language
      hint flips from English to the chosen locale), the choice is persisted, and the app stays mounted. A
      key missing in the new locale falls back to the English source, and an absent/undefined key degrades to
      the visible key rather than throwing — so a missing label can never white-screen the tree. No crash.
  - name: theme-toggle-repaints-app
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, press `,` to open settings. Under THEME, click Dark
      and watch the whole app — the spec-node board AND (on the sessions view) the console chrome — repaint
      from the light palette to the dark near-black palette at once. Screenshot before (light) and after
      (dark). Reload and confirm the choice persisted; click Light to confirm it returns.
    expected: >
      Clicking Dark flips the entire app to the dark palette immediately (paper goes near-black, ink goes
      light) with no per-view refresh, because every surface reads the shared CSS vars redefined under
      [data-theme=dark]; the choice persists across reload (localStorage spexcode.theme) and Light restores
      the solarized-light palette. The app stays mounted throughout — no crash, no flash of the wrong theme.
---

# settings — yatsu

Measure through the REAL settings popup, YATU-style: open it with `,`, click a language in the actual panel,
and read the rendered copy — never call setLang directly. The loss is the i18n contract this node owns
([[settings]] governs the i18n provider, `src/i18n`): a language choice retranslates the live dashboard,
falls back to the source locale per missing key, and NEVER lets a missing key crash the React tree (i18n
`resolve` tolerates a non-string key). The same robustness is what kept a stray `t(undefined)` from blanking
the mobile board — see [[mobile-ui]].

For the **theme** section, YATU is the same shape: open the popup, click Dark, and read the LIVE app — the
whole board and the console must repaint to the dark palette at once (via the shared `[data-theme=dark]`
CSS vars — the palette-swap mechanism itself belongs to [[dashboard-shell]]), the choice persists, and
clicking Light returns it. Screenshot light and dark to prove the swap; never call `applyTheme` directly.
