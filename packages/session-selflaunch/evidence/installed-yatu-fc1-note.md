# F-C1 installed YATU note

This transcript was produced after F-C1 implementation commit `87ead75c9` on the tree merged with integration head
`e08ba30ce`. The missing-parent command still exits 1 with the same `PROTOCOL_PATH_PARENT_MISSING` message and repair
hint, but the locality resolver now throws that error itself and never returns without a locality verdict.

The run used Node 22.21.0 and SQLite 3.50.4. Both tarballs resolved under a new external consumer's `node_modules`,
and all 21 independent CLI invocations passed. The earlier installed evidence remains unchanged.

The existing evidence gaps are unchanged: no real network mount is available, and macOS/Windows have no detector.
