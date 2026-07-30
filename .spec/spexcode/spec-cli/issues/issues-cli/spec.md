---
title: issues-cli
status: active
hue: 30
desc: The `spex issue` / `spex remark` CLI surface, at its own altitude — argv parsing, console output and exit codes for the issue and remark verbs, above the layer the eval package imports.
code:
  - spec-cli/src/issues-cli.ts
related:
  - spec-cli/src/issues.ts
  - spec-cli/src/localIssues.ts
  - spec-cli/src/cli.ts
---

# issues-cli

## raw source

These handlers used to live inside `issues.ts` and `localIssues.ts` — the modules the eval package imports.
A CLI surface is by definition the topmost layer: it reads argv, prints, and returns an exit code. Hosting
one inside a store/feature module gave those files two altitudes at once, and that is what held the
spec↔eval package cycle in place. The loop-in's candidate resolution needs eval knowledge; its only callers
were these handlers; and from below the eval layer they could not reach it. Every cheap alternative failed on
the same wall — moving a store primitive down, lifting the loop-in, extracting the read projection — because
each moved a LEAF of the ring while the ring was held by a module hosting several heights.

## expanded spec

issues-cli owns the `spex issue` and `spex remark` verb surfaces: flag parsing, the flag-decides-the-parse
discriminators, human-readable output, and exit codes. It owns no store state and no issue semantics — it
calls the read/write verbs that `issues.ts` and `localIssues.ts` export, and it renders what they return.
The split is by ALTITUDE, not by domain: the issue domain still belongs to [[issues]] and the local store to
[[local-issues]]; what moved is the part that talks to a terminal.

Its position is what makes it useful. Sitting above both the store modules and the eval layer, it is a place
where a value composed from both can legally be assembled — which is what the remaining half of the cycle
work needs and what no module below eval could offer. Its own imports of `issues.ts` are therefore ordinary
STATIC imports; the deferred `await import('./issues.js')` that `localIssues.ts` used to carry existed only
because a handler down there had to reach a module that imported it back, and it is gone with the handler.

This module is deliberately NOT merged into `cli.ts`. That file is the thin dispatch hub ([[cli-surface]]),
whose roughly eighty lazy import sites keep a single invocation from loading every verb's implementation;
folding 265 lines of verb bodies in would trade one two-altitude module for another and cost the startup
property that discipline exists to buy. The hub reaches this module the same way it reaches every other verb:
one lazy line.

The argv helpers travel WITH the surface rather than being exported to it. `fl`, `hasFlag`, `bare`,
`readBody`, `repeated` and the value-flag set are parsing concerns, so they belong at parsing altitude; two
byte-identical copies of `fl` existed while the surface was split across two modules, and one copy is what
remains. A helper that both this module and a store module need is a signal to re-examine which of them is
really asking, not a reason to widen a store module's exports.
