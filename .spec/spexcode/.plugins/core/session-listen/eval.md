---
scenarios:
  - name: materialized-listener-registers-session
    tags: [cli]
    description: >-
      In a temporary adopter project, materialize the real plugin manifest and invoke the real dispatch.sh path
      for SessionStart. Resolve the installed spex-session through PATH and through an explicit SPEX_SESSION_CLI
      override, initialize the native payload session, and repeat SessionStart against the same protocol database.
    expected: >-
      SessionStart creates one protocol address and the repeat is idempotent. The hook emits no prompt-delivery
      context and never dequeues messages; backend push or an explicit caller owns receipt. No configured database
      yields byte-empty stdout and stderr with exit zero. A configured database and missing CLI exits nonzero with
      one stderr repair line naming installation and SPEX_SESSION_CLI.
code: .spec/spexcode/.plugins/core/session-listen/session-listen.sh
related: .spec/spexcode/session-runtime/self-launch-entry/self-launch-cutover/spec.md
---
