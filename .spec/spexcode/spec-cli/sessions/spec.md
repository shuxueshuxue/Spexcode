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

## raw source

A SpexCode **session** is a unit of work the dashboard and the CLI launch, drive, and retire through
**one shared module** (the dashboard is a thin caller; `spex` is the CLI). Make the **worktree** the
durable thing, not the tmux process — a session must survive a kill, a reboot, or a moved folder. The
**agent writes its own state**; it may only *propose* merge or close, and a **human** makes those
calls. Nothing a session does should auto-disappear: a self-finished session stays findable. The
dashboard and the terminal are two faces of the **same** state.

## expanded spec

The durable unit is the worktree, not the tmux process: each session worktree carries an untracked
`.session` file (`node` / `session`-id / `status` / `proposal` / `note` / `merges`) that is the source
of truth and survives a kill, reboot, or moving the folder. There is no in-memory map — the list is
read from the worktrees every time, so state survives a backend restart.

### State is agent-authored, not inferred

External hooks only know *something* changed, never the exact transition — and the TUI has too many
special cases to infer reliably. So the agent **writes its own state**; hooks merely gate at boundaries
to force the write. Lifecycle (in `.session`): `active` (working / not yet declared this turn),
`awaiting` (a proposal — `merge`→review, `nothing`→done, `close`→close-pending), `blocked` (waiting on
a background task; self-resumes — never mislabelled idle), and `error` (a turn died on an API failure).
`reconcile` shows `active` as **working** if its tmux is live, else **offline**. The agent only ever
*proposes*; **merge** and **close** are human-only, every proposal is reversible (back-to-working), and
nothing auto-disappears, so a self-completed session is always findable. `merges` is metadata (a count,
shown as a badge), not a state — after a merge the worktree returns to active.

### Hooks (injected per session via `--settings`, polluting nothing)

`claude` launches with `--session-id <uuid>` (so the same conversation `--resume`s after death, and the
id equals the `.session` id and the commit attribution — linking a spec node to its live session) on a
private `tmux -L` socket. A dispatched agent runs with full SpexCode control over its own behavior, so it
must **not** auto-inherit the project `CLAUDE.md` the way the managing session does: at launch (before
`claude` starts) the worktree's `CLAUDE.md` is renamed to `CLAUDE.spexhidden.md` — still on disk and
readable, only renamed so Claude Code's auto-discovery skips it — and the tracked path is pinned with
`git update-index --assume-unchanged CLAUDE.md` so that rename is invisible to git and can never be
staged/committed/merged back to main. This is a rename, never a delete and never `--bare`, so auth, the
hooks, and the repo all keep working; it is overridable (`SPEXCODE_HIDE_CLAUDE_MD=0`) and on by default,
and best-effort (a failure isolating never blocks the launch). Four hooks are injected via a per-worktree
settings file (no global settings touched): **`PreToolUse` → active** is the reliable freshness signal (any tool use means working; it
fires before the tool, so a `spex session done` declaration lands after and wins); **`UserPromptSubmit`
→ active** adds instant feedback when a prompt is sent; **`Stop` → the gate** blocks a stop while still
`active` to force a declaration, with a hard loop-break (on the `stop_hook_active` continuation it
auto-defaults and allows — at most one nudge, never a dead loop, never an undeclared leak);
**`StopFailure` → error**.

### Surfaces

`buildBoard` (`board.ts`) assembles the dashboard's runtime state — merged tree + per-worktree overlay
(ghosts, edit/delete/move marks, drift) + the session list — in one module, served identically at HTTP
`/api/board` and `spex board` (the frontend only adds x/y pixels). `sessions.ts` holds the whole state
machine and is the only writer of `.session`: `readSessionFile` / `writeSessionFile` (worktrees, not
memory), `reconcile` (awaiting→proposal label; active→working or offline, where a pane at a bare shell
counts as offline so a crashed claude isn't a false "working"), and the lifecycle writers
`markStateFromCwd` / `markDoneFromCwd` / `markErrorFromCwd`. `newSession` adds the `node/<slug>` worktree,
writes `.session`, isolates `CLAUDE.md` (`hideClaudeMd`), and launches claude on the private socket;
`reopen` clears a proposal and `--resume`s a dead pane; the human-only `mergeSession` (`--no-ff`, bump
`merges`, back to active) and `closeSession` (the only removal) round out the lifecycle.

For the terminal: `spex ls` is the human-readable living-sessions table — a column header, each session's
truncated note/prompt, and a glyph→meaning legend (`statusLegend`, built from `STATUS_GLYPH` so it can't
drift). `spex watch [SEL…]` is the event source for Claude Code's Monitor tool (`watchSessions` emits one
line per actionable transition — review/done/close-pending/offline/error), where each watch process is one
subscriber and the selector is the subscription (many-to-many falls out for free). The `cli.ts` surface is
tuned for both humans and agents: no-args (or `spex help`) prints a grouped one-screen command summary, and
`spex new "<prompt>" [--node X]` is shorthand for `session new`. Two things are deliberately not yet built:
liveness has no true `idle` tier (reconcile reports only working/offline for an active session), and the
dashboard's session-log feed is still a mock in `data.js`, not the real `watch` stream.
