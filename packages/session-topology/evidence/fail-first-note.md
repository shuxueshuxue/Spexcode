# Fail-first note

The command was `node packages/session-topology/scripts/fail-first.mjs` under Node 22.21.0 and exited 1.
Both packages loaded, the protocol database opened, component migration ran, both addresses initialized, and the
transactional enqueue committed. The package's deliberately incomplete `attach` returned without inserting an edge,
so the vector's own recipient assertion failed. A correct topology implementation would return `source-a` and pass;
a missing module or bad path was not accepted as evidence.

`fail-first.log` is the original output and must not be overwritten by later runs.
