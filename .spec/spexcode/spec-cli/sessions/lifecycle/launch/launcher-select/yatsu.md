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
  - name: launcher-persisted-not-badged-on-board
    tags: [frontend-e2e, desktop]
    description: >-
      Through the REAL dashboard, measure that a session's launcher is DURABLE DATA but is NOT rendered as a
      per-session board badge (the badge was removed as visual clutter). Drive a real browser at the dashboard
      and feed the session list a session whose `/api/board` (and `/api/sessions`) payload carries a
      `launcher` (e.g. `launcher: "claude-glm"`, `harness: "claude"`) — the exact data that WOULD have drawn
      the old badge. Open the session list (the map-side SessionWindow and the console's own list) and read
      the DOM: assert NO `.sess-launcher` element renders on any row (the badge is gone from the component
      entirely), while the row itself still renders normally. Cross-check the source: the `launcher` field IS
      still present on the board/sessions payload (the data is kept, only the board render is dropped).
      Screenshot the clean list (no launcher badges).
    expected: >-
      No session row shows a launcher badge — `document.querySelectorAll('.sess-launcher').length === 0` even
      for a session whose payload carries a `launcher` — so the board reads clean, without a harness glyph +
      name on every row. The `launcher` field remains on the session's board/sessions payload (persisted and
      API-exposed for any surface that needs it); the wrong-launcher confusion is closed at create time by the
      default-honoring picker ([[dropdown-honors-default-launcher]]), not by after-the-fact board badging. The
      old per-row `.sess-launcher` / `.sess-launcher-name` / `.si-agent-glyph` badge is gone.
    code: spec-dashboard/src/SessionWindow.jsx
    related: spec-cli/src/sessions.ts
---
# yatsu.md — launcher-select

Measured YATU-style through the running dashboard, not by reading the JSX: drive a real browser at a
deployment whose `spexcode.local.json` configures named launchers (the gugu board — `reclaude` + `codex`)
and read the live New-Session DOM, then contrast it against a no-launcher board (the dogfood) for the
fallback. The loss watched is the launcher pick failing to REPLACE the harness picker — either the dropdown
missing when launchers exist (the human can't pick their auth path, silently gets the global default), or
the harness radios lingering beside it (two controls for one decision), or a zero-config project regressing
away from the plain harness radios.
