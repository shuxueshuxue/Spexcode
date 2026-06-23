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

The `.session/state` file is the source of truth (never an in-memory map) — one file in the worktree's
`.session/` runtime dir ([[runtime]]). The statuses: `active` (working / undeclared this turn), `awaiting`
(a proposal — review, done, or close-pending, by kind), `parked` (waiting on a background task;
**self-resumes** — nothing for a human to do), `error` (a turn died), `asking` (stopped and **needs the
human** — a question, or the stop-gate's auto-default for an undeclared/uncommitted stop), `queued` (held
below the cap — [[launch]]), and `idle` (stopped at the prompt without declaring). `merges` is a metadata
count, not a state.

`parked` and `asking` split what a single over-loaded `blocked` used to conflate: a self-resuming
background wait (leave it alone) versus a dead stop that won't move until a human nudges it (act on it).
They carry distinct faces, so the board never reads "stuck, needs me" as "fine, self-resuming," or the
reverse — and a still-going `parked` agent is never mistaken for one with something to act on.

**Authored states win over liveness.** `reconcile` maps those authored states straight to their label;
only `active`/`idle` defer to a liveness check, on the **rendezvous socket, never the pane's foreground
command** (see [[launch]]). A session is **offline** only when genuinely dead
(no tmux, or its socket never opened); a still-booting one reads the transient **`starting`** instead.
Else `idle` if the idle-prompt hook fired since the last tool use, else working — the **one inferred
state**, **active-only guarded** so it can never clobber a declaration.

### Hooks (injected per session via `--settings`, polluting nothing)

- **`UserPromptSubmit` + `PreToolUse` → one `mark-active` hook**: it writes **`asking`** on an
  **AskUserQuestion** (the question → the note), else **`active`** — the freshness signal that also flips
  a stale `idle`/`asking` back the moment work resumes.
- **`Stop` → the gate**, two jobs each with a hard loop-break. A **commit gate** rejects a done/merge
  proposal while the branch has uncommitted changes or is 0 ahead of the base branch — ignoring the runtime
  files SpexCode writes into the worktree (the whole `.session/` runtime dir — [[runtime]]); propose-**close**
  is exempt. A **declare gate** blocks a stop while still `active`,
  auto-defaulting on the forced continuation to **`asking`** (the stop needs a human — it never fakes a
  self-resuming `parked`), or to `awaiting`/`nothing` only when the work is actually committed and ahead.
- **`StopFailure` → `error`**; **`Notification(idle_prompt)` → `idle`**. All Stop-gate git goes through
  the shared `git()` helper, so a stray exported git dir can't misdirect repo discovery.

`asking` resumes only on a human prompt (unlike self-resuming `parked`); `idle` is its inferred opposite,
a stop with no declaration. Surfacing an `asking` is the manager's job (see [[graph]]). The lifecycle
writers live in `sessions.ts`; state's only stake in the shared `cli.ts` hub is the `spex session`
declaration commands and the `spex ls` table — a sibling verb's churn there, like the `yatsu` usage line
rewritten in the measure-and-score reframe, moves the file but is not state's drift. A declaration echoes a one-line confirmation — recorded for
the dashboard, after which the next tool call flips the worktree back to `active`, so an agent never reads
that re-flip as a lost proposal.
