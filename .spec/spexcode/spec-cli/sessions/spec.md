---
title: sessions
status: active
hue: 280
desc: Durable worktree sessions — agent-authored state machine, hook gates, watch/ls, board assembler.
code:
  - spec-cli/src/sessions.ts
  - spec-cli/src/board.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/pty-bridge.ts
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

A session also **retains its originating prompt** — the human/manager's launch request — so a manager can
later answer "what was this asked to do?" without transcript archaeology. Prompts are multi-line, so the
prompt lives in its own untracked **sidecar** (`.session-prompt`) written at launch (best-effort, never
blocking), beside the line-based `.session`. It surfaces as `prompt` (full) + `promptPreview` (one-line)
on the `Session` object — flowing to `/api/sessions`, the `spex ls` table, and the `spex watch`
launched/transition events — with `spex session prompt <id>` printing the full text. A session launched
before the sidecar existed simply shows no prompt (best-effort, no error).

### State is agent-authored, not inferred

External hooks only know *something* changed, never the exact transition — and the TUI has too many
special cases to infer reliably. So the agent **writes its own state**; hooks merely gate at boundaries
to force the write. Lifecycle (in `.session`): `active` (working / not yet declared this turn),
`awaiting` (a proposal — `merge`→review, `nothing`→done, `close`→close-pending), `blocked` (waiting on
a background task; self-resumes — never mislabelled idle), `error` (a turn died on an API failure),
`needs-input` (the agent is **pausing to ask the HUMAN a question** — captured deterministically the moment
it invokes the **AskUserQuestion** tool by the `PreToolUse` hook, the question becoming the note, and also
self-declarable via `spex session ask --note <question>`; the note carries the question), and `idle`
(claude has **stopped and is waiting at its prompt without having declared** any of the above). `idle` is
the **one inferred state** — the Notification(`idle_prompt`) hook writes it — so unlike the agent-authored
states it carries a **strict active-only guard** (see below). `needs-input` is distinct from `blocked`:
`blocked` self-resumes when its background task finishes, whereas `needs-input` resumes only when a human
sends the agent a new prompt. The agent-authored states (`awaiting`/`blocked`/`error`/`needs-input`) are
declared, never inferred, and **win over liveness** in `reconcile`. `active` and `idle` are the **same
live agent** — claude is the pane's foreground process whether it is churning or idle-waiting — so they
share `reconcile`'s liveness check: **offline** if the tmux is gone or the pane fell back to a bare shell,
else **idle** if the idle_prompt hook has fired since the last tool use, else **working**. The agent only
ever *proposes*; **merge** and **close** are human-only, every proposal is reversible (back-to-working),
and nothing auto-disappears, so a self-completed session is always findable. `merges` is metadata (a
count, shown as a badge), not a state — after a merge the worktree returns to active.

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
and best-effort (a failure isolating never blocks the launch). Five hooks are injected via a per-worktree
settings file (no global settings touched): **`UserPromptSubmit` + `PreToolUse` → one branching
`mark-active` hook** that reads the payload's `tool_name` and writes **`needs-input`** (the question → the
note) when the tool is **AskUserQuestion**, else **`active`** — the reliable freshness signal (any other
tool use means working; it fires before the tool, so a `spex session done` declaration lands after and
wins, and the next tool flips back to active); **`Stop` → the gate** blocks a stop while still
`active` to force a declaration, with a hard loop-break (on the `stop_hook_active` continuation it
auto-defaults and allows — at most one nudge, never a dead loop, never an undeclared leak);
**`StopFailure` → error**; and **`Notification(idle_prompt)` → idle** (a catch-all hook that keys on the
structured `notification_type` field, so it runs `spex session idle` only on the idle-prompt notification,
not other notifications) marks the session `idle` when claude sits waiting at its prompt. `spex session idle` is **guarded
active-only**: it overwrites `active` → `idle` and no-ops on any other status, so it can never clobber a
deliberate declaration. The mark-active path flips `idle` back to `active` the moment real work resumes,
so the inference is self-correcting.

`needs-input` has **two deterministic writers, neither inferred and neither active-only guarded** — both
are definite signals, not guesses, so each may overwrite freely: (1) the `PreToolUse` mark-active hook
captures it the instant the agent invokes the **AskUserQuestion** tool (reading `tool_name` from the
payload; the first question becomes the note) — AskUserQuestion *is* the agent asking — and (2) the agent
can declare it itself via `spex session ask --note <question>`, offered in the Stop gate's block-reason
menu (alongside `done --propose merge|nothing|close` and `block`), which calls
`markStateFromCwd('needs-input', { note })`. Both write the question as the note. `needs-input` is
deliberately **not** driven by Claude Code's `Notification(idle_prompt)` hook: that hook instead drives the
separate, **inferred** `idle` state — exactly the case neither of the above covers: a stop with **no
declaration at all** (an API error killed the turn before the gate ran, or the brief window between
stopping and declaring). `needs-input` is the agent saying "I'm asking you something"; `idle` is "I
stopped and nobody said why". The active-only guard on `session idle` is what keeps the inferred signal
from ever clobbering this (or any other) deliberate declaration. The mark-active path
(`PreToolUse`/`UserPromptSubmit` → active on any non-AskUserQuestion tool) clears `needs-input` (and
`idle`) back to `active` the moment the agent resumes work / the human sends the next prompt, same as it
clears any other non-active state.
Surfacing is the **manager's** job: a `needs-input` transition is one of the actionable events `spex watch`
emits (carrying the note), and the *spoken* alert on it is the manager's `spex watch` + voice, not the session.

### Surfaces

`buildBoard` (`board.ts`) assembles the dashboard's runtime state — merged tree + per-worktree overlay
(ghosts, edit/delete/move marks, drift) + the session list — in one module, served identically at HTTP
`/api/board` and `spex board` (the frontend only adds x/y pixels). `sessions.ts` holds the whole state
machine and is the only writer of `.session`: `readSessionFile` / `writeSessionFile` (worktrees, not
memory), `reconcile` (authored states→their label; active/idle→working, idle, or offline, where a pane at
a bare shell counts as offline so a crashed claude isn't a false "working"), and the lifecycle writers
`markStateFromCwd` / `markDoneFromCwd` / `markErrorFromCwd` / `markIdleFromCwd` (the last is the
active-only-guarded inferred writer the idle_prompt hook calls). `newSession` adds the `node/<slug>` worktree,
writes `.session`, isolates `CLAUDE.md` (`hideClaudeMd`), and launches claude on the private socket;
`reopen` clears a proposal and `--resume`s a dead pane; the human-only merge/close actions round out the
lifecycle (`closeSession` is the only removal).

The **merge is an INTENT the human expresses, not a fixed server script**. Low-level git operations on the
dashboard do not run server-side: the human acts at the level of intent and the session's OWN agent performs
the operation. So `mergeSession` carries no `git merge` logic of its own — it is a DISPATCH. It reopens the
session (clears the proposal → active, `--resume`s the agent if its tmux died, reusing `reopen`), then
dispatches a merge prompt into the agent (reusing `sendKeys`, which prefers the rendezvous control
socket — see below). The injected prompt tells the agent to merge
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

### Sessions can subscribe to each other (the subscription graph)

Sessions are not only spec-editors — they form a **directed political network**: session A may
**subscribe** to session B (A→B). The edge set is **runtime state**, exactly like `.session` itself, so
it persists with no datastore as **one simple untracked JSON file** in `.worktrees/` (already gitignored)
that survives a backend restart and a page reload. Subscribing is idempotent and a self-edge is rejected.
The graph is served at `GET /api/sessions/graph` as `{ nodes, edges }` — live sessions as nodes (the same
`Session` objects `listSessions` returns) and the persisted directed edges, **pruned to edges whose both
endpoints are still live**, so a closed session (its worktree gone) never leaves a dangling arrow.
`POST /api/sessions/graph/subscribe` and `…/unsubscribe` (`{from,to}`) create and remove one edge. This
lives in `sessions.ts` (it is session-to-session state) and stays isolated from the board assembler —
nothing here touches `buildBoard` or the spec tree. The dashboard's [[session-graph]] view is its surface.

### The live terminal is a real tmux client (`pty-bridge.ts`)

The dashboard's live terminal is not an output tap — it is a genuine **tmux client**. For each session a
single `node-pty` runs `tmux attach-session -t <id>`; that one PTY is the shared terminal for every viewer
(ref-counted), so there is exactly **one client and one authoritative size** (two clients would fight over
the pane size). Viewer input — keystrokes **and** mouse — is written raw into the PTY, so with `mouse on`
the wheel drives tmux copy-mode and the viewer scrolls the **real pane history** (a deep `history-limit`
is set on the socket); a viewer's fit calls `pty.resize`, last fit wins. This replaces the old
`capture-pane`-snapshot **spliced onto** a raw `pipe-pane` byte-tail (the scramble's source — deltas
assumed a screen the snapshot only approximated, and the tail could begin mid-escape-sequence) and the
per-tick SSE poll. A viewer that joins an already running bridge is **not** re-seeded with an out-of-band
`capture-pane` snapshot (splicing that into the mid-flight live stream was the same scramble, now on the
tab-switch path); instead the bridge asks tmux to **`refresh-client`** its own attach client — found by
matching `client_pid` to the PTY's pid and cached — emitting one full **in-band** redraw down the same PTY
the deltas flow on, coherent with them by construction. It reaches every viewer of that shared client (a
brief, harmless re-paint), and the client resets its xterm + re-sends its fitted size on (re)connect. That
single redraw is **deferred until tmux's pane geometry actually equals the viewer's requested size**: on
every (re)attach and every resize the bridge bumps a coalescing token, settles a rapid attach+resize burst
to the final size, **polls `#{pane_width}x#{pane_height}` until it matches** (bounded), and only then fires
**one** `refresh-client`. Repainting before the shrink lands was the tab-switch scramble — the redraw drew
the pre-warm's rows while the screen was still settling to the viewer's, doubling the status bar. The fix
removes the shrink at the source: the supervisor **pre-warms each bridge at the last-known viewer size**
(recorded per session, with a global fallback; a fixed default only for a session no viewer has ever
sized), so a reattach finds the bridge already at the dashboard's pane size. A **supervisor** keeps a warm
bridge for every **detached** live session so opening a tab is instant — it deliberately **skips any
session a human is already attached to** (e.g. the managing session in its own terminal), never adding a
second client that would resize their pane; the dashboard can still open such a session on demand (a
user-initiated choice).
The bridge is exposed over one bidirectional WebSocket (`GET /api/sessions/:id/socket`): binary frames are
pane bytes both ways, a text frame is the `{t:'resize'}` control. `node-pty` needs no compile (it ships
prebuilds); a `postinstall` only restores the `spawn-helper` execute bit npm drops. `captureSession`
stays for `spex capture` (agent-facing pane snapshot); `resizeSession`/`pipe-pane`/SSE are gone.

### Control (input) is a per-session rendezvous socket; tmux is display

Driving a session — sending a prompt, a continue, the merge instruction — is **control**, separate from
the tmux pane, which is **display only** (the live terminal, above). Control goes through a **per-session
rendezvous socket**, not by typing into the pane: at launch the spawned `claude` is given
`CLAUDE_BG_BACKEND=daemon` and a `CLAUDE_BG_RENDEZVOUS_SOCK` path **uniquely derived from the session id**,
set as an env prefix on that one command only — never global/exported, never a plugin or shared setting.
claude opens a unix socket there; writing one line `{"type":"reply","text":…}` injects the text as a
prompt and submits it deterministically — no PTY keystrokes, so multi-line prompts and Enters can't be
corrupted the way `tmux send-keys` could. `sendKeys` prefers this socket: if the session's socket exists it
writes the reply line (the socket both injects **and** submits, so no separate Enter) and returns; for an
older/socketless session, an empty text-only Enter, or any socket error it **falls back unchanged to `tmux
send-keys`** (best-effort — a socket failure never throws). Because the path is derived from the id, only
**our own** sockets are ever addressed: control is strictly scoped to sessions this product launched and
never reaches a Claude Code session outside it. The socket lives in the OS temp dir tied to the claude
process, so it needs no extra lifecycle. `reopen`'s in-pane `--resume` carries the same env prefix, so a
revived agent regains its control socket; `mergeSession` dispatches through this same `sendKeys`.

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
`spex new "<prompt>" [--node X]` is shorthand for `session new`. One thing is deliberately not yet built:
the dashboard's session-log feed is still a mock in `data.js`, not the real `watch` stream.
