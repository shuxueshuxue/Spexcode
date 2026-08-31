---
title: import-cycles
status: active
hue: 100
desc: No module may need itself to finish loading; the graph is checked, not the convention.
code:
  - scripts/import-cycles.test.mjs
related:
  - .github/workflows/ci.yml
---
# import-cycles

A runtime import cycle means a module has to be half-initialized for one of its own dependencies to finish
loading. ES modules tolerate that until they don't: the failure is a temporal-dead-zone error or a binding
that is quietly `undefined`, and it surfaces when someone introduces a new import order somewhere else
entirely. The edge that caused it is nowhere near the crash.

Three had formed, and all three were the same mistake — a leaf question asked through a module that also
holds implementations:

- `tabs.js` asked views.jsx whether a page kind is a document. views.jsx eagerly imports SessionsView so a
  dispatched compose finds a mounted receiver, so twelve dashboard modules were one component
  ([[view-catalog]]).
- `gateway-hub.ts` and `machine-peer.ts` read the endpoint record from host.ts, while host.ts imported both
  of them to mount the gateway ([[endpoint-record]]).
- `opencode-headless.ts` took a shell helper from harness.ts, which imports it to build its adapter entries.

Not one was visible in review, because every single import in them looks reasonable on its own. Only the
graph shows it, so the graph is what is checked.

## What counts as an edge

Only what forces initialization order: a **value** import that resolves to a file in this repository.

- `import type` is erased before runtime. The session protocol's barrel and the harness adapters' shared
  type declarations are not cycles and must keep resolving.
- A dynamic `import()` is deferred by construction. The dashboard's lazy view importers and the CLI's
  on-demand command modules are not cycles, and one is the sanctioned way to break a genuine one — as
  `mentions.ts` does to reach sessions.
- Resolution follows TypeScript's spelling, where `./x.js` in a `.ts` file means `./x.ts`. An edge must not
  be missed because of how it is written.

Test files are outside the roster: a test may reach anywhere, and a cycle through one cannot wedge a
production load order.

## Failing loudly about itself

A broken resolver reports a clean graph, which reads exactly like success. The check therefore also asserts
a floor on how many files and edges it resolved, so a roster or resolver that stops working fails instead of
silently passing.
