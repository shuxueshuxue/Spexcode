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
---
# yatsu.md — launcher-select

Measured YATU-style through the running dashboard, not by reading the JSX: drive a real browser at a
deployment whose `spexcode.local.json` configures named launchers (the gugu board — `reclaude` + `codex`)
and read the live New-Session DOM, then contrast it against a no-launcher board (the dogfood) for the
fallback. The loss watched is the launcher pick failing to REPLACE the harness picker — either the dropdown
missing when launchers exist (the human can't pick their auth path, silently gets the global default), or
the harness radios lingering beside it (two controls for one decision), or a zero-config project regressing
away from the plain harness radios.
