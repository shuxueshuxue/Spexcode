---
title: launcher-select
status: active
hue: 280
desc: A session picks a NAMED launcher profile at create time — a `{ harness, cmd }` pair from config — and that choice is PERSISTED on its record, so resume/relaunch reuses the same command (and the same auth) instead of re-resolving the global default.
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/index.ts
  - spec-cli/src/cli.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/harness.jsx
---

# launcher-select

How a worker is brought up has TWO free variables: WHICH harness ([[harness-adapter]] — claude vs codex)
and WHICH command actually launches it (a login `reclaude`, an API-key `claude-glm`, a bespoke wrapper). A
launcher fuses those two into ONE named profile, so the human picks a single thing per session and the
harness rides along for free. A launcher is a `{ harness?, cmd }` pair in `spexcode.json`'s
`sessions.launchers` map, keyed by a name the human chooses (`claude-glm`, `reclaude`, …); `harness`
defaults to `claude`. Because a launcher NAMES a harness, picking a launcher SUBSUMES the harness axis —
the old free-standing harness pick is the special case of "no launchers configured".

`sessions.defaultLauncher` names the profile a session with no explicit choice uses; `sessions.claudeCmd` /
`sessions.codexCmd` remain the UNNAMED backward-compatible default, resolved (with the `SPEXCODE_CLAUDE_CMD`
/ `SPEXCODE_CODEX_CMD` env override) only when a session carries no named launcher. Host-specific absolute
commands belong in the gitignored `spexcode.local.json`, never in the committed file — a launcher name is
portable, its `cmd` is a machine fact.

**Selection at create time.** `spex new "…" --launcher <name>` picks it on the CLI (threaded through
`createSession`/`newSession` and the `POST /api/sessions` body); the dashboard New-Session form shows a
launcher dropdown sourced from `GET /api/launchers`, which REPLACES the harness picker. That endpoint reports
BOTH the `{ name, harness }` list AND the configured `default` name (`{ launchers, default }`) — because the
dropdown must AGREE with the CLI on which launcher a no-choice create uses. So the dropdown's INITIAL
selection honors `defaultLauncher`: a still-valid remembered (per-browser) pick wins, else the configured
`default`, else the first — never the bare alphabetically-first, which would silently disagree with the config
default (the confusion this closes: a human "testing claude-glm" who is quietly handed another launcher). When
no launchers are configured the list is empty (and `default` blank) and the form falls back to the plain
harness picker, so a zero-config project is unchanged. A resolved launcher fixes the session's harness; an
unknown launcher name is rejected fail-loud (a 400 from the create path), never silently defaulted.

**Visible per session.** A launcher choice that vanishes the moment the worker boots is unanswerable — "did
this session actually launch under `claude-glm`?" A session's persisted launcher NAME therefore reaches the
board: it rides on the session payload (`/api/sessions` + `/api/board`) alongside its `harness`, and every
session-listing row BADGES it — the launcher's harness vendor glyph (the SAME mark the New-Session picker
draws, shared from `harness.jsx`) plus the launcher name — so the launch identity is legible at a glance
without opening the terminal. A session with no named launcher (an old record, or a zero-config default launch)
shows no badge; only a deliberately-named launch earns one.

**Correctness — the choice is persisted, not re-resolved.** The launch command used to be re-resolved
globally at every launch (env → config → default), so a session created under an API-key launcher would
silently become a login session on resume the moment the backend's env or default differed. The fix: the
chosen launcher NAME is stored on the session record ([[sessions-core]]'s `launcher` field) and consulted at
EVERY launch — first launch, drain, and `reopen`/relaunch alike — resolving that named profile's `cmd`
(bypassing the env default) so the same auth path is reused for the life of the session. A record with no
launcher (an old session, or a zero-config default launch) falls back to the current global resolution, so
nothing pre-dating this node changes behavior. The per-session command reaches the agent through the
[[harness-adapter]]'s `launchCmd`, which now accepts the resolved command as an override rather than always
reading the global default — the ONE seam where a launcher's identity overrides the ambient default.
