---
title: state
status: active
hue: 280
desc: Two orthogonal axes — agent-authored lifecycle and runtime-derived liveness — that never override each other; plus the gating hooks that force the lifecycle write.
code:
  - .spec/spexcode/.config/core/stop-gate/stop-gate.sh
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
per-user GLOBAL store, keyed by the governed **SpexCode session id**. For Claude this is also the harness
`session_id`; for Codex, whose thread id is minted internally and cannot be pinned, the governed record keeps
SpexCode's id as `session_id` and stores the real Codex thread id separately as `harness_session_id` once
the backend's `codex-launch` has completed `thread/start` for that worktree. The layout mirrors Claude's own `~/.claude/projects/<enc>/`: `<SPEXCODE_HOME or
~/.spexcode>/projects/<enc>/sessions/<session_id>/`, where `<enc>` encodes the **project root** (path separators
→ `-`). The project root is the MAIN
checkout (`dirname` of the shared git **common** dir), which resolves identically from main or any linked
worktree — so the board (running at main) and a hook (running in a worktree) compute the **same** dir; resolving
it from `git rev-parse --show-toplevel` would not (in a worktree that is the worktree). The record itself is
`session.json`, written one-field-per-line with every key always present, so the pure-shell hot-path hook
(mark-active) value-replaces `status`/`proposal`/`note` with a single sed and never needs jq. Keying by
session_id, not worktree path, is deliberate: it keeps the worktree **completely clean** (zero SpexCode files —
the launcher products live in the store too, see [[runtime]]) AND gives EACH agent its own record, so a user may
run several claude/codex in one folder without their states clobbering (a path key could not). The board
ENUMERATES this store (`projects/<this-project>/sessions/*`), filtered to `governed:true` and ordered by the
record's stored `createdAt` — it no longer scans `git worktree list`; each row's `worktree_path` (in the record)
is what opens its terminal / diff / live-view. Each record carries a **`governed`** flag: the dashboard launcher
([[sessions-core]]) sets it true; a user-self-launched agent has no governed record (a non-board session). The
`governed` flag is the explicit boundary that the old "is there a `.session/` dir" presence implied — see the
Hooks split below. The statuses: `active` (working / undeclared this turn), `awaiting`
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
  `error`/`asking`/`queued`), never inferred — the `status` value above.
- **liveness** — *whether the agent process is up and addressable*, **derived by the runtime for every
  session regardless of lifecycle**: `offline` (no tmux window for the id, or the harness adapter's online
  signal never became session-addressable — genuinely dead), transient `starting` (window up, adapter signal
  still booting — see [[launch]]), else `online`. Read from the **adapter's runtime signal, never the pane's
  foreground command**: Claude uses its rendezvous socket; Codex uses the shared app-server socket only after
  the governed record has captured the Codex thread id, because a project socket alone is not a session
  address.

The surfaces compose the two without precedence: the badge shows lifecycle, while **liveness `offline`
shows the relaunch panel whatever the lifecycle** — a dead `asking` agent still needs you, now resumable —
the sole exception being `queued`, which has not launched yet and self-starts as a slot frees.

Offline is reachable on purpose, not only by a crash. **`exit`** is the human-only *soft stop* — the inverse
of `reopen`: it kills the agent's tmux + rendezvous socket but **leaves the worktree, branch, transcript, and
the global record**, so the session simply reads `offline` and the relaunch panel offers to `--resume` the same
conversation. Because it touches no `session.json`, the lifecycle the agent last authored survives the stop
untouched — whereas `close` removes the worktree AND sweeps the global record dir. **`reopen`** is the inverse
of `exit`, and it is symmetric: it brings the agent back up (relaunching it `--resume`d into the same
conversation only when it is genuinely offline; the frontend exposes this solely as the offline relaunch panel)
and settles the **resting** lifecycle under the SAME active-only guard `idle` uses — a resumed agent that was
`active` (working) is now just sitting at its prompt → `idle`, while every deliberate declaration survives the
resume untouched (`awaiting` and **its proposal**, `asking`, `parked`, `error`). reopen deliberately does NOT
touch the proposal: resuming a session that is proposing a merge must not silently withdraw it — proposals are
reversible only by MESSAGING the session (mark-active clears them), never as a hidden side-effect of a relaunch.
So reopen never itself makes the agent work; the `merge` dispatch, which reopens ONLY to relaunch a dead agent
so the dispatch hits a live one, then sends the merge prompt — and THAT prompt is what flips the lifecycle to
`active` (and clears the now-obsolete proposal) through mark-active.
Contrast **`close`**, the other human-only terminal verb: it *removes* the worktree, discarding the work. Both
are human-only and direct (not agent proposals); exit is fully reversible (relaunch), close is not. An exited
session occupies no working-set slot ([[launch]]) — offline never does — so the freed capacity drains a queued
one. The one
*inferred* refinement stays orthogonal and narrow: an `online` `active` session reads `idle` if the
idle-prompt hook fired since the last tool use, else working, **active-only guarded** so it never clobbers
a declaration. The compact `DisplayStatus` (the `spex ls` glyph, the row dot) is a **derived label
composing both axes** for one-glyph surfaces — a convenience, never a third source of truth.

### Hooks (delivered via the [[hook-dispatch]] dispatcher, gated by `governed`)

Every hook reads the **effective session id** through the harness resolver. Claude can trust
`SPEXCODE_SESSION_ID` from the governed launcher because its payload id is the same record id. Codex cannot:
hooks run inside the shared per-project app-server, whose env can carry another session's
`SPEXCODE_SESSION_ID`, so Codex hook state starts from the payload `session_id` (the acting thread id) and aliases
that through `harness_session_id` to the governed SpexCode record. That alias is created by the backend launch
path: `spex codex-launch` asks the shared app-server to `thread/start { cwd }`, stores the returned thread id on
the governed record, then fires the first prompt. The global record path is project key from the git common dir →
`<store>/projects/<enc>/sessions/<id>/session.json`.
The hooks split on the `governed` flag. The **board-lifecycle** hooks below (mark-active, the Stop gate,
StopFailure→error, idle) act ONLY when that record reads `governed: true`; on a non-governed (user-self-launched)
record — or none at all — they no-op (the Stop gate exits 0 SILENTLY), because a self-launched agent has no board
to feed, so the Stop gate must NOT misfire its declare-demand. mark-active edits the record directly in shell (the
hot path stays jq-free); the non-hot writers (idle/StopFailure, and the Stop gate's auto-declare) shell to `spex
session … --session <id>` so the TS layer owns the JSON — they pass the id explicitly because there is no worktree
`.session` to fall back on. The **spec-discipline** hooks ([[spec-first]], [[spec-of-file]]) are NOT gated on
`governed` — they serve any agent, keeping their once-per-session sentinel/ledger as sibling files in the same
global session dir (created on demand even for a session with no `session.json`). So board state is a managed-
session concern; spec-awareness is universal.

- **`UserPromptSubmit` + `PreToolUse` → one `mark-active` hook**: it writes **`asking`** on an
  **AskUserQuestion** (the question → the note), else **`active`** — the freshness signal that also flips
  a stale `idle`/`asking` back the moment work resumes.
- **`Stop` → the gate**, two jobs each with a hard loop-break. A **commit gate** rejects a done/merge
  proposal while the branch has uncommitted changes or is 0 ahead of the base branch — and since SpexCode now
  writes NO files into the worktree (the runtime lives in the global store, [[runtime]]), every dirty path is
  genuine work, with no runtime-file filtering to do; propose-**close** is exempt. A **declare gate** blocks a stop while still `active`,
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
the dashboard, after which the next tool call (via mark-active) flips the record back to `active`, so an agent never reads
that re-flip as a lost proposal. A **propose-close** declaration additionally carries a plain reminder to reclaim
the ephemeral things the agent started to test this change — a stray process, a dev/preview server, a bound port,
a scratch session — before the worktree is discarded and they orphan (the leak the shared tmux socket made
visible: a torn-down worktree's own backend outliving it). It is **advisory, a nudge and never a gate** (the agent
checks, then carries on; the next tool call re-flips it to `active`), and **project-agnostic**: the criterion is
whether a resource should outlive the task, never who started it — a deliberately long-running service or a
production build is started-by-you yet left alone, and anything you are unsure about is left running.
