---
title: extract
surface: slash
status: active
hue: 30
desc: Reverse-engineer a faithful spec tree out of existing code — responsibility nodes at contract altitude, intent never fabricated.
kind: mutating
---
Reverse-engineer a spec tree for the target source area(s) below — code that has no specs yet. Aim for a
tree where every governed file is claimed and `spex lint` is clean, with bodies at contract altitude.

{{targets}}

**Find the spine the code already declares first** — a barrel of exports, a README or design doc, the
dependency direction between modules — and adopt it as the top-level shape, refined where the code reveals
finer responsibilities. Only when the code declares no architecture is the top-level cut a judgment call
worth raising with the human.

Then grow nodes under that spine:

- **Decompose by responsibility, not by file.** A node is one job the code does. A fat file split across
  several jobs becomes several nodes that each claim it; one job spanning several files becomes one node
  claiming them all. Every governed file is claimed by at least one node; nest into subtrees where warranted.
- **Stay at contract altitude.** State each node's intent, invariants, and outward behavior — what it
  guarantees and why — not how the code does it.
- **Never fabricate intent.** Code shows *what it does*, rarely *why*. Read any README/design docs for real
  intent; where you can still only see behavior, state the behavior and mark the intent as inferred rather
  than inventing a rationale.
- **Reserve pure-prose nodes** (no `code:`) for a genuine cross-cutting contract no single file owns. Use
  sparingly.
- **Mind the scope boundary.** A file that looks like a thin wrapper may be the foot of a feature defined
  outside the target area — flag it instead of mis-homing it, and prefer extracting the whole repo so
  cross-cutting features stay visible. If nothing reaches a file, say it's likely dead rather than
  dignifying it with a confident spec.

Confirm `spexcode.json`'s `governedRoots` points at the real source dirs first — lint reads silently empty
otherwise. Commit one node per commit (`spec: <id> — extract from <area>`) with a `Session:` trailer, and
run `spex lint` after each: it must reach 0 errors, 0 coverage warnings, 0 altitude warnings.
