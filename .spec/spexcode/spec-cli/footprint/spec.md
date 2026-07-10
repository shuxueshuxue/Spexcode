---
title: footprint
status: active
hue: 200
desc: SpexCode's presence on a host it does not own — shipped as one package, planted into a repo, governed by one share axis, audited for real delivery to the agent, and removed without a trace.
---
# footprint

## raw source

SpexCode claims software engineering's HEAD — the recording of intent — and its TAIL — the storage of
measurement — and deliberately leaves the MIDDLE, construction, to the harness/agent/test framework;
freshness stitches the two ends into a closed loop. That position sizes the footprint: what SpexCode
plants in a host is the head+tail ASSET (the spec tree and its readings, tracked like any source) plus the
derived wiring that reaches an agent — and nothing of the middle.

SpexCode is always a guest — on a user's machine, in an existing repo, inside an agent the user launched
themselves. A guest's footprint must be one deliberate lifecycle: arrive as a single installable unit,
plant only identifiable artifacts, be able to prove the delivery actually reached the agent, and back out
leaving nothing behind. Read flat, these look like unrelated commands; read together they are one
contract: SpexCode never silently pollutes an environment it does not own.

## expanded spec

The lifecycle's stations, each owning its own detail:

- **[[packaging]]** — arrival on a *machine*: one npm package puts one `spex` on PATH, carrying the
  runtime subset with the monorepo layout preserved, no build step on the user's box.
- **[[spex-init]]** — adoption by a *repo*: the seed spec tree, git hooks, and starter config, planted as
  copied data (never code-embedded strings), additive and never destructive.
- **[[render-policy]]** — residence in the repo: the ONE share axis. Spec data always tracked, machine
  facts never, run residue out-of-tree; the machine-independent renders carry the single vote —
  `committed` | `ignored` | `hidden` — and every planted artifact's visibility follows its KIND, never a
  usage mode.
- **[[doctor]]** — the audit of delivery to an *agent*: is this agent actually governed, or silently running
  free? Under-delivery and double-delivery both caught, with the repair printed.
- **[[spex-uninstall]]** — departure: materialize(∅) plus the store — every generated artifact removed by
  its identity stamp, the user's own `.spec`/`.config` data and prose never touched.

The shared invariant that makes this one node: every footprint artifact is **stamped, visible, and
reversible** — planted as data, diagnosable in place, and removable only by proof of our own authorship.
A concern about what the tool *does* belongs elsewhere; a concern about where the tool *lives* belongs
here.
