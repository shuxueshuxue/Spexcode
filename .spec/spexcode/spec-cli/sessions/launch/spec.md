---
title: launch
status: active
hue: 280
desc: Bring a worker up — reclaude wrapper, per-session rendezvous socket, non-truncating prompt, concurrency cap.
code:
  - spec-cli/src/sessions.ts
---

# launch

## raw source

Launching a worker must be **whole and bounded**: the launch prompt arrives complete (never truncated by
the transport), a dispatched agent does **not** silently inherit the project `CLAUDE.md`, and no launch
ever crashes the box — past the concurrency cap a launch **waits its turn** instead of running.

## expanded spec

`newSession` adds the `node/<slug>` worktree, writes `.session` (and best-effort the `.session-prompt`
sidecar with the originating prompt), isolates `CLAUDE.md`, and **queues the worktree for launch** on a
private `tmux -L` socket; the drainer starts it at once when under the cap (`spex new "<prompt>"
[--node X]` is the shorthand). `claude` launches with `--session-id <uuid>` — the id equals the `.session`
id and the commit attribution, so the same conversation `--resume`s after death and a spec node links to
its live session. Workers run through the **`reclaude` wrapper** (`SPEXCODE_CLAUDE_CMD`), which runs
claude as a **child** rather than exec'ing it, so the pane's foreground command is the wrapper/shell —
deliberately **not** a liveness signal ([[state]] reads the socket instead). The spawned command alone
carries `CLAUDE_BG_BACKEND=daemon` and a `CLAUDE_BG_RENDEZVOUS_SOCK` path **derived from the session id**
as an env prefix — never global, never a plugin — so [[dispatch]] later addresses only our own sockets.

**`CLAUDE.md` isolation:** before claude starts, the worktree's `CLAUDE.md` is *renamed* to
`CLAUDE.spexhidden.md` (still on disk, only hidden from Claude Code auto-discovery) and pinned with `git
update-index --assume-unchanged`, so it can never be staged or merged to main. A rename, never a delete
or `--bare`; overridable (`SPEXCODE_HIDE_CLAUDE_MD=0`), best-effort, never blocking the launch.

**Non-truncating delivery:** because a dispatched agent gets only the human's terse launch prompt, every
launch and resume appends a **system prompt** (`--append-system-prompt`) gathered entirely from the
active `surface: system` config nodes' bodies — no hardcoded base, so a standing contract is a spec
edit, not a code change. It is built fresh per launch and written to the **launch script file** (not a
tmux arg), so neither the contract nor the launch prompt hits the ~2KB tmux limit.

**Self-locating paths:** every path the launch script and its injected hooks reference — the hook
scripts (`stop-gate.sh`, `mark-active.sh`), the `tsx` runner, and `cli.ts` — resolves from the CLI
package's **own** on-disk location (derived from the running module's URL), never from a hardcoded
`<repoRoot>/spec-cli`. Renaming or relocating the package therefore can't break a launch, and no config
knob is introduced for it.

### Concurrency cap (bounded working set)

At most **`SPEXCODE_MAX_ACTIVE`** sessions (default **6**) run as working agents at once. A session holds
a slot while its claude is genuinely live and the work is not yet handed to a human, and frees it the
moment it proposes, goes offline, or is closed. A launch beyond the cap never runs: it lands as a durable
**`queued`** worktree — fully prepared, claude not started, its exact prompt parked in a `.session-launch`
sidecar. A **drainer** starts queued sessions oldest-first the instant a slot frees — on every
slot-freeing server action and on a periodic tick (which catches the frees the server never sees — a hook
subprocess, a crash). `newSession` queues-then-drains; a restart re-drains the survivors. `reopen`
relaunches a session whose claude is gone and **waits for its rendezvous socket** (bounded poll) before
returning, so a follow-on [[dispatch]] addresses a live socket rather than racing the boot. `closeSession`
is the only removal — a human-only action that deletes the worktree and **sweeps the session's rendezvous
socket** (which lives in the tmpdir, outside the worktree), so no stale control endpoint ever lingers.
