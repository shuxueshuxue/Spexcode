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
  - packages/spec-core/src/git.ts
  - spec-cli/test/cockpit-eval-readout.mjs
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

`reviewPayload(id)` (in [[review-payload]]'s `session-review.ts`) computes ONE bundle for a session, served at
`GET /api/sessions/:id/review` and printed by `spex review <id>` (`--json` for the raw payload). Unknown id
→ `null` → HTTP 404 / a non-zero CLI exit. The reads run in parallel, all against the source-of-truth base
branch (`mainBranch()`, auto-detected — never a hardcoded `main`). The payload carries:

- **review snapshot** — review resolves branch and base refs together, uses that snapshot internally for ahead,
  merge-base diff, and conflict projection, then refuses a read if either ref moved while the facts were assembled.
  This prevents a mixed-generation review response; object ids are implementation detail, are not returned, and do
  not authorize merge.
- **ahead** — commits the node branch is ahead of the base.
- **dirtyNonRuntime** — uncommitted files; SpexCode writes no runtime files into the worktree
  ([[runtime]]), so every dirty path is genuine spec/code work — the basis [[state]]'s commit gate uses.
- **diff** — the worker's REAL changes, anchored at the **merge-base** (`mergeBaseDiff` in
  [[source-of-truth]]'s `git.ts`): per-file status + added/deleted line counts. A two-dot `base..HEAD` diff
  would show the base's post-fork commits as phantom edits, so the fork point is the only honest base.
- **gates** — `conflictsWithMain` (a dry-run merge computed in the object store via `git merge-tree
  --write-tree` — no checkout, nothing to abort, the SAFE form of "would this conflict") and `lint` (the
  [[spec-lint]] module's error / warning counts). conflict/ahead/dirty are session-specific; the lint gate
  reflects the CLI package's own tree, where the command runs, so it is memoized on that tree's fingerprint
  (an unchanged tree skips the re-lint on repeated manager reviews / exports).

  This location-wide verdict belongs to explicit manager review; a whole-repository lint is not a property of
  any one page. Within the manager review, the memo only covers the case where nothing moved. When the fingerprint moves —
  a trunk commit, one dirty edit — the verdict is
  recomputed, and a second verdict IN THE SAME PROCESS costs what MOVED, because the anchor engine reuses the
  hunks whose IMAGE IDENTITY it has already read under a pinned diff interpretation ([[code-anchor]] owns that
  identity — ordered result/parent images, not a commit id, which `refs/replace`, a graft or an unshallow can
  reinterpret) instead of re-probing every anchored window.

  Measured here, and this is the whole claim, no wider: an empty-scope manager review and a ten-file-scope review each
  pay the same 48 git children on a COLD process — 22 of them one `log --patch` per anchored path — and that
  first touch is UNCHANGED. What the reuse removes is paying it AGAIN on every later fingerprint move: 38
  children with 22 such queries, argv byte-identical to the previous run, down to 15 with none; a commit that
  moves ONE anchored path, 42 with 22 down to 21 with one. So a warm backend's manager re-verdicts no longer cost
  the corpus. The cold gate remains real when a caller asks for it.

  The reusable hunk facts are durable across processes in [[source-of-truth]]'s existing on-disk event ledger,
  keyed by the SAME ordered image identity and pinned range-semantics schema [[code-anchor]] uses in process.
  A fresh backend therefore replays known facts after a restart; an image the ledger has never seen still pays
  one Git derivation and joins the gate's existing build-local ledger snapshot, lock, and one writer rather
  than opening a second ledger transaction. This is not a second cache of
  the lint verdict: a moved fingerprint still recomputes the verdict from its current tree, and no selector
  outcome, window, or reachability judgment is persisted. A trunk commit that replaces the backend child is
  consequently a first gate only for its newly introduced images, not a corpus-wide first touch. Proportionality is
  bought the one way described and no other: the gate keeps NO second cache of its verdict and narrows
  nothing — the counts are exactly what `spex spec lint` reports for that tree with its dirty files included, a
  moved fingerprint always recomputes instead of serving last-known, and a rejected run is never cached.
  There is deliberately
  NO build/typecheck/test gate here: whether a change is SOUND is proven through the real product and
  handed to the reviewer as session files — not by a language-specific automated checker baked into the
  cockpit. So the gates stay language-agnostic (git + the spec↔code graph), correct for any governed
  project, TS or Python or otherwise, rather than a `tsc` that only ever spoke TypeScript.
- **proposal** — the session's standing proposal kind + note, read from its global record.

`mergeSession(id)` is the ACT verb, served at `POST /api/sessions/:id/merge` and run by `spex session merge <id>`.
It is a plain dispatch, never a server merge: only a governed `awaiting` session with `proposal=merge` can receive
it; any other state fails loudly with HTTP 409. The request has no body or special header. Once its one ordinary
prompt is durably appended, normal session resume and delivery apply. The prompt tells the session's own agent to
sync and resolve conflicts in its own worktree, re-run proof, atomically land the completed branch with one
`--no-ff` merge into `main`, and verify the landing before proposing close. The server never touches `main` and
the shared main checkout never resolves a conflict.

Two read verbs round out the manager surface, both backend-computed so a client (incl. a REMOTE one over
`SPEXCODE_API_URL`) can monitor an agent without the binary terminal socket: **capture**
(`captureSessionResult`, `GET …/capture`) returns the live pane as text, keeping "couldn't read" distinct
from "blank pane" — empty pane → 200, unknown id → 404, offline → 409, capture error → 502; **prompt**
(`GET …/prompt`) returns a session's originating ask (404 if none). Paths resolve from the CLI package's OWN
location, never a hardcoded layout, so the cockpit works wherever the package lives. Every cockpit verb only
READS or DISPATCHES — none mutates main directly. The cockpit's stake in the shared `cli.ts`/`index.ts` hubs is just the thin
`review`/`merge`/`capture`/`prompt` routes; a sibling verb's churn there is that feature's, not the
cockpit's drift.

## where the answer is assembled

`cockpit.ts` is the cockpit's own module, and its review is [[review-payload]]'s bundle returned as-is:
`cockpitReview(id)` calls `reviewPayload(id)` and adds nothing. The cockpit review is reachable two ways —
the HTTP route, and the client's local answer when no backend resolves and none was named — and both call
that one function, so the same verb returns the same SHAPE whether or not a backend happens to be running;
a drift between two compositions is unavailable rather than merely unlikely. The session-side payload
carries the session gates only: conflict, lint, ahead and dirty.
