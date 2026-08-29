---
title: state
status: active
hue: 280
desc: Two orthogonal axes — agent-authored lifecycle and runtime-derived liveness — that never override each other; plus the gating hooks that force the lifecycle write.
code:
  - .spec/spexcode/.plugins/core/stop-gate/stop-gate.sh
related:
  - spec-cli/src/commit-gate.test.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/hook-prompts.ts
  - spec-cli/src/follow-cli.api.test.ts
---

# state

## raw source

External hooks only know *something* changed, never the exact transition, and the TUI is too special-
cased to infer reliably. So the **agent writes its own state**; hooks merely gate at boundaries to force
the write. The agent only ever *proposes* — **merge and close are human-only**, every proposal is
reversible, and nothing auto-disappears.

## expanded spec

The session **state** is the source of truth (never an in-memory map). After the SQLite cutover it lives in the
canonical session application. The sibling JSON file is only the runtime/worktree envelope and migration evidence;
it is not a second lifecycle authority. It lives in the per-user global store keyed by the governed session id ([[runtime]]), so each agent has its own
record and the worktree stays pristine; a record's `governed` flag is the explicit board boundary a self-launched
agent lacks (see Hooks below). The statuses: `active` (working / undeclared this turn), `awaiting`
(a proposal — review or close-pending; historical `nothing` records remain readable as done), `parked` (waiting on a managed watch delivery or background task;
**self-resumes** — nothing for a human to do), `error` (a turn died), `asking` (stopped and **needs the
human** — a question, a reported finding/recommendation awaiting a decision, or the stop-gate's auto-default for an undeclared/uncommitted stop), `queued` (held
below the cap — [[launch]]), and `idle` (stopped at the prompt without declaring). `merges` is a metadata
count, not a state.

`parked` and `asking` split what a single over-loaded `blocked` used to conflate: a self-resuming
background wait (leave it alone) versus a dead stop that won't move until a human nudges it (act on it).
They carry distinct faces, so the board never reads "stuck, needs me" as "fine, self-resuming," or the
reverse — and a still-going `parked` agent is never mistaken for one with something to act on.

**Lifecycle and liveness are two orthogonal axes; neither overrides the other.** A session carries two
independent facts, computed independently (the human's `archived` close projection is orthogonal to BOTH and
owned by [[archive]] — it never reads as a status and never rewrites one):

- **lifecycle** — *what the work needs*, **authored by the agent** (`active`/`idle`/`awaiting`/`parked`/
  `error`/`asking`/`queued`), never inferred — the `status` value above.
- **liveness** — *whether the adapter considers the durable session addressable*, **derived by the runtime for every
  session regardless of lifecycle**: `offline` (no tmux window for the id, or the harness adapter's online
  signal never became session-addressable — genuinely dead), transient `starting` (window up, adapter signal
  still booting — see [[launch]]), `unknown` (the liveness PROBE ITSELF failed — see below), else `online`.
  How each adapter derives it — the two probe tiers, the tri-state listener test, the second witness, and the
  honesty rule under load (a failed probe is `unknown`, never a death) — is [[liveness]]'s.

The surfaces compose the two without precedence: the badge shows lifecycle, while **liveness `offline`
exposes resume through both the relaunch panel and the console toolbar's compact relaunch tool whatever the
lifecycle** — a dead `asking` agent still needs you, now resumable — the sole exception being `queued`, which
has not launched yet and self-starts as a slot frees. `unknown` (probe-failed) exposes neither relaunch entry:
we have not proven the agent dead, so we must not invite a restore that could kill a live worker.

The **review** reading (an `awaiting` proposal, as the board and `spex watch` surface it) is the
orthogonality in one example: review means the agent has *stopped active work* — mark-active flips it
back to `active` on any agent tool action — and says nothing about liveness. Done-but-alive reads
review+`online` (process alive, rendezvous socket open, the terminal mounts); done-exited reads
review+`offline` (the relaunch panel). A stable review+`online` session genuinely exists — a doer
proposes, then idles awaiting the merge — not just a test artifact.

Offline is reachable on purpose: the human-only `stop`/`resume` pair, resume's readiness fence, and the guard
that makes restore-on-alive impossible are [[stop-resume]]'s; `close` is [[archive]]'s. A stopped session
occupies no working-set slot ([[launch]]) — offline never does — so the freed capacity drains a queued one. The one
*inferred* refinement stays orthogonal and narrow: an `online` `active` session reads `idle` if the
idle-prompt hook fired since the last tool use, else working, **active-only guarded** so it never clobbers
a declaration. The compact `DisplayStatus` (the `spex ls` glyph, the row dot) is a **derived label
composing both axes** for one-glyph surfaces — a convenience, never a third source of truth.

A published close is the one terminal refinement: when `closedAt` is non-null, public projections read `retired`
and clear any pre-close proposal, while the canonical lifecycle settles to its internal `archived` terminal marker.
Legacy archived rows without `closedAt` retain the historical `offline` display because their close time is unknown.

### Hooks (delivered via the [[hook-dispatch]] dispatcher, gated by `governed`)

Every hook resolves the acting session id through the harness resolver — payload first, launched id as fallback,
Codex thread ids aliased through `harness_session_id` ([[hook-shell-mirror]], [[identity-injection]]) — and
writes lifecycle only through the canonical application, never through the runtime envelope.
The hooks split on the canonical application's session address, not on an envelope grep. The **board-lifecycle**
hooks below (mark-active, the Stop gate, StopFailure→error, idle) ask the canonical writer whether the session is
governed; a non-governed (user-self-launched) record — or none at all — no-ops (the Stop gate exits 0 SILENTLY),
because a self-launched agent has no board to feed. The hook shell never reads `runtime.json` to make that decision:
the runtime envelope is metadata, not a lifecycle gate, and an old/missing envelope must not disable mark-active.
The board-lifecycle hooks pass the id explicitly to the canonical session application because there is no worktree
`.session` to fall back on. mark-active has one path: it asks the package to compare against canonical state, and a
semantic no-op emits no event. A writer that refuses (an unreadable record, a retired session — [[sessions-core]])
says so instead of silently repairing it. The **spec-discipline** hooks ([[inject-spec-first]], [[inject-spec-of-file]]) are NOT gated on
`governed` — they serve any agent, keeping their once-per-session sentinel/ledger as sibling files in the same
global session dir (created on demand even for a session with no `runtime.json`). So board state is a managed-
session concern; spec-awareness is universal.

- **`UserPromptSubmit` + `PreToolUse` → one `mark-active` hook**: it writes **`asking`** on an
  **AskUserQuestion** (the question → the note), else **`active`** — the freshness signal that also flips
  a stale `idle`/`asking` back the moment work resumes.
- **`Stop` → the gate**, two jobs each with a hard loop-break. A **commit gate** judges the proposal the
  agent actually made. Uncommitted changes reject EITHER kind — both declarations claim the work is
  committed, and a dirty tree makes that false; and since SpexCode now
  writes NO files into the worktree (the runtime lives in the global store, [[runtime]]), every dirty path is
  genuine work, with no runtime-file filtering to do. Being 0 ahead of the base branch rejects only
  **`merge`**, the one claim it contradicts: `merge` asserts there is committed work to land, while
  `nothing` is retained only to render historical records. The public `done --propose nothing` command is an
  intended trap: it writes no state and tells the agent to choose merge, close, ask, or park. That removes a default
  "keep it just in case" completion face without rewriting old timeline truth; propose-**close** is exempt
  entirely. A **declare gate** blocks a stop while still `active`, auto-defaulting on the forced continuation
  to **`asking`** (the stopped agent needs a human prompt to resume — it never fakes a self-resuming `parked`
  or a completed `nothing`).
  The block reason gives each option its **application condition**, not a menu: a state is a claim others
  act on, so the agent picks the TRUE one. **`parked` is policed hardest** — claim it only when a real
  managed watch delivery or background task will wake you; with neither running to resume you the stop is `asking`, never a false
  `parked` the board misreads as self-resuming while you actually need the human.
  The teaching names the complete declared face: `done --propose merge` is **review** — the sole proposal
  that offers a human-clickable merge; `done --propose close` is **close-pending** only after the task is
  genuinely settled, its worktree is no longer needed, and no human decision, follow-up, or posted-artifact
  inspection remains. `ask` is **asking** when a human reply, direction, or decision is needed — including a
  reported finding/recommendation or a handoff awaiting the human's next direction — and `park` is **parked**, waiting only for a
  managed watch delivery or real background wake-up.
  `done --propose nothing` is instead an intended correction prompt that records no terminal state. Its
  branches name the operative facts: `merge` is committed spec and code not yet landed in `main`; `close` is
  complete work that landed (or had nothing to land), is verified, and leaves neither a needed worktree nor a
  human decision, follow-up, or posted artifact awaiting inspection; `ask` is a needed human reply,
  direction, or decision on a reported finding/recommendation, handoff, or that inspection; `park` is a managed delivery or
  background job that resumes a named next action — watching terminal children is not a wake-up. The dashboard keeps the merge tool's fixed slot
  for every selected session, but enables and paints it green only for the persisted
  `awaiting`/`merge`/`review` proposal while liveness is `online`; every other proposal, lifecycle, or
  liveness reading is muted, disabled, and names its reason. This is an affordance over the existing
  record projection, never a new merge, commit-gate, or lifecycle transition.
  After verified landing, close-pending is for a finished task whose worktree is no longer needed and which has
  no outstanding human decision or follow-up; otherwise the agent declares the state that is true. The
  first-stop teaching carries the same boundary, so unfinished work and human-directed handoffs stay
  review/asking rather than inviting discard.
- **`StopFailure` → `error`**; **headless turn non-zero exit → `error`**, but only as an `active` compare-and-set
  so a declaration written before child teardown wins; **`Notification(idle_prompt)` → `idle`**. All Stop-gate
  git goes through the shared `git()` helper, so a stray exported git dir can't misdirect repo discovery.

`asking` resumes only on a human prompt (unlike self-resuming `parked`); `idle` is its inferred opposite,
a stop with no declaration. Surfacing an `asking` is the manager's job (see [[session-follow]]). The lifecycle
writers live in `sessions.ts`; state's only stake in the shared `cli.ts` hub is the `spex session`
declaration commands and the `spex ls` table — a sibling verb's churn there, like the `eval` usage line
rewritten in the measure-and-score reframe, moves the file but is not state's drift.  What a declaration echoes, how its note is kept and
taught, how a lost record diagnoses itself, and the reminders a propose-close carries are [[declaration]]'s.
