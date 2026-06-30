---
title: launch
status: active
hue: 280
desc: Bring a worker up — adapter launch, bounded prompt delivery, concurrency cap.
related:
  - spec-cli/src/sessions.ts
---

# launch

## raw source

Launching a worker must be **whole and bounded**: the launch prompt arrives complete (never truncated by
the transport), the spec-discipline contract reaches the agent through **materialized auto-discovered files**
(so a dispatched agent loads its own `CLAUDE.md` + memory normally — the same launch a user takes, never a
hidden or moved-away `CLAUDE.md`), and no launch
ever crashes the box — past the concurrency cap a launch **waits its turn** instead of running. And
launching has a **single owner**: the running backend process, never whichever shell happened to type
`spex new` — because the launch env (and the cap) live in the backend, not in the caller.

## expanded spec

`newSession` mints the governed SpexCode session `<uuid>`, adds the `node/<slug>` worktree (off the base branch), then writes
the session's `governed:true` record `session.json` (+ best-effort the `prompt` artifact, and at launch the
`launch.sh` script) into the GLOBAL per-session store ([[runtime]]) — NOT the worktree, which stays
pristine — `materialize`s the spec-discipline contract into the worktree's own `CLAUDE.md`/`AGENTS.md`
([[harness-delivery]]), and **queues the worktree for launch** on a private
`tmux -L` socket (`spex new "<prompt>" [--node X]`). The selected [[harness-adapter]] owns the actual agent
command. Claude launches with `--session-id <uuid>` — the SAME id the record is keyed by, the tmux window name,
the rendezvous socket, and the commit attribution, so the conversation `--resume`s after death, the board maps
it to its worktree, and a spec node links to it. Codex launches a visible TUI attached to the project's shared
`codex app-server --listen unix://<runtimeRoot>/codex-app-server.sock`; its Codex thread id is captured later
into `harness_session_id` because Codex does not let the launcher pin a new thread id. Workers run through the **`reclaude` wrapper**
(`SPEXCODE_CLAUDE_CMD`), which runs claude as a **child** rather than exec'ing it, so the pane's foreground
command is the wrapper/shell — **not** a liveness signal ([[state]] reads the socket instead). The spawned
command alone carries `CLAUDE_BG_BACKEND=daemon` and a `CLAUDE_BG_RENDEZVOUS_SOCK` path **derived from the
session id** as an env prefix (never global, never a plugin), so [[dispatch]] addresses only our sockets.
Codex's app-server launch is project-idempotent: simultaneous `spexcode serve` processes in the same project
share the runtime socket and take a per-project launch lock before starting the server, so they do not fan out
one app-server per session or cross into another project's socket.

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

**The launch is project-bound; the route is not — so the launch guards its project.** A launch builds the
worktree under the backend's OWN `mainRoot`, but the route to a backend is a bare URL (`SPEXCODE_API_URL`,
else the local-port default) carrying no project identity. So a **stale inherited `SPEXCODE_API_URL`** pointing
at another repo's backend would silently land the session in the WRONG repo — the exact decoupling the
[[remote-client]] *read/control* verbs exploit on purpose (point anywhere to monitor any machine) becomes a
correctness hole the moment the verb *mutates*. The fix lives at the client launch seam: before POSTing,
`spex new` compares the **caller's cwd repo root** to the backend's **served root** (`GET /api/layout` `.main`)
and **refuses, loud**, on a provable same-host mismatch — `cwd is in <A> but the backend serves <B>`, with the
repair (`cd <A> && spex serve`, or point the env at it). It fires only on a positive mismatch: no local repo,
an unreachable backend, or a served root that isn't a resolvable local path (a genuinely remote backend) all
fall through to allow, so legit cross-machine dispatch and the viewer-points-anywhere model stay intact. This
is the same FAIL-LOUD-never-silent-fallback rule [[remote-client]] states, applied to launch: a mutating verb
must never silently act on the wrong project.

**Resilient bring-up.** A launcher can lose a transient startup race — the `reclaude` daemon flapping on a
version skew — and exit within seconds, before the rendezvous socket ever appears: a fast exit that is the
race, not the work. The launch script therefore **retries a bounded number of times on a fast exit** and
stops the instant the agent has run past the boot window, so a normal long-lived session is never relaunched
on its eventual exit. The boot grace and the ready-wait both span this retry window, so liveness reads
`starting` and the concurrency slot stays held until the worker is genuinely online — or truly dead. This
only closes the startup race; it adds no fallback and never masks a dead agent.

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
