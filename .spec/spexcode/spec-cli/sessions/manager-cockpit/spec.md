---
title: manager-cockpit
status: active
hue: 200
desc: The cockpit API — server-computed verbs that let a manager review/act on sessions without hand-running git.
code:
  - spec-cli/src/cockpit.ts
related:
  - spec-cli/src/index.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/git.ts
  - spec-cli/test/cockpit-eval-readout.mjs
  - spec-eval/src/sessioneval.ts
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
  --write-tree` — no checkout, nothing to abort, the SAFE form of "would this conflict"); `lint` (the
  [[spec-lint]] module's error / warning counts); and `evals`, the measured-loss READOUT. conflict/ahead/dirty are session-specific; the lint gate
  reflects the CLI package's own tree, where the command runs, so it is memoized on that tree's fingerprint
  (an unchanged tree skips the re-lint on repeated reviews / [[session-eval]] opens). There is deliberately
  NO build/typecheck/test gate here: whether a change is SOUND is proven by the node's eval scenarios, measured
  through the real product ([[session-eval]] shows that evidence) — not by a language-specific automated
  checker baked into the cockpit. So the gates stay language-agnostic (git + the spec↔code graph), correct
  for any governed project, TS or Python or otherwise, rather than a `tsc` that only ever spoke TypeScript.
  The `evals` entry is that same principle turned outward: since soundness is proven by MEASUREMENT, the
  cockpit hands the manager the measurement beside the git facts — [[session-eval]]'s four mutually exclusive
  scenario categories, `{freshPass, freshFail, needReview, blind}`. It REPORTS and grades nothing: no
  threshold, no ok/not-ok, no block, and no unknown-coverage or measured/total aggregate riding along (that
  decomposition belongs to the toolbar that already renders it). It reads the session-eval projection that
  ALREADY exists — a cache read, never a build, because `buildSessionEvals` calls this very payload and a
  build here would recurse — so the readout costs the review nothing. Its `phase` is part of the fact: only
  `ready` carries numbers; an absent, loading, updating, or failed projection reports that phase and carries
  NO numbers, because "nothing measured" and "not measured yet" are different facts and four zeros would
  read as the clean one. Last-known is never dressed up as current, and this readout adds no row to the
  session gates strip.
- **proposal** — the session's standing proposal kind + note, read from its global record.

`mergeSession(id)` is the ACT verb, served at `POST /api/sessions/:id/merge` and run by `spex merge <id>` —
but it is a DISPATCH, not a server merge: the SESSION'S OWN agent lands the work, the server NEVER touches
main's tree (it carries no `git merge` logic). It reopens the session (`--resume`s via [[state]]'s reopen
when tmux died, which waits for the rendezvous socket so the dispatch hits a live agent), then sends
`mergePrompt` through the socket. That prompt is the human's merge INTENT and the one place the merge STYLE
lives: a `--no-ff` commit `merge <branch>: <reason>` from the main checkout (`reason` = the branch's latest
commit subject minus a leading `spec: `), with the agent told to resolve conflicts, VERIFY the base's HEAD
advanced with no half-merge, then propose CLOSE (not merge — the commit gate exempts propose-close) for the
human. Async + fail-loud: `{dispatched:true}` once the prompt is appended, else `{dispatched:false, reason}`
(HTTP 409 / non-zero) only when the record rejects it. Landing is thus the
agent's verified act, never a server gate — review SHOWS the gates; the agent ENFORCES them by verifying.

Two read verbs round out the manager surface, both backend-computed so a client (incl. a REMOTE one over
`SPEXCODE_API_URL`) can monitor an agent without the binary terminal socket: **capture**
(`captureSessionResult`, `GET …/capture`) returns the live pane as text, keeping "couldn't read" distinct
from "blank pane" — empty pane → 200, unknown id → 404, offline → 409, capture error → 502; **prompt**
(`GET …/prompt`) returns a session's originating ask (404 if none). Paths resolve from the CLI package's OWN
location, never a hardcoded layout, so the cockpit works wherever the package lives. Every cockpit verb only
READS or DISPATCHES — none mutates main directly. The cockpit's stake in the shared `cli.ts`/`index.ts` hubs is just the thin
`review`/`merge`/`capture`/`prompt` routes; the eval reframe's churn there — its rewritten verb line and
its eval-blob comment — is that feature's, not the cockpit's drift.

## where the answer is assembled

The cockpit's review is composed in `cockpit.ts`, a module that sits ABOVE both the session layer and the eval
layer and may import either. That is the point: a value made of both halves has no honest home inside either
one. `sessions.ts` cannot hold it, because the eval package imports `sessions.ts` — reaching back from there is
a cycle, and it used to be paid for with a deferred dynamic import whose own comment explained why it had to be
wrong. `reviews.ts` cannot hold it either: that file is [[paged-review]]'s Issues/Evals paging server, and
parking a session-cockpit concern beneath a node about paging would make that node's body false. It imports the
eval package for its own reasons — the same direction, a different reason, and "already imports it" is not a
claim to ownership.

The eval readout therefore has **exactly one producer**, and every entry point calls it. The cockpit review is
reachable two ways: the HTTP route, and the client's local answer when no backend resolves and none was named.
If each composed its own gates, the same verb would return different SHAPES depending on whether a backend
happened to be running — reintroducing precisely the asymmetry the remote-client role split removed — and a
later drift between the two readouts would be caught by no gate that exists. One composition is what makes
that failure unavailable rather than merely unlikely.

The session-side payload consequently returns the session gates only. It never needed to carry the eval
readout: the eval package's own consumer reads lint, conflict, ahead and dirty, and never that field. Removing
it makes the recursion the old comment guarded against structurally impossible — the eval model builder calls
the session payload, and there is no longer an eval-shaped field for that call to re-enter through.
