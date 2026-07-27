---
scenarios:
  - name: one-project-one-runtime-root
    tags: [backend-api, cli]
    description: >
      In isolated Claude-only and Codex-only Git projects with their own SPEXCODE_HOME, drive the real
      init, materialize, reference-hook, history-index, and uninstall surfaces. Inspect the project store
      before uninstall, pre-plant the retired hash-keyed event-cache directory, then inspect every in-tree,
      global-config, plugin, and project-store artifact after uninstall.
    expected: >
      Every current project-scoped artifact, including the versioned history-event ledger, resolves beneath
      one encoded project runtime root; the index never creates or consumes a second hash-keyed project root.
      Uninstall removes that current root and a pre-existing retired hash-keyed event root while preserving
      tracked spec intent and foreign user/plugin content exactly.
    test:
      path: spec-cli/src/uninstall.test.ts
      name: init → materialize → uninstall forgets every derived artifact for Claude-only and Codex-only repos
    related:
      - spec-cli/src/layout.ts#runtimeRoot
      - spec-cli/src/uninstall.ts#uninstall
      - spec-cli/src/uninstall.test.ts
---

# measuring runtime

The lifecycle test is the product boundary: it uses installed hooks and public CLI verbs in disposable real
repositories, then reads the same SPEXCODE_HOME layout that sessions, materialize, history indexing, and
uninstall expose. A source-level path assertion alone is not a measurement of the forgetting law.
