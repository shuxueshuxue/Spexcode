---
scenarios:
  - name: byte-identical-target-keeps-filesystem-identity
    tags: [backend-api, cli]
    description: >-
      In an adopted repository with tracked host contract files, materialize once, record the filesystem
      identity timestamps of the selected contract, shim and managed ignore targets, then materialize again
      without changing source or config.
    expected: >-
      Every recorded timestamp is unchanged and the artifacts remain correct. A byte-identical target is
      observed, not rewritten; a changed target is the only target eligible for replacement.
    test: spec-cli/src/materialize.test.ts
---
# eval.md — materialized-files

The writer's loss signal is the real materialize surface: correct derived files retain their filesystem
identity across a same-input pass, while the surrounding target-map reconciliation remains responsible for
removing paths that are no longer owned.
