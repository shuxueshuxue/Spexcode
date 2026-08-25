---
title: stop-resume
status: active
hue: 280
desc: The human-only soft stop and its symmetric resume — stop kills only the session-owned leaf and stamps a durable `stopped` marker; resume relaunches the same conversation only after a fresh, listener-verified proof that the agent is genuinely offline, behind a readiness fence that publishes online state exactly once.
code:
  - spec-cli/src/sessions.ts#stopSessionUnlocked
  - spec-cli/src/sessions.ts#resumeSessionUnlocked
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/commit-gate.test.ts
  - spec-cli/src/harness.ts
---

# stop-resume

Offline is a place a session is put on purpose, not only somewhere it falls. `stop` and `resume` are the two
human-only verbs that move a session across that line without touching what the agent declared ([[state]]);
`close`, the other terminal verb, is [[archive]]'s. The rule this node exists for is the resume guard: a relaunch
is a kill-then-respawn, so it must be impossible against an agent that is alive.

Offline is reachable on purpose, not only by a crash. **`stop`** is the human-only *soft stop* — the inverse
of `resume`: it kills only the adapter-registered **session-owned leaf** plus that session's tmux + rendezvous
socket, but **leaves every project-shared control plane untouched** ([[host-resource-budget]]) and leaves the
worktree, branch, transcript, and global record, then writes only that record's `stopped` liveness marker, so the session reads `offline`
and the relaunch panel offers to `--resume` the same conversation. That durable marker also fences launch
admission: no automatic queue drain, supervisor restart, or idempotent replay may launch a stopped row, including
a prepared row whose lifecycle is still `queued`. The lifecycle fields the agent last authored
survive the stop untouched — whereas a proven-owner `close` removes the worktree AND sweeps the global record dir. **`resume`**
is the inverse
of `stop`, and it is symmetric: it brings the agent back up (relaunching it `--resume`d into the same
conversation only when it is genuinely offline; both frontend relaunch entries invoke this same action) and
clears `stopped` as it restores the runtime and settles the **resting** lifecycle under the SAME active-only
guard `idle` uses — a resumed agent that was `active` (working), or was prepared as `queued` before this explicit
launch, is now just sitting at its prompt → `idle`; a successful readiness publication can never retain `queued`
alongside a live runtime. Every deliberate declaration survives the
resume untouched (`awaiting` and **its proposal**, `asking`, `parked`, `error`). resume deliberately does NOT
touch the proposal: resuming a session that is proposing a merge must not silently withdraw it — proposals are
reversible only by MESSAGING the session (mark-active clears them), never as a hidden side-effect of a relaunch.
So resume never itself makes the agent work; the `merge` dispatch, which resumes ONLY to relaunch a dead agent
so the dispatch hits a live one, then sends the merge prompt — and THAT prompt is what flips the lifecycle to
`active` (and clears the now-obsolete proposal) through mark-active.

Launch handoff is not proof that resume restored liveness. The resolved harness adapter supplies a bounded
readiness fence. Resume persists an internal launch-readiness-pending fence while every public record, list,
API, graph, resources, settings, and timeline projection remains the exact pre-resume stopped/offline state. After the adapter
revalidates the same runtime, target reference, and unique governed owner across that durable boundary, one
final record write clears the pending fence and publishes `stopped:false` plus the real resting lifecycle
transition exactly once. False, throw, timeout, or stale-pending recovery retains/restores the exact original
lifecycle, proposal, and note with no transition event, leaving an offline session that can be retried. Thus
no stale readiness sample or transient `active` to `idle` candidate can become public online state. The frozen
lifecycle and proposal must be members of their closed semantic enums before any public projection accepts the
fence; an unknown string is corrupt/unknown on every surface. A valid pending row always carries offline
liveness and an offline compact display without running live reconciliation, including defensive readings of
an `active`/`idle`, `stopped:false` original while candidate runtime is already live.

**The resume guard — restore-on-alive must be impossible.** Relaunch is a *kill-then-respawn*, so it destroys
a running agent's in-flight work the instant the agent is actually alive. That was the incident's kill-shot:
the board lied (a live worker read `offline`), the human hit relaunch, and live claude processes died mid-task.
So resume re-derives the agent's liveness **freshly** (the same listener-verified probe above, not a possibly-
stale board reading) and **REFUSES LOUD** rather than relaunch a live agent — the API answers `409` and the
dashboard's relaunch panel shows the refusal, never a silent no-op. You steer a live agent by **messaging** it,
not by restoring it. Death must be **proven**: an `unknown` probe (the tmux timeout that starts under load)
also refuses, since a live worker can't be ruled out. A **`force`** escape exists for a genuinely wedged-but-
alive process (the one case where a deliberate kill is the repair). Only a **confirmed `offline`** agent (or
`force`) is relaunched. The `merge` dispatch is the sole non-guarded caller: it merely needs a *live* agent to
send the merge prompt to, so an already-`online` one is a satisfied no-op (never a refusal) and only a
confirmed-offline one is relaunched — the guard protects the human relaunch, not the internal ensure-live.
Contrast **`close`**, the other human-only terminal verb: it proves the same exact cold stop, commits the complete
worktree (including untracked files) into `refs/spex-archive/<id>`, then removes only the worktree while retaining
branch, record, transcript, and conversation identity. An unreadable record proves no owner, so close quarantines
only as evidence and fails before signaling or deletion. A native turn in flight is refused; close has no interrupt
escape. `resume` recreates a missing worktree from the retained branch and reapplies the archive-ref delta before
the normal `starting -> online` path. Both are human-only and direct (not agent proposals); stop is reversible
without removing the worktree, while close is reversible through resume. Their public CLI commands exit nonzero
whenever the backend commits no target transition; printing “no such session” while returning success is a false
state-machine result. A stopped session
occupies no working-set slot ([[launch]]) — offline never does — so the freed capacity drains a queued one. 
