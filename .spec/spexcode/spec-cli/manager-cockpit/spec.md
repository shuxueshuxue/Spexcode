---
title: manager-cockpit
status: active
hue: 200
desc: The cockpit API — server-computed verbs that let a manager review/act on sessions without hand-running git.
related:
  - spec-cli/src/index.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/git.ts
---

# manager-cockpit

## raw source

A manager — human or agent — shouldn't have to `cd` into a worktree and hand-run git to decide what to do
with a session, NOR to land it. The **server** does that work and hands back one ready-made answer. The
cockpit is the set of such verbs. **review** decides ("should I merge this session?") in a single payload;
**merge** is its sequel — it hands the work back to the session's OWN agent to land. Both are thin-called by
the dashboard and `spex`. **capture / prompt / close / dispatch** remain monitor + lifecycle actions on the
same surface.

## expanded spec

`reviewPayload(id)` (in [[state]]'s `sessions.ts`) computes ONE bundle for a session, served at
`GET /api/sessions/:id/review` and printed by `spex review <id>` (`--json` for the raw payload). Unknown id
→ `null` → HTTP 404 / a non-zero CLI exit. The reads run in parallel, all against the source-of-truth base
branch (`mainBranch()`, auto-detected — never a hardcoded `main`). The payload carries:

- **ahead** — commits the node branch is ahead of the base.
- **dirtyNonRuntime** — uncommitted files; SpexCode writes no runtime files into the worktree
  ([[runtime]]), so every dirty path is genuine spec/code work — the basis [[state]]'s commit gate uses.
- **diff** — the worker's REAL changes, anchored at the **merge-base** (`mergeBaseDiff` in
  [[source-of-truth]]'s `git.ts`): per-file status + added/deleted line counts. A two-dot `base..HEAD` diff
  would show the base's post-fork commits as phantom edits, so the fork point is the only honest base.
- **gates** — `conflictsWithMain` (a dry-run merge computed in the object store via `git merge-tree
  --write-tree` — no checkout, nothing to abort, the SAFE form of "would this conflict"); `typecheck`
  (`tsc --noEmit` on the CLI package at its own location); `lint` (the [[spec-lint]] module's error /
  warning counts). conflict/ahead/dirty/diff are session-specific; the typecheck/lint gates reflect the CLI
  package's own tree, where the command runs.
- **proposal** — the session's standing proposal kind + note, read from its global record.

`mergeSession(id)` is the ACT verb, served at `POST /api/sessions/:id/merge` and run by `spex merge <id>` —
but it is a DISPATCH, not a server merge: the SESSION'S OWN agent lands the work, the server NEVER touches
main's tree (it carries no `git merge` logic). It reopens the session (`--resume`s via [[state]]'s reopen
when tmux died, which waits for the rendezvous socket so the dispatch hits a live agent), then sends
`mergePrompt` through the socket. That prompt is the human's merge INTENT and the one place the merge STYLE
lives: a `--no-ff` commit `merge <branch>: <reason>` from the main checkout (`reason` = the branch's latest
commit subject minus a leading `spec: `), with the agent told to resolve conflicts, VERIFY the base's HEAD
advanced with no half-merge, then propose CLOSE (not merge — the commit gate exempts propose-close) for the
human. Async + fail-loud: `{dispatched:true}` once the prompt is CONFIRMED accepted, else
`{dispatched:false, reason}` (HTTP 409 / non-zero) when the agent is unreachable. Landing is thus the
agent's verified act, never a server gate — review SHOWS the gates; the agent ENFORCES them by verifying.

Two read verbs round out the manager surface, both backend-computed so a client (incl. a REMOTE one over
`SPEXCODE_API_URL`) can monitor an agent without the binary terminal socket: **capture**
(`captureSessionResult`, `GET …/capture`) returns the live pane as text, keeping "couldn't read" distinct
from "blank pane" — empty pane → 200, unknown id → 404, offline → 409, capture error → 502; **prompt**
(`GET …/prompt`) returns a session's originating ask (404 if none). Paths resolve from the CLI package's OWN
location, never a hardcoded layout, so the cockpit works wherever the package lives. Every cockpit verb only
READS or DISPATCHES — none mutates main directly. The cockpit's stake in the shared `cli.ts`/`index.ts` hubs is just the thin
`review`/`merge`/`capture`/`prompt` routes; the yatsu reframe's churn there — its rewritten verb line and
its eval-blob comment — is that feature's, not the cockpit's drift.
