---
scenarios:
  - name: move-children-and-watch-relation
    description: >
      With three real governed sessions in one project store, make two children point to an offline former
      parent and register that former parent in both target watcher files. Keep one child in an active turn,
      then run `spex session reparent <child-a> <child-b> --to <replacement>`. Inspect `session ls`, each
      record and watcher relation, the replacement's received current-state notices, and a later child
      declaration.
    expected: >
      The command exits successfully without signalling or restarting either child. Both list-tree rows move
      to the replacement immediately; each child has the replacement as parent and exactly one watcher,
      with the former parent absent. The replacement receives each current state and the later transition;
      the former parent receives no new transition. A pending former-parent `continue` never reaches either
      child after the transfer, while its accepted historical timeline line is not erased.
    tags: [cli, backend-api]
    code: spec-cli/src/session-reparent.ts
  - name: backendless-owner-fallback
    description: >
      Stop the project's backend after creating governed parent and child records, then run the same
      `session reparent` command locally. Repeat with an explicit remote `--api` pointing at a refused port.
    expected: >
      The unflagged command takes the local record locks and completes the move after an exact no-listener
      result. Explicit remote routing never substitutes a local edit: it exits non-zero with the transport
      failure and leaves the child's parent and watcher relation unchanged.
    tags: [cli, backend-api]
    code: spec-cli/src/session-reparent.ts
---

# measuring session-reparent

Measure through real manager commands and the public session projection. Raw store inspection is supporting
evidence for the parent-and-watch invariant, never a substitute for the immediate list/tree and delivery loop.
