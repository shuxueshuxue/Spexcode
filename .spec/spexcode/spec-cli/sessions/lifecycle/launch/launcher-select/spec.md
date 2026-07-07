---
title: launcher-select
status: active
hue: 280
desc: A session picks a NAMED launcher profile at create time — a `{ harness, cmd }` pair from config — and the RESOLVED command is PINNED on its record, so resume/relaunch replays the exact same launcher (its command, auth, and config-dir env) instead of re-resolving a since-changed default.
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/index.ts
  - spec-cli/src/cli.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/harness.jsx
---

# launcher-select

How a worker is brought up has TWO facts: WHICH harness ([[harness-adapter]] — claude vs codex)
and WHICH command actually launches it (a login `reclaude`, an API-key `claude-glm`, a bespoke wrapper). A
launcher fuses those two into ONE named profile, so the human picks a single thing per session and the
harness rides along for free. Built-in launchers named `claude` and `codex` always exist, backed by
`sessions.claudeCmd` / `sessions.codexCmd` (and their env overrides). Projects can add more `{ harness?, cmd }`
profiles in `spexcode.json` / `spexcode.local.json`'s `sessions.launchers` map, keyed by a portable name the
human chooses (`claude-glm`, `reclaude`, …); `harness` defaults to `claude`. Because a launcher NAMES a
harness, picking a launcher is the ONLY user-facing launch selection. The old free-standing harness pick is
gone.

`sessions.defaultLauncher` names the profile a session with no explicit choice uses; it is required for any
no-choice create. Omitting it is a configuration error for those create paths, reported with the repair: write
`sessions.defaultLauncher` in `spexcode.json` or `spexcode.local.json`. There is no ambient fallback to the
built-in `claude` launcher, because that silently chooses an auth/config-dir path the human did not name.
Host-specific absolute commands belong in the gitignored `spexcode.local.json`, never in the committed file —
a launcher name is portable, its `cmd` is a machine fact.

**Selection at create time.** `spex new "…" --launcher <name>` picks it on the CLI (threaded through
`createSession`/`newSession` and the `POST /api/sessions` body); the dashboard New-Session form shows a
launcher dropdown sourced from `GET /api/launchers`, with the selected launcher's harness shown only as a
derived vendor glyph beside the select. That endpoint reports BOTH the `{ name, harness }` list AND the
configured `default` name (`{ launchers, default }`). The dropdown's INITIAL selection is always a visible
launcher choice: a still-valid remembered (per-browser) pick wins, else the configured `default`, else the
first real launcher in the list. That last case is not an implicit backend fallback — the dashboard sends the
selected launcher name explicitly. Built-in `claude`/`codex` profiles still exist for explicit selection and
for projects whose default names one of them, but they are never an implicit no-choice default.
A resolved launcher fixes the session's harness; an unknown launcher name is rejected fail-loud (a 400 from
the create path), never silently defaulted. `--harness` and `POST /api/sessions { harness }` are not
create-session inputs; callers use `--launcher <name>` / `{ launcher }`.

**Persisted and API-exposed, not badged on the board.** A session's chosen launcher NAME is durable data: it
is stored on the record and rides the session payload (`/api/sessions` + `/api/board`) alongside its
`harness`, so any surface that needs the launch identity can read it. It is deliberately NOT rendered as a
per-session board badge — a harness glyph + name on every session row read as visual clutter, so the board
stays clean. The wrong-launcher confusion (a human "testing claude-glm" quietly handed another launcher) is
already closed at the point it matters — the create-time picker honoring `defaultLauncher` (above) — not by
after-the-fact badging.

**Correctness — the RESOLVED command is pinned, not re-resolved (the resume-launcher-pin).** The launch
command used to be re-resolved globally at every launch (env → config → default), so a session created under
an API-key launcher would silently become a login session on resume the moment the backend's env or default
differed. Storing the launcher NAME alone did not fully close this: even a named launcher whose `cmd` config
later changed would resume under the NEW command. This is not cosmetic — the launcher command carries the
agent's **config-dir env** (claude's `CLAUDE_CONFIG_DIR`, codex's `CODEX_HOME`), and that dir is where the
conversation transcript lives. A drifted launcher sends `--resume` at the WRONG config dir and the conversation
is simply not found ("No conversation found") — the failure that, under a backend restart onto a different
default launcher, silently broke every resume in the mass-restore incident (victims' `launch.sh` rewritten to a
different launcher while their transcripts lived under the original's config dir).

So the launch owner PINS the **resolved base launcher command** on the record at creation ([[sessions-core]]'s
`launchCmd` field, resolved via the [[harness-adapter]]'s `baseCmd`), and EVERY launch — first launch, drain,
and `reopen`/relaunch alike — replays THAT exact command. The pin subsumes both axes: the launcher's resolved
`cmd` is frozen at birth, so the session resumes under the identical launcher (and identical config dir) for
its whole life, immune to any later change of the default or of the launcher's own config. The launcher NAME is
still stored (for display and as the pre-pin fallback); a record with neither a pinned command nor a name (a
truly old session) falls back to the current ambient resolution, so nothing pre-dating this changes behavior.
The pinned command reaches the agent through
`launchCmd`, which builds its invocation ON TOP of this base — the ONE seam where a session's frozen launcher
identity overrides the ambient default.
