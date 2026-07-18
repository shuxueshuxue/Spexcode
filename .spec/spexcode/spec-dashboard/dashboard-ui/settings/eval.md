---
scenarios:
  - name: language-switch-retranslates
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, press `,` to open the settings popup. It lists the
      available languages (from i18n LANGUAGES) with the active one marked. Click a DIFFERENT language and
      watch the dashboard chrome (the settings section labels, the HUD, labels) re-render. Screenshot the
      panel before and after the switch and confirm no error blanks the app.
    expected: |
      Picking a language immediately re-renders every translated string in that language (e.g. the settings
      section labels flip from English to the chosen locale — `language` → `语言`, `theme` → `主题`), the
      choice is persisted, and the app stays mounted. A
      key missing in the new locale falls back to the English source, and an absent/undefined key degrades to
      the visible key rather than throwing — so a missing label can never white-screen the tree. No crash.
  - name: theme-toggle-repaints-app
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, press `,` to open settings. The THEME section
      lists exactly Minimal, Things, Tokyo Night, Catppuccin, Everforest, Gruvbox, Rosé Pine Dawn,
      and Dracula (Minimal marked as the active
      default; no Light/Dark entries). Click Things and watch the whole app — the spec-node board AND
      (on the sessions view) the console chrome — repaint from Minimal's graphite palette to Things'
      white palette at once. Screenshot before (Minimal) and after (Things). Reload and confirm the
      choice persisted; click Minimal to confirm it returns.
    expected: >
      Clicking Things flips the entire app to the Things palette immediately (paper goes white, ink
      goes dark) with no per-view refresh, because every surface reads the shared CSS vars redefined
      under [data-theme=things]; the choice persists across reload (localStorage spexcode.theme) and
      clicking Minimal restores the default graphite palette. The app stays mounted throughout — no
      crash, no flash of the wrong theme.
---

# settings — yatsu

Measure through the REAL settings popup, YATU-style: open it with `,`, click a language in the actual panel,
and read the rendered copy — never call setLang directly. The loss is the i18n contract this node owns
([[settings]] governs the i18n provider, `src/i18n`): a language choice retranslates the live dashboard,
falls back to the source locale per missing key, and NEVER lets a missing key crash the React tree (i18n
`resolve` tolerates a non-string key). The same robustness is what kept a stray `t(undefined)` from blanking
the mobile board — see [[mobile-ui]].

For the **theme** section, YATU is the same shape: open the popup, click a preset, and read the LIVE app —
the whole board and the console must repaint to that preset's palette at once (via the shared
`[data-theme=<code>]` CSS vars — the palette-swap mechanism itself belongs to [[dashboard-shell]]), the
choice persists, and clicking Minimal returns the default. Screenshot both palettes to prove the swap;
never call `applyTheme` directly.
