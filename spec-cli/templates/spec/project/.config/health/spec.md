---
title: health
surface: slash
status: active
hue: 200
desc: Report a node's health — lint, drift, link-gap, and a spec-quality grade of the body — without changing anything.
kind: report
---
Report the health of each target spec node. **READ-ONLY**: make no edits and no commits.

{{targets}}

For each target, report two layers — the cheap deterministic checks first, then a quality grade of the body text.

**Deterministic (from git + `spex lint`):**

- **Lint** — run `spex lint` and surface any error/warning naming this node (integrity, living, coverage, drift).
- **Drift** — whether its governed `code:` files have moved ahead of its latest version, and by how much.
- **Link-gap** — does `code:` name every source file that implements this node's contract? Flag any implementing file not yet linked: an unlinked file is invisible to lint and drift, so the spec silently stops governing it.

**Spec-quality grade (judge the body, not the code).** Score 1–5 on each dimension, applying the objective contract-surface test to every claim — *"could a behavior-preserving refactor delete or change this?"* Yes ⇒ it names implementation (a leak); No ⇒ it is contract surface.

- **declarative** — states observable behavior, not how. (a leak fails it)
- **refactor-resistant** — survives a behavior-preserving refactor unchanged. (fragile fails it)
- **edges** — names boundaries, defaults, and what is rejected.
- **testable** — WHEN → outcome, measurable and unambiguous.
- **concise** — a capability picture, not a code restatement.

Two failure directions, both reportable: **too low** (a mechanics dump — implementation leaks, code identifiers, step-by-step how-to) and **too thin** (so vague a refactor couldn't violate it, e.g. "validates input appropriately"). Altitude lint catches only the first; you judge the second.

End with a one-line verdict per node (`healthy` | `needs-tidy` | `too-thin` | `drifting` | `link-gap`) and the single highest-value next action. Change nothing.
