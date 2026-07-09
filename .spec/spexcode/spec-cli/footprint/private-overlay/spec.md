---
title: private-overlay
status: active
hue: 200
desc: A private dogfood mode — run SpexCode on a repo you share but don't own, leaving ZERO trace in its tracked files or shared history, so collaborators see an untouched repo.
code:
  - spec-cli/src/worktree-sources.ts
related:
  - spec-cli/src/materialize.test.ts
---
# private-overlay

## raw source

SpexCode is always a guest ([[footprint]]), but the DEFAULT guest still leaves fingerprints a co-owner sees.
Two of them are load-bearing on purpose: `.spec` + `spexcode.json` are COMMITTED because git IS the database
([[source-of-truth]]), and the harness contract is folded into `CLAUDE.md`/`AGENTS.md`, ignored via a managed
block in the tracked `.gitignore` ([[harness-delivery]]). That "generated, gitignored, never committed" promise
only holds when the file is WHOLLY ours — on a host that already tracks its own `CLAUDE.md`/`AGENTS.md`/
`.gitignore`, gitignoring a tracked file is a no-op, so the block rides inside a tracked file and lands in every
teammate's diff. The complaint writes itself: *"you polluted our CLAUDE.md, our git workflow."*

Private-overlay is the mode for the solo dogfooder who wants the tool WITHOUT their teammates ever seeing it:
one machine-local switch, and SpexCode's whole presence becomes invisible to the shared repo.

## expanded spec

The switch is `private: true` in the gitignored `spexcode.local.json` ([[portable-layout]]) — machine-local by
construction, so opting IN is itself never committed. When set, `spex materialize` ([[harness-delivery]])
delivers the SAME contract but routes every seam that would touch shared history to a per-clone home instead:

- the managed ignore block moves from the tracked `.gitignore` into `.git/info/exclude` (which git never
  commits or shares) and WIDENS to also hide `.spec` + `spexcode.json` — the two the default mode commits;
- any folded-into contract file the host ALREADY tracks is marked `skip-worktree`, so the block sits in the
  working copy — the harness still auto-discovers it, the user's own prose intact — yet never stages.

It is not merely reversible but an IDEMPOTENT toggle: the two modes fully CANCEL OUT. default→private→default
(or private→default→private) converges to the SAME on-disk state as running that mode once — each mode
re-asserts the inverse of the other (exclude block ⇄ `.gitignore` block, `skip-worktree` set ⇄ cleared), so
switch order never matters and running one mode twice changes nothing. This holds only because the managed-block
writer and its remover are exact inverses — the remover strips our block WITHOUT touching the user's own
whitespace (a global collapse there once left a one-line `.gitignore` diff on the round-trip). The single thing
the render cannot undo for the user: `.git/info/exclude` hides UNTRACKED paths only, so a `.spec`/`spexcode.json`
already committed under default mode must be un-tracked once by hand — materialize PRINTS that `git rm --cached`
instruction when it detects the state, and `spex guide config` documents the mode switch + this step, since an
agent does the setup.

A dispatched **session worktree** is the third seam. `git worktree add` checks out only TRACKED content, and
`.spec` + `spexcode.json` are exactly what this mode keeps untracked — so a fresh worktree carries the rendered
shims and contract block ([[harness-delivery]]) but NO spec tree: every hook handler script is absent (the
dispatcher [[hook-dispatch]] silently runs nothing — no gates, no stop discipline), `spex` inside the worktree
sees zero nodes, and the dispatch gate re-renders on every event because the worktree hashes empty config
roots (in the wild that per-event render, under worktree-shared git-lock contention, hung a worker's Stop hook
past the harness's 60s timeout). Git cannot deliver what it does not track, so session creation
(`worktree-sources.ts`, called from [[launch]]'s worktree prep) **links** the main checkout's `.spec`,
`spexcode.json` and `spexcode.local.json` into every fresh worktree that lacks them. On a default-mode repo the
checkout already carries the first two, so each link guard no-ops — one mechanism, never a mode branch — and
`spexcode.local.json` (machine-local, untracked in BOTH modes) riding along is what keeps a worktree render in
the same mode as the main checkout's. Spec writes from inside a private worktree therefore land directly in the
shared main tree, coherent with this mode's trade: git is not carrying the spec data either way. The deliberate trade is history: with `.spec` kept out of the host's commits there is no
git-derived version timeline ([[source-of-truth]]) — current-state governance, lint, and yatsu still measure,
but the recent/history tabs go quiet. Regaining full history invisibly (a detached spec repo) is a larger,
separate concern this mode does not attempt.
