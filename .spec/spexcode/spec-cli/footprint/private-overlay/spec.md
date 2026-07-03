---
title: private-overlay
status: active
hue: 200
desc: A private dogfood mode — run SpexCode on a repo you share but don't own, leaving ZERO trace in its tracked files or shared history, so collaborators see an untouched repo.
code:
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

It is a reversible toggle, not a trap-door: the default render re-asserts the inverse of each step (exclude
block stripped, `.gitignore` block restored, `skip-worktree` cleared), so flipping back leaves no residue —
the same *stamped, visible, reversible* invariant the rest of [[footprint]] keeps. It hides UNTRACKED paths;
a spec tree already committed to the host must be un-tracked once by hand, which the render reports rather than
silently attempting. The deliberate trade is history: with `.spec` kept out of the host's commits there is no
git-derived version timeline ([[source-of-truth]]) — current-state governance, lint, and yatsu still measure,
but the recent/history tabs go quiet. Regaining full history invisibly (a detached spec repo) is a larger,
separate concern this mode does not attempt.
