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
a background task; self-resumes — never mislabelled idle), `error` (a turn died on an API failure), and
`needs-input` (the agent **deliberately declared it is pausing to ask the HUMAN a question** — via `spex
session ask --note <question>`, typically at the Stop gate; the note carries the question). `needs-input`
is distinct from `blocked`: `blocked` self-resumes when its background task finishes, whereas
`needs-input` resumes only when a human sends the agent a new prompt. Like `awaiting`/`blocked`/`error`
it is an **agent-authored** state (declared, never inferred) that **wins over liveness** in `reconcile`.
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
auto-defaults and allows — at most one nudge, never a dead loop, never an undeclared leak); and
**`StopFailure` → error**.

`needs-input` is **not** wired to a hook — it is **agent-authored** via `spex session ask --note
<question>`, offered as a fourth option in the Stop gate's block-reason menu (alongside `done --propose
merge|nothing|close` and `block`). When the agent stops to ask the human a question, it picks `ask`; this
calls `markStateFromCwd('needs-input', { note })` — a deliberate declaration like `done`/`block`, so
(unlike the other authored states' inference-proofing) it carries **no active-only guard**: the agent is
the authority on what its stop means. The note carries the question. An earlier design wired this to
Claude Code's **GLOBAL `Notification(idle_prompt)` hook**, but that was **removed as inert**: the Stop gate
forces a stop-time declaration, so a question-asking agent always declares `done` (awaiting/nothing)
*before* `idle_prompt` could fire, and the old hook's active-only guard then no-op'd — the session never
reached `needs-input`. Moving the trigger to the gate itself is what makes it actually fire (verified
end-to-end). The mark-active path (`PreToolUse`/`UserPromptSubmit` → active) clears `needs-input` back to
`active` the moment the human sends the next prompt, same as it clears any other non-active state.
Surfacing is the **manager's** job: a `needs-input` transition is one of the actionable events `spex watch`
emits (carrying the note), and the *spoken* alert on it is the manager's `spex watch` + voice, not the session.

### Surfaces

`buildBoard` (`board.ts`) assembles the dashboard's runtime state — merged tree + per-worktree overlay
(ghosts, edit/delete/move marks, drift) + the session list — in one module, served identically at HTTP
`/api/board` and `spex board` (the frontend only adds x/y pixels). `sessions.ts` holds the whole state
machine and is the only writer of `.session`: `readSessionFile` / `writeSessionFile` (worktrees, not
memory), `reconcile` (awaiting→proposal label; active→working or offline, where a pane at a bare shell
counts as offline so a crashed claude isn't a false "working"), and the lifecycle writers
`markStateFromCwd` / `markDoneFromCwd` / `markErrorFromCwd`. `newSession` adds the `node/<slug>` worktree,
writes `.session`, isolates `CLAUDE.md` (`hideClaudeMd`), and launches claude on the private socket;
`reopen` clears a proposal and `--resume`s a dead pane; the human-only merge/close actions round out the
lifecycle (`closeSession` is the only removal).

The **merge is an INTENT the human expresses, not a fixed server script**. Low-level git operations on the
dashboard do not run server-side: the human acts at the level of intent and the session's OWN agent performs
the operation. So `mergeSession` carries no `git merge` logic of its own — it is a DISPATCH. It reopens the
session (clears the proposal → active, `--resume`s the agent if its tmux died, reusing `reopen`), then
send-keys a merge prompt into the agent (reusing `sendKeys`). The injected prompt tells the agent to merge
its branch into main, resolve any conflicts itself (it knows the intent of the work), verify that main's
HEAD actually advanced and that no merge is left in progress, run `git merge --abort` to restore main if
anything goes half-merged, and propose close once the merge is verified. Because the agent performs and
verifies the merge, main is never left half-merged and a no-op is never miscounted as a merge — the
guarantee lives in the agent's verification, not a server check. The action is **async**: `POST
/api/sessions/:id/merge` returns 200 `{ dispatched: true }` as soon as the prompt is sent (409 only if the
session/agent is unreachable); the agent does the work and re-proposes or closes when done. The server no
longer bumps `merges` on a click — if a merge count is still wanted it is the agent's to record after a
verified merge. (This prompt-dispatch pattern is currently scoped to merge; other low-level ops generalize
to it later.)

For the terminal: `spex ls` is the human-readable living-sessions table — a column header, each session's
truncated note/prompt, and a glyph→meaning legend (`statusLegend`, built from `STATUS_GLYPH` so it can't
drift). `spex watch [SEL…]` is the event source for Claude Code's Monitor tool (`watchSessions` emits the
**complete session lifecycle** — not only actionable transitions). A session's **first sighting** emits a
`launched` event, even though a launch enters at `working` (which is not actionable); without it the feed
would be blind to new sessions starting. It is emitted **once** per id (never re-fired on subsequent polls,
so working/idle toggles don't flap). On top of that it emits each actionable transition
(review/done/close-pending/offline/error/needs-input) and the removal (`closed`), so the net feed is
`launched → [actionable transitions] → closed` — a true "subscribe to all session changes" stream for a
super-manager. Each watch process is one subscriber and the selector is the subscription (many-to-many
falls out for free). The `cli.ts` surface is
tuned for both humans and agents: no-args (or `spex help`) prints a grouped one-screen command summary, and
`spex new "<prompt>" [--node X]` is shorthand for `session new`. Two things are deliberately not yet built:
liveness has no true `idle` tier (reconcile reports only working/offline for an active session), and the
dashboard's session-log feed is still a mock in `data.js`, not the real `watch` stream.
