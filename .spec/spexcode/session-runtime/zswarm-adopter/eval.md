---
scenarios:
  - name: clean-zswarm-shape-with-legacy-sabotage
    tags: [cli]
    description: >
      Pack the protocol and topology packages, install only those tarballs in a clean consumer under a repository-
      external mktemp fixture, and run the ZSwarm-shaped register, children, notification, publish, read, and drain
      loop. Use two independent publishers and one SQLite-only reader. Repeat the whole loop with absent, read-only,
      and poisoned legacy roots under a calibrated full-process-tree file/process trace.
    expected: >
      Both package entrypoints resolve inside the clean consumer; the installed graph contains exactly protocol and
      topology and zero forbidden Spex runtime packages; each sabotage run commits three adopter rows, two topology
      edges, and two independently published notifications; the reader sees both before drain; drain returns both
      exact notifications once, a second drain returns zero, and pending reaches zero. Protocol tables contain zero
      adopter-state columns. Every traced run has a non-empty measured file-syscall population and zero legacy path
      hits, while calibration finds the poison path in at least one non-execve filesystem syscall line.
    test: scripts/m5-zswarm-adopter.mjs
    code: scripts/m5-zswarm-adopter.mjs
    related:
      - spikes/zswarm-sabotage/consumer.mjs
      - spikes/zswarm-sabotage/trace-gate.mjs
---

# ZSwarm adopter loss

Run the checked-in runner with Node 22. It owns package construction, the repository-external consumer, process
boundaries, sabotage fixtures, trace calibration, semantic assertions, and cleanup. Source inspection and an npm
manifest are not substitutes for the installed graph and committed SQLite readings emitted by the run.
