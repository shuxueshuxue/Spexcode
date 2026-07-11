---
scenarios:
  - name: launcher-dropdown-replaces-harness-picker
    tags: [frontend-e2e]
    description: >-
      Through the REAL dashboard New-Session box (the product surface a human uses to launch a worker),
      measure the launcher pick on a project whose config defines `sessions.launchers` (e.g. `reclaude` →
      claude, `codex` → codex) with a `defaultLauncher`. Load the dashboard, open the New-Session box, and
      read the DOM: assert a launcher `<select class="si-launcher-select">` is present, one `<option>` per
      available profile, and that the `.si-agent-picker` harness radiogroup is ABSENT. Cross-check the source
      data at `GET /api/launchers`. Then, on a freshly-initialized project (whose seeded config carries only
      the default `claude` and `codex` launchers) with `sessions.defaultLauncher: "claude"`, confirm the same
      select renders exactly those two seeded options and the harness radios are still absent. Screenshot the New box.
    expected: >-
      Launchers configured → the New box shows the `.si-launcher-select` dropdown with exactly one option
      per profile, the harness radiogroup is gone, and the chosen launcher name is what the New-Session POST
      sends (backend derives the harness from it). Fresh-init project (only the seeded `claude`/`codex`
      launchers) → the same dropdown is present with exactly those two options — ordinary config entries, NOT
      env-derived built-ins — and no plain harness radios render.
      `GET /api/launchers` returns the same `{name, harness}` list the dropdown renders. A launcher subsumes
      the harness axis; picking one is the single choice the human makes.
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
      no longer exists) does the configured default drive the initial selection. When no valid configured
      default exists, the dropdown falls through to the first real launcher as a visible selected choice that
      will be sent explicitly. The old behaviour (silently selecting `d[0]` even when a different config
      default existed, disagreeing with the CLI default) is gone.
    code: spec-dashboard/src/SessionInterface.jsx
    related: spec-cli/src/index.ts, spec-cli/src/harness.ts
  - name: missing-default-launcher-refuses-create
    tags: [backend-api, cli]
    description: >-
      Through the real create surfaces that can omit a launcher, measure a project whose config exposes
      launcher profiles but omits `sessions.defaultLauncher`. Run `spex new "probe"` with no `--launcher`,
      POST `/api/sessions` with no `launcher`, and trigger the `@new` dispatch path, which naturally calls
      create without a launcher. Then repeat with a configured `sessions.defaultLauncher`, and with an
      explicit `--launcher <name>`.
    expected: >-
      With no configured default, every no-choice create fails with an actionable error telling the human to
      write `sessions.defaultLauncher` in `spexcode.json` or `spexcode.local.json`, creates no session/worktree,
      and does not silently fall back to any launcher the human never named (there is no built-in `claude` to
      fall back to — `claude` is just another configured name). With a configured default, `spex new` without
      `--launcher` and `@new` use that configured profile. With an explicit `--launcher <name>`, create succeeds
      by that visible named choice regardless of the configured default.
    code: spec-cli/src/sessions.ts
    related: spec-cli/src/index.ts, spec-cli/src/harness.ts, spec-cli/src/mentions.ts
  - name: launcher-persisted-not-badged-on-board
    tags: [frontend-e2e, desktop]
    description: >-
      Through the REAL dashboard, measure that a session's launcher is DURABLE DATA but is NOT rendered as a
      per-session board badge (the badge was removed as visual clutter). Drive a real browser at the dashboard
      and feed the session list a session whose `/api/graph` (and `/api/sessions`) payload carries a
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
  - name: resume-replays-original-launcher-not-current-default
    tags: [backend-api]
    description: >-
      Create a governed session under launcher A (whose `cmd` wrapper sets a specific config-dir env — e.g.
      `CLAUDE_CONFIG_DIR=/root/.claude`). Then CHANGE the configured default to launcher B with a DIFFERENT
      config dir (point `sessions.defaultLauncher` at B, or edit B's launcher `cmd`), exactly as a backend
      restart onto a different default would. Take the session offline and resume it (reopen); inspect the regenerated
      `launch.sh` and the resolved launch command. Do this for BOTH a named-launcher session and an UNNAMED
      (zero-config default) session.
    expected: >-
      The (re)launch replays launcher A's EXACT pinned command (its config-dir env intact), NOT the current
      default B — so `--resume` looks in A's config dir and FINDS the conversation. `launch.sh` is NOT
      rewritten to B. This holds for the UNNAMED session too: whatever command launched it is frozen on the
      record (`launch_cmd`) at creation and replayed verbatim. Before the pin, an unnamed/default session
      re-resolved ambiently and resumed under B's config dir → "No conversation found" (the resume-death half
      of the mass-restore incident, where victims' `launch.sh` were rewritten to a different launcher while
      their transcripts lived under the original's config dir).
    code: spec-cli/src/sessions.ts
    related: spec-cli/src/harness.ts
---
# eval.md — launcher-select

Measured YATU-style through the real product surfaces, not by reading the JSX. Frontend scenarios drive a real
browser only for the dashboard behaviours the dashboard actually owns: the launcher dropdown exists, replaces
the old harness radios, honors remembered/default/first visible selection order, and keeps launcher data off
the board rows. Backend scenarios drive the CLI/API/session-create paths directly. The missing-default
fail-loud scenario is backend-only: it covers `spex new` without `--launcher`, `POST /api/sessions` without
`launcher`, and `@new`, because those are the surfaces that can omit a launcher. Dashboard missing-default is
not a fail-loud scenario; the dropdown has a visible selected launcher and submits that explicit pick.
