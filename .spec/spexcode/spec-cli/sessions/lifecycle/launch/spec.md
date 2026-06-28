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

`newSession` mints the session `<uuid>`, adds the `node/<slug>` worktree (off the base branch), then writes
the session's `governed:true` record `session.json` (+ best-effort the `prompt` artifact, and at launch the
hooks.json/launch.sh scripts) into the GLOBAL per-session store ([[runtime]]) — NOT the worktree, which stays
pristine — isolates `CLAUDE.md` (moved into the store too), and **queues the worktree for launch** on a private
`tmux -L` socket (`spex new "<prompt>" [--node X]`). `claude` launches with `--session-id <uuid>` — the SAME id
the record is keyed by, the tmux window name, the rendezvous socket, and the commit attribution, so the
conversation `--resume`s after death, the board maps it to its worktree, and a spec node links to it. Workers run through the **`reclaude` wrapper**
(`SPEXCODE_CLAUDE_CMD`), which runs claude as a **child** rather than exec'ing it, so the pane's foreground
command is the wrapper/shell — **not** a liveness signal ([[state]] reads the socket instead). The spawned
command alone carries `CLAUDE_BG_BACKEND=daemon` and a `CLAUDE_BG_RENDEZVOUS_SOCK` path **derived from the
session id** as an env prefix (never global, never a plugin), so [[dispatch]] addresses only our sockets.

**Materialized delivery, not injection:** the spec-discipline contract is NOT pushed on the command line.
Before the agent starts, the worktree is `materialize`d ([[harness-delivery]]), rendering the `surface: system`
bodies (name order — the `core` node + rules like `voice-before-ask` alongside it) into the `<spexcode>`
managed block of the worktree's `CLAUDE.md`/`AGENTS.md`, plus the dispatch shims. The agent then launches
**plainly** and **auto-discovers** them — the SAME path a user-self-launched agent takes — so editing any
always-on contract is a spec edit, not a code change. There is **no `--append-system-prompt` and no `--settings`**.
`CLAUDE.md` is **no longer hidden** (the old rename-to-`CLAUDE.spexhidden.md` isolation is gone): hiding it
also suppressed the agent's own MEMORY load, so with the contract delivered by discovery the agent loads its
`CLAUDE.md` + memory normally. Only the launch line itself (rendezvous env + harness command + the human
prompt + spec pointer) is written to the **launch script file** in the global store, so a long prompt never
hits the ~2KB tmux send-keys limit. Every path that file and its hooks reference resolves from the CLI
package's **own** on-disk location, never a hardcoded `<repoRoot>/spec-cli`, so relocating it can't break launch.

**The backend is the single launch owner.** `spex new` / `spex session new` **POST to the running backend**,
so the launch always runs where the launch env and cap live. The caller can be **another agent** whose env
was stripped of `SPEXCODE_CLAUDE_CMD`, so an in-process launch there spawns bare-`claude` workers that
**401 at boot**. The CLI falls back to in-process **only when no backend answers** (warning that it then
carries the caller's env, no cap).

### Concurrency cap (bounded working set)

At most **N** agents run **autonomously progressing** at once — **N configured per project in `spexcode.json`
(`sessions.maxActive`, default 6)**, not hardcoded, read live so an edit applies on the next drain (the
`SPEXCODE_MAX_ACTIVE` env is a fallback). A slot is **compute** pressure: a session holds one **only while
live AND `working` or `parked`** (self-resuming). Everything **waiting on the human frees its slot** — `idle`,
`asking`, and the proposals (review/done/close-pending) — like offline/closed, since they burn no compute and
must never block a launch. A launch beyond the cap lands as a durable **`queued`** worktree
(fully prepared, claude not started, its prompt parked as the `launch` artifact in the global store). A **drainer** starts
queued sessions oldest-first the instant a slot frees — on every slot-freeing server action and on a
periodic tick (catching frees the server never sees: a hook subprocess, a crash). A restart re-drains
survivors. `reopen` relaunches a dead session and **waits for its rendezvous socket** before returning, so
a follow-on [[dispatch]] hits a live socket. `closeSession` is the only removal — human-only, deleting the
worktree, **sweeping the rendezvous socket** (in the tmpdir), and removing the session's global record dir.
