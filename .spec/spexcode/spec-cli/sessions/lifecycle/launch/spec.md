---
title: launch
status: active
hue: 280
desc: Bring a worker up — reclaude wrapper, per-session rendezvous socket, non-truncating prompt, concurrency cap.
related:
  - spec-cli/src/sessions.ts
---

# launch

## raw source

Launching a worker must be **whole and bounded**: the launch prompt arrives complete (never truncated by
the transport), a dispatched agent does **not** silently inherit the project `CLAUDE.md`, and no launch
ever crashes the box — past the concurrency cap a launch **waits its turn** instead of running. And
launching has a **single owner**: the running backend process, never whichever shell happened to type
`spex new` — because the launch env (and the cap) live in the backend, not in the caller.

## expanded spec

`newSession` adds the `node/<slug>` worktree (off the base branch), writes `.session/state` (+ best-effort
the `.session/prompt` sidecar, and at launch the hooks/launch scripts — all under the worktree's `.session/`
runtime dir, [[runtime]]), isolates `CLAUDE.md`, and **queues the worktree for launch** on a private `tmux
-L` socket (`spex new "<prompt>" [--node X]`). `claude` launches with `--session-id
<uuid>` — the id equals the `.session/state` id and the commit attribution, so the conversation `--resume`s
after death and a spec node links to it. Workers run through the **`reclaude` wrapper**
(`SPEXCODE_CLAUDE_CMD`), which runs claude as a **child** rather than exec'ing it, so the pane's foreground
command is the wrapper/shell — **not** a liveness signal ([[state]] reads the socket instead). The spawned
command alone carries `CLAUDE_BG_BACKEND=daemon` and a `CLAUDE_BG_RENDEZVOUS_SOCK` path **derived from the
session id** as an env prefix (never global, never a plugin), so [[dispatch]] addresses only our sockets.

**`CLAUDE.md` isolation:** before claude starts, the worktree's `CLAUDE.md` is *renamed* to
`CLAUDE.spexhidden.md` (still on disk, only hidden from auto-discovery) and pinned `--assume-unchanged`, so
it can never be staged or merged. A rename, never a delete; overridable (`SPEXCODE_HIDE_CLAUDE_MD=0`).

**Non-truncating delivery:** a dispatched agent gets only the human's terse prompt, so every launch and
resume appends a **system prompt** (`--append-system-prompt`) gathered **entirely** from `surface: system`
config nodes — **no baked-in core**. Each active node's body (name order) is concatenated (the
spec-discipline contract lives in the `core` node, rules like `voice-before-ask` alongside it), so editing
any always-on contract is a spec edit, not a code change. The whole invocation is written to the **launch
script file**, so neither contract nor prompt hits the ~2KB tmux send-keys limit. Every path that file and
its hooks reference resolves from the CLI package's **own** on-disk location, never a hardcoded
`<repoRoot>/spec-cli`, so relocating it can't break launch.

**The backend is the single launch owner.** `spex new` / `spex session new` **POST to the running backend**,
so the launch always runs where the launch env and cap live. The caller can be **another agent** whose env
was stripped of `SPEXCODE_CLAUDE_CMD`, so an in-process launch there spawns bare-`claude` workers that
**401 at boot**. The CLI falls back to in-process **only when no backend answers** (warning that it then
carries the caller's env, no cap).

### Concurrency cap (bounded working set)

At most **`SPEXCODE_MAX_ACTIVE`** sessions (default **6**) run as working agents at once. A session holds a
slot while its claude is genuinely live and not yet handed to a human; it frees the slot the moment it
proposes, goes offline, or is closed. A launch beyond the cap lands as a durable **`queued`** worktree
(fully prepared, claude not started, its prompt parked in a `.session-launch` sidecar). A **drainer** starts
queued sessions oldest-first the instant a slot frees — on every slot-freeing server action and on a
periodic tick (catching frees the server never sees: a hook subprocess, a crash). A restart re-drains
survivors. `reopen` relaunches a dead session and **waits for its rendezvous socket** before returning, so
a follow-on [[dispatch]] hits a live socket. `closeSession` is the only removal — human-only, deleting the
worktree and **sweeping the rendezvous socket**, which lives in the tmpdir outside the worktree.
