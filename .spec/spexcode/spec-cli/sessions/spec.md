---
title: sessions
status: active
hue: 280
desc: Durable worktree sessions — agent-authored state machine, hook gates, watch/ls, board assembler.
code:
  - spec-cli/src/sessions.ts
  - spec-cli/src/board.ts
  - spec-cli/src/cli.ts
---

# sessions

A SpexCode session is a unit of work the dashboard and an agent's CLI launch, drive, and retire
through the **same** module (the dashboard is a thin caller; `spex` is the CLI). The durable unit is
the **worktree**, not the tmux process: each session worktree carries an untracked `.session` file
(`node` / `session`-id / `status` / `proposal` / `note` / `merges`) that is the source of truth and
survives a kill, reboot, or moving the folder. There is no in-memory map — the list is read from the
worktrees every time, so state survives a backend restart.

## State is agent-authored, not inferred

External hooks only know *something* changed, never the exact transition — and the TUI has too many
special cases to infer reliably. So the agent **writes its own state**; hooks merely gate at boundaries
to force the write. Lifecycle (in `.session`): `active` (working / not yet declared this turn),
`awaiting` (a proposal — `merge`→review, `nothing`→done, `close`→close-pending), `blocked` (waiting on
a background task; self-resumes — never mislabelled idle), and `error` (a turn died on an API failure).
`reconcile` shows `active` as **working** if its tmux is live, else **offline**. The agent only ever
*proposes*; **merge** and **close** are human-only, every proposal is reversible (back-to-working), and
nothing auto-disappears, so a self-completed session is always findable. `merges` is metadata (a count,
shown as a badge), not a state — after a merge the worktree returns to active.

## Hooks (injected per session via `--settings`, polluting nothing)

`claude` launches with `--session-id <uuid>` (so the same conversation `--resume`s after death, and the
id equals the `.session` id and the commit attribution — linking a spec node to its live session) on a
private `tmux -L` socket. Four hooks are injected inline (no global settings touched):
**`PreToolUse` → active** is the reliable freshness signal (any tool use means working; it fires before
the tool, so a `spex session done` declaration lands after and wins); **`UserPromptSubmit` → active**
adds instant feedback when a prompt is sent; **`Stop` → the gate** blocks a stop while still `active`
to force a declaration, with a hard loop-break (on the `stop_hook_active` continuation it auto-defaults
and allows — at most one nudge, never a dead loop, never an undeclared leak); **`StopFailure` → error`.

## Surfaces

`buildBoard` assembles the dashboard's runtime state — merged tree + per-worktree overlay (ghosts,
edit/delete/move marks, drift) + the session list — in one module, served identically at HTTP
`/api/board` and `spex board` (the frontend only adds x/y pixels). For the terminal: `spex ls` is the
human-readable living-sessions table; `spex watch [SEL…]` is the event source for Claude Code's Monitor
tool (one line per actionable transition — review/done/close-pending/offline/error), where each watch
process is one subscriber and the selector is the subscription (many-to-many falls out for free).
