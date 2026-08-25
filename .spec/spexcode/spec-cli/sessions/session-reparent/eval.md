---
scenarios:
  - name: move-children-and-watch-relation
    description: >
      With three real governed sessions in one project store, make two children point to an offline former
      parent. Give child A an overlapping `parent` and `manual` source for that former parent, and child B
      only the `parent` source. Keep one child in an active turn, then run `spex session reparent <child-a>
      <child-b> --to <replacement>`. Inspect `session ls`, each record and watcher relation, the
      replacement's received current-state notices, and a later child declaration.
    expected: >
      The command exits successfully without signalling or restarting either child. Both list-tree rows move
      to the replacement immediately; each child has the replacement as parent and exactly one replacement
      watcher carrying `parent`. Child A retains the former parent's `manual` source while child B drops its
      now-empty former-parent row. The replacement receives each current state and later transition; the
      former parent receives child A's later transition only through its surviving manual relation. A pending
      former-parent `continue` never reaches either child after the transfer, while its accepted historical
      timeline line is not erased.
    tags: [cli, backend-api]
    test: "spec-cli/src/session-reparent.test.ts"
    code: [spec-cli/src/session-reparent.ts, spec-cli/src/sessions.ts]
  - name: reparent-delivers-new-parent-snapshot
    tags: [backend-api]
    description: >
      In a migrated store, reparent a child through the backend API and read the new and former parents' queues.
    expected: >
      The new parent holds exactly one current-state snapshot sent by the child (`[spex watch] <child> is
      <status>`) and the child's `parent` watch relation names only the new parent.
    test:
      path: spec-cli/src/session-reparent.test.ts
      name: "session reparent updates the canonical projection after cutover"
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
  - name: top-level-detach-revokes-former-supervision
    description: >-
      Through a live backend with one governed CHILD under a former PARENT, give the parent a target-owned
      watch and an unhanded queued continue message. Submit the public reparent request with
      `{children:[CHILD], parent:null}`, then inspect the response, child record, watcher file, and pending
      delivery queue.
    expected: >-
      The response names CHILD with `parent:null` and no notified parent. The durable child parent is null,
      its former parent's `parent` source and unhanded queue entry are gone, while any independent `manual`
      source remains. No root record, replacement parent source, or current-state notification is created; the
      child process and immutable history remain untouched.
    tags: [backend-api]
    test: spec-cli/src/session-reparent.test.ts
    code: [spec-cli/src/session-reparent.ts, spec-cli/src/sessions.ts]
---

# measuring session-reparent

Measure through real manager commands and the public session projection. Raw store inspection is supporting
evidence for the parent-and-watch invariant, never a substitute for the immediate list/tree and delivery loop.
