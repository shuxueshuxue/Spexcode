---
title: state
status: active
hue: 280
desc: The lifecycle state machine — declared statuses, gating hooks, socket liveness; agent-authored, never inferred.
code:
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
---

# state

## raw source

External hooks only know *something* changed, never the exact transition, and the TUI is too special-
cased to infer reliably. So the **agent writes its own state**; hooks merely gate at boundaries to force
the write. The agent only ever *proposes* — **merge and close are human-only**, every proposal is
reversible, and nothing auto-disappears.

## expanded spec

The `.session` file is the source of truth (`readSessionFile` / `writeSessionFile`; never an in-memory
map). Statuses: `active` (working / undeclared this turn), `awaiting` (a proposal — `merge`→review,
`nothing`→done, `close`→close-pending), `blocked` (on a background task; self-resumes), `error` (a turn
died), `needs-input` (pausing to ask the **human**), `queued` (held below the cap — [[launch]]), and
`idle` (stopped at the prompt without declaring). `merges` is a metadata count, not a state.

**Authored states win over liveness.** `reconcile` maps `awaiting`/`blocked`/`error`/`needs-input`
straight to their label; only `active`/`idle` defer to a liveness check, and that check is the
**rendezvous socket, never the pane's foreground command** (the worker runs under `reclaude`; see
[[launch]]). A session is **offline** if its tmux or socket is gone, else `idle` if the idle-prompt hook
fired since the last tool use, else working. `idle` is the **one inferred state**, so `markIdleFromCwd`
is **active-only guarded** and can never clobber a declaration.

### Hooks (injected per session via `--settings`, polluting nothing)

- **`UserPromptSubmit` + `PreToolUse` → one `mark-active` hook** reads `tool_name`: it writes
  **`needs-input`** (the question → the note) on **AskUserQuestion**, else **`active`** — the freshness
  signal that also flips `idle`/`needs-input` back the moment work resumes.
- **`Stop` → the gate**, two jobs each with a hard loop-break. A **commit gate** rejects a done/merge
  proposal while the branch has uncommitted changes or is 0 ahead of main (ignoring SpexCode's runtime
  files — `.session`, `.session-prompt`, `.spex-hooks.json`, `CLAUDE.spexhidden.md`); propose-**close**
  is exempt. A **declare gate** blocks a stop while still `active`, auto-defaulting on the forced
  continuation (honest `blocked`, or `awaiting`/`nothing` when committed) — one nudge, never a leak.
- **`StopFailure` → `error`**; **`Notification(idle_prompt)` → `idle`** (keys on `notification_type`).
  All Stop-gate git runs through `git.ts`'s `git()` so an exported `GIT_DIR` can't misdirect discovery.

`needs-input` has **two** deterministic writers (neither inferred nor guarded) — the `PreToolUse`
capture and the agent's own `spex session ask --note` — and resumes only on a human prompt, unlike
self-resuming `blocked`; `idle` is the inferred opposite, a stop with no declaration at all. Surfacing a
`needs-input` is the manager's job via [[graph]]'s `spex watch`. The lifecycle writers
(`markStateFromCwd` and the `markDone`/`markError`/`markIdle` variants) live in `sessions.ts`; the `spex
session done|ask|block|idle` commands and the `spex ls` table are their `cli.ts` surface.
