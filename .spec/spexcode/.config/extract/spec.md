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
- **Group wide layers; don't mirror the file tree — at every level, the root included.** One-node-per-
  folder is a smell; the directory layout is a hint, not the decomposition. If a node would have more than
  ~7 direct children you're under-grouping: add intermediate **sub-domain** nodes that cluster siblings
  serving one concern (e.g. model-config + model-selection + auth + provider-compat → a single *model*
  domain), and recurse, until every level reads as a handful of related siblings, not a flat wall. Fold
  cross-cutting substrate (design system, dialogs, i18n, utilities, platform glue) under one *foundation*
  node instead of scattering it across the top level, and don't promote a tiny standalone feature to a
  peer of the major domains when it belongs inside one. A sub-domain node is legitimate — it claims the
  cluster's barrel/wiring/shared files, so it isn't pure-prose. Equally, split a fat folder that holds
  several distinct jobs. Group by responsibility, never to hit a number — never invent contrived buckets.
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

**Give every frontend node a loss signal.** A node that governs UI or visual code (`.tsx`/`.jsx`/`.vue`/
`.svelte`/`.css`, or the dashboard) is a blind spot until it carries a `yatsu.md` — so write one as you
extract it: a scenario with a **description** (what to look at through the running app) and the **expected**
result that is zero loss. Frontend scenarios are measured by looking (YATU) — a screenshot filed with
`spex yatsu eval <node> --image <png> --pass`. Backend nodes don't need one yet; run `spex yatsu scan` to
list the frontend nodes still uncovered.

Confirm `spexcode.json`'s `governedRoots` points at the real source dirs first — lint reads silently empty
otherwise. Commit one node per commit (`spec: <id> — extract from <area>`) with a `Session:` trailer, and
run `spex lint` after each: it must reach 0 errors, 0 coverage warnings, 0 altitude warnings.
