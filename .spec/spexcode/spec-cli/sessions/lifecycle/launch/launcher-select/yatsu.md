---
scenarios:
  - name: launcher-dropdown-replaces-harness-picker
    tags: [frontend-e2e]
    description: >-
      Through the REAL dashboard New-Session box (the product surface a human uses to launch a worker),
      measure the launcher pick on a project whose config defines `sessions.launchers` (e.g. `reclaude` →
      claude, `codex` → codex) with a `defaultLauncher`. Load the dashboard, open the New-Session box, and
      read the DOM: assert a launcher `<select class="si-launcher-select">` is present, one `<option>` per
      configured profile labelled `<name> · <harness>`, and that the `.si-agent-picker` harness radiogroup
      is ABSENT (the dropdown REPLACES it, not sits beside it). Cross-check the source data at
      `GET /api/launchers`. Then, on a project with NO launchers configured (the dogfood board), confirm the
      inverse: `.si-launcher-select` is absent and the `.si-agent-picker` harness radios render — a
      zero-config project is unchanged. Screenshot both states.
    expected: >-
      Launchers configured → the New box shows the `.si-launcher-select` dropdown with exactly one option
      per profile (`reclaude · claude`, `codex · codex`), the harness radiogroup is gone, and the chosen
      launcher name is what the New-Session POST sends (backend derives the harness from it). No launchers →
      the dropdown is absent and the plain harness radios show. `GET /api/launchers` returns the same
      `{name, harness}` list the dropdown renders. A launcher subsumes the harness axis; picking one is the
      single choice the human makes.
    code: spec-dashboard/src/SessionInterface.jsx
    related: spec-cli/src/index.ts
  - name: dropdown-honors-default-launcher
    tags: [frontend-e2e, desktop]
    description: >-
      Through the REAL dashboard New-Session box, measure that the launcher dropdown's INITIAL selection
      honors the configured `sessions.defaultLauncher` (not the alphabetically-first launcher). Stand up a
      project whose config defines several launchers where the default is NOT the alphabetically-first — e.g.
      `sessions.launchers = { "aaa": …, "reclaude": … }` with `sessions.defaultLauncher: "reclaude"`. With
      localStorage CLEARED (no remembered `si.launcher`), load the dashboard, open the New-Session box, and
      read the dropdown's selected value: `document.querySelector('.si-launcher-select').value`. Cross-check
      the source at `GET /api/launchers` — it must report `{ launchers:[…], default:"reclaude" }`. Then set
      a remembered pick (`localStorage.setItem('si.launcher','aaa')`), reload, and confirm the still-valid
      remembered pick now wins over the default. Screenshot the composer in the fresh (defaulted) state.
    expected: >-
      On a fresh browser (no remembered pick) the dropdown pre-selects `reclaude` — the configured
      `defaultLauncher` — NOT `aaa` (the alphabetically-first), so the dashboard default AGREES with the CLI
      default (`spex new` with no `--launcher` also uses `reclaude`). `GET /api/launchers` returns
      `{ launchers, default }` with `default:"reclaude"`. When a still-valid launcher is remembered in
      localStorage that remembered pick wins instead; only when nothing is remembered (or the remembered one
      no longer exists) does the configured default drive the initial selection — falling back to the first
      launcher only when no default is configured. The old behaviour (silently selecting `d[0]`, disagreeing
      with the config default) is gone.
    code: spec-dashboard/src/SessionInterface.jsx
    related: spec-cli/src/index.ts, spec-cli/src/harness.ts
  - name: session-row-shows-its-launcher
    tags: [frontend-e2e, desktop]
    description: >-
      Through the REAL dashboard, measure that a launched session SHOWS which launcher it ran under. On a
      project with named launchers whose harnesses differ (a `claude`-harness launcher and a `codex`-harness
      launcher), launch one session under each named launcher (via the New-Session box or `spex new
      --launcher <name>`). Open the session list (the map-side SessionWindow and the console's own list) and,
      for each launched row, read the launcher badge: `.sess-launcher` present, its `.sess-launcher-name`
      text equal to the launcher name, and `.sess-launcher .si-agent-glyph` rendering the matching harness
      vendor glyph (Anthropic for the claude launcher, OpenAI for the codex launcher). Cross-check the source:
      the session's `/api/board` (and `/api/sessions`) payload now carries `launcher`. Then confirm the
      negative: a session launched with NO named launcher (a zero-config/old session) shows NO `.sess-launcher`
      badge. Screenshot the list with the badges visible.
    expected: >-
      Each session row badges the launcher it launched under: the `.sess-launcher-name` reads the launcher's
      name (e.g. `claude-glm`) and the adjacent `.si-agent-glyph` is the SELECTED launcher's harness vendor
      mark (the SAME glyph the New-Session picker uses) — so "did it actually launch with claude-glm?" is
      answerable at a glance without opening the terminal. The `launcher` field is present on the session's
      board/sessions payload. A session with no named launcher renders no badge at all (the badge marks a
      deliberately-named launch, not a zero-config one).
    code: spec-dashboard/src/SessionWindow.jsx
    related: spec-cli/src/sessions.ts, spec-dashboard/src/harness.jsx
---
# yatsu.md — launcher-select

Measured YATU-style through the running dashboard, not by reading the JSX: drive a real browser at a
deployment whose `spexcode.local.json` configures named launchers (the gugu board — `reclaude` + `codex`)
and read the live New-Session DOM, then contrast it against a no-launcher board (the dogfood) for the
fallback. The loss watched is the launcher pick failing to REPLACE the harness picker — either the dropdown
missing when launchers exist (the human can't pick their auth path, silently gets the global default), or
the harness radios lingering beside it (two controls for one decision), or a zero-config project regressing
away from the plain harness radios.
