---
title: state
status: active
hue: 280
desc: Two orthogonal axes — agent-authored lifecycle and runtime-derived liveness — that never override each other; plus the gating hooks that force the lifecycle write.
code:
  - spec-cli/hooks/stop-gate.sh
related:
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

The session **state** is the source of truth (never an in-memory map). It lives NOT in the worktree but in a
per-user GLOBAL store `~/.spexcode/sessions/<session_id>/`, keyed by the **harness `session_id`** every hook
payload carries (Claude + Codex). Keying by session_id, not worktree path, is deliberate: it keeps the
worktree clean (no `.session/` pollution) AND gives EACH agent its own record — so a user may run several
claude/codex in one folder without their states clobbering (a path key could not). Each record also carries
a **`governed`** flag: the dashboard launcher ([[sessions-core]]) sets it true; a user-self-launched agent's
record defaults false. `governed` is the explicit boundary that the old "is there a `.session/` dir"
presence implied — see the Hooks split below. The statuses: `active` (working / undeclared this turn), `awaiting`
(a proposal — review, done, or close-pending, by kind), `parked` (waiting on a background task;
**self-resumes** — nothing for a human to do), `error` (a turn died), `asking` (stopped and **needs the
human** — a question, or the stop-gate's auto-default for an undeclared/uncommitted stop), `queued` (held
below the cap — [[launch]]), and `idle` (stopped at the prompt without declaring). `merges` is a metadata
count, not a state.

`parked` and `asking` split what a single over-loaded `blocked` used to conflate: a self-resuming
background wait (leave it alone) versus a dead stop that won't move until a human nudges it (act on it).
They carry distinct faces, so the board never reads "stuck, needs me" as "fine, self-resuming," or the
reverse — and a still-going `parked` agent is never mistaken for one with something to act on.

**Lifecycle and liveness are two orthogonal axes; neither overrides the other.** A session carries two
independent facts, computed independently:

- **lifecycle** — *what the work needs*, **authored by the agent** (`active`/`idle`/`awaiting`/`parked`/
  `error`/`asking`/`queued`), never inferred — the `.session/state` value above.
- **liveness** — *whether the agent process is up*, **derived by the runtime for every session regardless
  of lifecycle**: `offline` (no tmux window for the id, or its rendezvous socket never opened — genuinely
  dead), transient `starting` (window up, socket still booting — see [[launch]]), else `online`. Read from
  the **rendezvous socket, never the pane's foreground command**: claude holds the socket open while it
  lives; the pane command is the wrapper/shell.

The surfaces compose the two without precedence: the badge shows lifecycle, while **liveness `offline`
shows the relaunch panel whatever the lifecycle** — a dead `asking` agent still needs you, now resumable —
the sole exception being `queued`, which has not launched yet and self-starts as a slot frees.

Offline is reachable on purpose, not only by a crash. **`exit`** is the human-only *soft stop* — the inverse
of `reopen`: it kills the agent's tmux + rendezvous socket but **leaves the worktree, branch, and transcript**,
so the session simply reads `offline` and the relaunch panel offers to `--resume` the same conversation.
Because it touches no `.session/state`, the lifecycle the agent last authored survives the stop untouched.
Contrast **`close`**, the other human-only terminal verb: it *removes* the worktree, discarding the work. Both
are human-only and direct (not agent proposals); exit is fully reversible (relaunch), close is not. An exited
session occupies no working-set slot ([[launch]]) — offline never does — so the freed capacity drains a queued
one. The one
*inferred* refinement stays orthogonal and narrow: an `online` `active` session reads `idle` if the
idle-prompt hook fired since the last tool use, else working, **active-only guarded** so it never clobbers
a declaration. The compact `DisplayStatus` (the `spex ls` glyph, the row dot) is a **derived label
composing both axes** for one-glyph surfaces — a convenience, never a third source of truth.

### Hooks (delivered via the [[hook-dispatch]] dispatcher, gated by `governed`)

The hooks split on the `governed` flag. The **board-lifecycle** hooks below (mark-active, the Stop gate,
StopFailure→error, idle) act ONLY when the session's record is `governed: true`; on a non-governed
(user-self-launched) record they no-op — a self-launched agent has no board to feed, so the Stop gate must
NOT misfire its declare-demand. The **spec-discipline** hooks ([[spec-first]], [[spec-of-file]]) are NOT
gated on `governed` — they serve any agent, using the global session record for their once-per-session
sentinel/ledger. So board state is a managed-session concern; spec-awareness is universal.

- **`UserPromptSubmit` + `PreToolUse` → one `mark-active` hook**: it writes **`asking`** on an
  **AskUserQuestion** (the question → the note), else **`active`** — the freshness signal that also flips
  a stale `idle`/`asking` back the moment work resumes.
- **`Stop` → the gate**, two jobs each with a hard loop-break. A **commit gate** rejects a done/merge
  proposal while the branch has uncommitted changes or is 0 ahead of the base branch — ignoring the runtime
  files SpexCode writes into the worktree (the whole `.session/` runtime dir — [[runtime]]); propose-**close**
  is exempt. A **declare gate** blocks a stop while still `active`,
  auto-defaulting on the forced continuation to **`asking`** (the stop needs a human — it never fakes a
  self-resuming `parked`), or to `awaiting`/`nothing` only when the work is actually committed and ahead.
  The block reason gives each option its **application condition**, not a menu: a state is a claim others
  act on, so the agent picks the TRUE one. **`parked` is policed hardest** — claim it only when a real
  background task will wake you; with nothing running to resume you the stop is `asking`, never a false
  `parked` the board misreads as self-resuming while you actually need the human.
- **`StopFailure` → `error`**; **`Notification(idle_prompt)` → `idle`**. All Stop-gate git goes through
  the shared `git()` helper, so a stray exported git dir can't misdirect repo discovery.

`asking` resumes only on a human prompt (unlike self-resuming `parked`); `idle` is its inferred opposite,
a stop with no declaration. Surfacing an `asking` is the manager's job (see [[graph]]). The lifecycle
writers live in `sessions.ts`; state's only stake in the shared `cli.ts` hub is the `spex session`
declaration commands and the `spex ls` table — a sibling verb's churn there, like the `yatsu` usage line
rewritten in the measure-and-score reframe, moves the file but is not state's drift. A declaration echoes a one-line confirmation — recorded for
the dashboard, after which the next tool call flips the worktree back to `active`, so an agent never reads
that re-flip as a lost proposal.
