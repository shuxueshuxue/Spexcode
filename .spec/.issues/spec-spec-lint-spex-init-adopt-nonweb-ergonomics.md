---
concern: Spec: spec-lint, spex-init, adopt-nonweb-ergonomics **On a fresh adoption the gate installs, passes, and governs the empty set.** Measured by @2c787e87 this run on `/tmp/probe-adopt` (`git init` + one source file, no `.spec`): `spex spec lint` printed `0 error(s), 1 warning(s)` and exited **0**. The message itself is well-shaped — it reports the roots it resolved, the globs it used, and which knob to turn. The problem is what it resolved: `governedRoots` printed **`[spec-dashboard/src, spec-cli/src]`** — *SpexCode's own package directories*. In the adopter's repo those paths do not exist, so the coverage rule has nothing to enumerate, every rule passes over an empty population, and the exit code says the gate is green. A first-time adopter's honest reading of that output is "installed and passing". What it actually says is **installed, passing, governing nothing**. This is [[taste]] 1's own criterion failing at the first step it promises: `npm install spexcode` → `spex init` → the user launches their own harness with no further human operation. The path completes and produces a gate that cannot fail. ## The two halves look separable and are not The tempting split is "fix the default, leave the exit code alone" — the default is an internal choice, the exit code is an outward contract (any adopter currently green on defaults would turn red). That split does not survive contact: - Any *honest* default for a repo with no `.spec` produces a **non-empty** verdict. Whether the   resolved root set is empty or is two nonexistent directories, the truthful report is "there is   nothing here to govern", and that is not a 0 exit for a production gate. - So changing the default **is** changing the exit code for exactly the population that matters —   fresh adopters. There is no version of this fix that is only cosmetic. Which is why this is filed rather than fixed: it needs a deliberate contract decision about what `spex spec lint` returns when the governed set is empty (error? a distinct exit? a `spex init`-time refusal to complete instead, keeping lint's contract untouched?). The third option is worth weighing first, because it moves the loudness to adoption time where a human is present, and leaves the production gate's contract alone — [[taste]] 3, spend complexity only where it buys some back. ## Not narrow — deliberately no worker tonight An outward-contract change that can turn other adopters' currently-green gates red does not qualify as a narrow default next move. Recorded here so the decision has a durable home in the repo where the fix must land; the run's raw adoption-blocker measurements live in `spexcode-base` `studies/zcode-adoption-blockers/notes.md` (`3ac7008`).
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: landed
nodes: taste
created: 2026-08-05T16:56:24.312Z
---

(no detail given — Spec: spec-lint, spex-init, adopt-nonweb-ergonomics

**On a fresh adoption the gate installs, passes, and governs the empty set.** Measured by
@2c787e87 this run on `/tmp/probe-adopt` (`git init` + one source file, no `.spec`):
`spex spec lint` printed `0 error(s), 1 warning(s)` and exited **0**.

The message itself is well-shaped — it reports the roots it resolved, the globs it used, and which
knob to turn. The problem is what it resolved: `governedRoots` printed
**`[spec-dashboard/src, spec-cli/src]`** — *SpexCode's own package directories*. In the adopter's
repo those paths do not exist, so the coverage rule has nothing to enumerate, every rule passes over
an empty population, and the exit code says the gate is green. A first-time adopter's honest reading
of that output is "installed and passing". What it actually says is **installed, passing, governing
nothing**.

This is [[taste]] 1's own criterion failing at the first step it promises: `npm install spexcode` →
`spex init` → the user launches their own harness with no further human operation. The path completes
and produces a gate that cannot fail.

## The two halves look separable and are not

The tempting split is "fix the default, leave the exit code alone" — the default is an internal
choice, the exit code is an outward contract (any adopter currently green on defaults would turn red).
That split does not survive contact:

- Any *honest* default for a repo with no `.spec` produces a **non-empty** verdict. Whether the
  resolved root set is empty or is two nonexistent directories, the truthful report is "there is
  nothing here to govern", and that is not a 0 exit for a production gate.
- So changing the default **is** changing the exit code for exactly the population that matters —
  fresh adopters. There is no version of this fix that is only cosmetic.

Which is why this is filed rather than fixed: it needs a deliberate contract decision about what
`spex spec lint` returns when the governed set is empty (error? a distinct exit? a `spex init`-time
refusal to complete instead, keeping lint's contract untouched?). The third option is worth weighing
first, because it moves the loudness to adoption time where a human is present, and leaves the
production gate's contract alone — [[taste]] 3, spend complexity only where it buys some back.

## Not narrow — deliberately no worker tonight

An outward-contract change that can turn other adopters' currently-green gates red does not qualify
as a narrow default next move. Recorded here so the decision has a durable home in the repo where the
fix must land; the run's raw adoption-blocker measurements live in `spexcode-base`
`studies/zcode-adoption-blockers/notes.md` (`3ac7008`).)
