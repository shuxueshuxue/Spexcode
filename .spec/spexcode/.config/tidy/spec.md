---
title: tidy
surface: command
status: active
hue: 140
desc: Diagnose or fix a node's body altitude — grade it against the contract-surface test (read-only), or rewrite it to contract altitude — by what the invocation asks for.
kind: mutating
---
Bring each target spec node's body to **contract** altitude — observable behavior, not implementation, and not vague
hand-waving either. One node, two modes chosen by the invoking prompt: **diagnose** (grade only, change nothing) or
**fix** (rewrite in place). Default to diagnose when the ask is "how healthy / what's wrong", to fix when it is "tidy /
clean up".

{{targets}}

The objective rule for every sentence is the contract-surface test: *"could a behavior-preserving refactor delete or
change this?"*

- **Yes ⇒ it is implementation** (operators, call names, data structures, "added a parameter", step-by-step how-to). In
  fix mode it leaves the body and becomes an `@@@title - explanation` comment at the code that owns it.
- **No ⇒ it is contract surface.** Keep it — public names, signatures, return types, invariants, edges/errors, the
  WHEN → outcome a caller observes.

**Diagnose** (read-only — no edits, no commits). For each target report two layers:

- **Deterministic (git + `spex lint`):** *Lint* — errors/warnings naming this node (integrity, living, coverage, drift);
  *Drift* — whether its governed `code:` files moved ahead of its latest version, by how much; *Link-gap* — does `code:`
  name every implementing file? an unlinked file is invisible to lint and drift, so the spec silently stops governing it.
- **Quality grade (judge the body, not the code):** score 1–5 — *declarative*, *refactor-resistant*, *edges*,
  *testable*, *concise*. Two failure directions: **too low** (a mechanics dump — leaks, code identifiers, how-to; altitude
  lint catches this) and **too thin** (so vague a refactor couldn't violate it, e.g. "validates input appropriately";
  only you catch this). End with a one-line verdict (`healthy` | `needs-tidy` | `too-thin` | `drifting` | `link-gap`) and
  the single highest-value next action. Change nothing.

**Fix** (mutating — one commit per node). Rewrite the body at the right altitude: **preserve the contract** (never drop a
requirement; rephrase, don't delete meaning), **raise don't hollow out** (keep every testable specific; cut only the
how — too-thin is as broken as a mechanics dump), **cut redundancy** (say each thing once), **stay a living document**
(rewrite in place, never a `## vN` history — git carries versions). Commit per node (`spec: <id> — tidy to contract
altitude`) with a `Session:` trailer; run `spex lint` after each — it must stay at 0 errors.
