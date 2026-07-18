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
  - spec-cli/src/help.ts
  - spec-cli/src/guide.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/launch.js
  - spec-dashboard/src/ModeToggle.jsx
  - spec-dashboard/src/i18n/modeLabel.test.mjs
  - spec-dashboard/src/harness.jsx
---

# launcher-select

How a worker is brought up has TWO facts: WHICH harness ([[harness-adapter]] — claude / codex / opencode / pi)
and WHICH command actually launches it (a login `reclaude`, an API-key `claude-glm`, a bespoke wrapper). A
launcher fuses those two into ONE named profile, so the human picks a single thing per session and the
harness rides along for free. Every launcher is a NAMED entry in `spexcode.json` / `spexcode.local.json`'s
`sessions.launchers` map — a `{ harness?, cmd }` pair keyed by a portable name the human chooses
(`claude-glm`, `reclaude`, …); `harness` defaults to `claude`. `claude` and `codex` are NOT a special
built-in tier resolved from an env var or a `claudeCmd`/`codexCmd` config field: [[spex-init]] SEEDS them as
ordinary named launchers (`claude` = `{harness: claude, cmd: 'claude --dangerously-skip-permissions'}`,
`codex` = `{harness: codex, cmd: 'codex --yolo'}`), after which they are edited, renamed, or removed like any
other entry. A project that must run workers under an auth wrapper (reclaude) sets that launcher's `cmd` in
the gitignored `spexcode.local.json` — there is NO runtime env that rewrites a launcher's command. So the
picker lists exactly the config's real launchers, and two names
can never resolve to the same command as ghost duplicates. Because a launcher NAMES a harness, picking a
launcher is the ONLY user-facing launch selection. The old free-standing harness pick is gone.

`sessions.defaultLauncher` names the profile a session with no explicit choice uses; it is required for any
no-choice create. Omitting it is a configuration error for those create paths, reported with the repair: write
`sessions.defaultLauncher` in `spexcode.json` or `spexcode.local.json`. There is no ambient fallback to a
`claude` launcher — `claude` is just another configured name, so a default (like every launcher name) must
resolve to a real `sessions.launchers` entry or fail loud, never silently choosing an auth/config-dir path the
human did not name. Host-specific absolute commands belong in the gitignored `spexcode.local.json`, never in
the committed file — a launcher name is portable, its `cmd` is a machine fact.

**Selection at create time.** `spex new "…" --launcher <name>` picks it on the CLI (threaded through
`createSession`/`newSession` and the `POST /api/sessions` body); the dashboard New-Session form shows a
launcher **pop-out picker** sourced from `GET /api/settings` — a clean pill button wearing the selected
launcher's harness vendor mark + name (no caret, no label — plus a quiet small `◇` while headless is
armed; its tooltip names `spexcode.json` / `spexcode.local.json` as where launchers change) that opens a
**viewport-centred pop-out card** over a light backdrop (not an anchored dropdown). The card leads with
the session-MODE segmented switch — `⌨ interactive | ◇ headless`, the shared `ModeToggle` the phone
composer renders too (aria-pressed marks the armed segment; ←/→ flips it). The mode's visible label is
plainly **"headless"** everywhere the mode is presented — the segment, the armed pill's `◇` mark, the
board row's `◇` mark tooltip — never suffixed with a console-face name ("— chat view"): which face a
headless console wears is [[session-console]]'s fact, not the mode's name. Then
**one row per launcher** (its harness glyph + its name, and beneath them the command THE ARMED MODE
would run — `cmd` in interactive, `headlessCmd` in headless, shown in full as read-only display text; a
headless-capable launcher with no own command shows a "runs server-side" placeholder instead of a blank).
A row whose `modes` excludes the armed mode greys out and refuses the pick, its tooltip naming the
`headlessCmd` config repair (aria-disabled, so the tooltip's hover still fires); the frontend only
CONSUMES the backend-computed `modes`, never re-deriving adapter capability. Otherwise the **entire row
is ONE pick target**: a click anywhere on it —
the `cmd` line included — picks the launcher and closes the pop. The `cmd` never behaves as a surface of
its own (no control, no independent text-selection region: a cmd click that merely started a text
selection instead of picking read as a broken row). So a human can
inspect exactly what a launcher runs before picking it, without any edit surface — config files stay the sole
place a `cmd` is written. That endpoint reports the `{ name, harness, cmd, headlessCmd, modes }` list AND the
configured `default` name plus `defaultMode` (`{ launchers, default, defaultMode }`); the `cmd`/`headlessCmd`
ride the payload as read-only display data
for that detail (the dashboard sits behind the deployment's gateway auth). The mobile composer keeps a plain
native select (an option the armed mode can't launch is disabled) — the pop-out is desktop chrome; the mode
switch itself is the same shared component at touch size. The picker's INITIAL selection is always a visible
launcher choice: a still-valid remembered (per-browser) pick wins, else the configured `default`, else the
first real launcher in the list. That last case is not an implicit backend fallback — the dashboard sends the
selected launcher name explicitly. The MODE pick mirrors that exactly: remembered per-browser (`si.mode`,
beside `si.launcher`) → configured `defaultMode` → interactive, and the choice is sent explicitly on the
create body. The two picks are validated as a COMBO, and the invalid combo resolves on the MODE axis, never
the launcher axis: headless armed on a launcher whose `modes` excludes it — a remembered pick the config no
longer honors, or a live toggle attempt on a headless-less launcher — falls back to interactive with an
immediate visible notice naming the launcher, NEVER a silent launcher swap and never a silently armed create
the backend would refuse. The seeded `claude`/`codex` profiles are ordinary selectable entries (and
a default may name one of them), never an implicit no-choice fallback.
A resolved launcher fixes the session's harness; an unknown launcher name is rejected fail-loud (a 400 from
the create path), never silently defaulted. `--harness` and `POST /api/sessions { harness }` are not
create-session inputs; callers use `--launcher <name>` / `{ launcher }`.

The universal actor mention has the same create-time choice: bare `@new` uses `defaultLauncher`, while
`@new:<launcher>` passes that explicit profile name into the SAME `newSession` call. The dashboard's shared
`@` autocomplete makes the choice reachable instead of asking the human to memorize syntax: accepting its
`@new` row opens the configured launcher rows, and accepting one inserts the durable, inspectable
`@new:<launcher>` token into the prose. The qualifier changes only this one spawn; it never changes the
configured default or the New-Session picker's remembered choice. An unknown qualifier is the same loud
create failure as an unknown `--launcher` value, reported in the mention dispatch outcome while the issue
text remains stored.

**Persisted and API-exposed, not badged on the board.** A session's chosen launcher NAME is durable data: it
is stored on the record and rides the session payload (`/api/sessions` + `/api/graph`) alongside its
`harness`, so any surface that needs the launch identity can read it. It is deliberately NOT rendered as a
per-session board badge — a harness glyph + name on every session row read as visual clutter, so the board
stays clean. The wrong-launcher confusion (a human "testing claude-glm" quietly handed another launcher) is
already closed at the point it matters — the create-time picker honoring `defaultLauncher` (above) — not by
after-the-fact badging.

**Two commands, one mode axis (headless).** A launcher may carry TWO complete commands, one per session
MODE: `cmd` — the interactive TUI invocation, its meaning unchanged (existing configs need zero migration) —
and the optional `headlessCmd`, the one-shot headless invocation (empty string reads as absent). Both are
authored WHOLE by the config author; the system embeds them verbatim and never parses or rewrites their
internals. A session's `mode` (`interactive` | `headless`) is a PRODUCT dimension picked at create time
(`--headless` / `--mode` on the CLI, the `mode` field on `POST /api/sessions`; no explicit choice falls to
`sessions.defaultMode`, absent → interactive — headless is opt-in, never a silent flip) and is pinned on the
record BESIDE the command that mode selected, so a resume replays the same command AND mode for the session's
whole life — the resume-launcher-pin extended to the mode axis. The per-mode pin rule: interactive pins `cmd`;
headless on a harness whose headless form needs its own command (`needsCmd`) pins `headlessCmd` — a missing
one fails the create loud, naming the config repair, never falling through to a TUI nobody attends; headless
on a harness whose executor is server-side still pins `cmd` (the executor binary derives from it — version
parity). How a harness runs headless lives ONLY behind the [[harness-adapter]]'s `headless` capability object
(null = no headless form; product code routes per mode, never per harness), and each launcher's available
`modes` are computed BACKEND-side from that capability — interactive always; headless when the capability
exists and, for a needsCmd harness, a `headlessCmd` is configured — riding `GET /api/settings` (with
`headlessCmd` and the configured `defaultMode`) so the frontend consumes availability instead of re-deriving
adapter knowledge. Every create that asks what config/adapter can't honor is a loud 400/CLI error: an unknown
mode, headless on a capability-less harness, a missing needsCmd `headlessCmd`. The chosen mode is durable data
like the launcher name — it rides the session payloads (`/api/sessions`, `/api/graph`, the `:id` detail) and
`spex session ls`/`show` (a quiet `◇` marks headless rows) — and an old record with no mode reads interactive,
leaving every pre-existing path unchanged.

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
