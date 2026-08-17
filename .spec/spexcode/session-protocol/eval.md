---
scenarios:
  - name: installed-package-roundtrip
    tags: [cli]
    description: >
      Pack session-protocol and its declared dependencies, install the tarballs in a fresh consumer outside the source
      repository, choose an isolated absolute sessionRoot outside the repository, and use only the public package
      entry to open that exact root,
      initialize an address, enqueue, dequeue, and read one message.
    expected: >
      The installed package resolves without source or TypeScript, dequeue returns the frozen message exactly
      once without invoking a harness callback, and readTimeline returns its immutable history from the exact
      caller-provided sessionRoot.
    code: packages/session-core/src/index.ts
    related: packages/session-core/package.json
  - name: keyed-accept-recovers-crash-boundaries
    tags: [cli]
    description: >
      Exercise an idempotent enqueue whose queue projection disappears after its journal entry, then exercise a
      dequeue journal entry whose queue head remains after the process exits.
    expected: >
      Reconcile restores the exact frozen pending message without recomposing; a dequeued leftover head is
      removed without returning it again; exact enqueue replay creates no duplicate.
    test:
      path: packages/session-core/src/session-protocol.test.ts
      name: a keyed retry restores debt lost after the receipt append, then settles exactly once
    code: packages/session-core/src/message.ts
    related: packages/session-core/src/delivery-queue.ts
  - name: installed-session-lifecycle-dogfood
    tags: [cli, backend-api]
    description: >
      Pack the root package, install it in a fresh consumer outside the source checkout, pass an isolated absolute
      sessionRoot,
      initialize a fresh Git project, and use only the installed CLI to start the backend and dispatch a real
      Codex child. The child must finish by declaring close-pending with the exact terminal note
      SESSION_CORE_PACKAGE_OK. Observe it through installed session wait and session show, then close that exact
      child through the installed CLI.
    expected: >
      The installed root resolves its bundled session-protocol without source or TypeScript fallback; the real child
      receives its complete originating prompt, reaches close-pending exactly once, and exposes only the exact
      terminal marker through the narrow session record. The named worktree and branch exist before close and are
      both retired afterward, proving installed create, record persistence, timeline wake, delivery, lifecycle,
      and close use the extracted durable protocol end to end.
    code: packages/session-core/src/index.ts
    related:
      - spec-cli/src/sessions.ts
      - spec-cli/src/session-follow.ts
      - spec-cli/package.json
  - name: self-launch-queue-needs-no-backend
    tags: [cli]
    description: >
      In a fresh installed consumer, initialize a native self-launch session address without session.json or a
      running Spex backend. Enqueue from a separate process, leave it offline, then start an explicit listener
      that uses only the public protocol entry.
    expected: >
      The exact message remains pending while no runtime exists, the listener dequeues it once in FIFO order,
      the address never appears as a governed board row, and correctness uses no filesystem notification.
  - name: dequeue-is-the-protocol-delivery-boundary
    tags: [cli]
    description: >
      Enqueue one message, dequeue it in a process that exits before invoking any harness adapter, then reconcile
      and start a second consumer.
    expected: >
      Pending remains empty and the second consumer receives nothing: the journal proves the dequeue committed.
      Adapter retry or acknowledgment is not silently reintroduced into the protocol.
  - name: three-adopters-share-one-file-language
    tags: [cli]
    description: >
      Exercise Z-Storm-style, self-launch, and Spex-governed consumer fixtures through the installed public
      package. Give each a different topology/runtime/materialization composition while using the same initialized
      address, message codec, enqueue, dequeue, timeline, and reconciliation operations.
    expected: >
      No adopter id, parent/watch field, governed field, lifecycle enum, harness callback, or native runtime
      dependency enters the protocol package. Each adopter can be removed without changing another's durable
      queue bytes.
  - name: concurrent-enqueue-and-dequeue-preserve-the-tail
    tags: [cli]
    description: >
      In independent processes, repeatedly enqueue ordinary unkeyed messages while another consumer dequeues the
      same address. Force the enqueue to overlap the dequeue read-modify-write boundary.
    expected: >
      Every message id appears exactly once in either the returned dequeue sequence or current pending projection,
      FIFO order is preserved, and no stale whole-file rewrite drops or resurrects the tail.
  - name: corrupt-protocol-state-fails-loud
    tags: [cli]
    description: >
      Replace each of protocol.json, pending.json, the delivery journal, and cursors.json with structurally invalid
      bytes before calling the relevant public read and mutation operations.
    expected: >
      The package distinguishes absent, empty, and corrupt state; corrupt bytes are preserved and every operation
      refuses with an actionable error until explicit reconciliation or repair proves authority.
  - name: caller-controls-the-session-root
    tags: [cli]
    description: >
      Run an installed public-package roundtrip from a process whose HOME, XDG directories, SPEXCODE_HOME,
      current project, and explicit absolute sessionRoot all name distinct empty locations.
    expected: >
      Every protocol byte and lock appears only below the explicit sessionRoot; the package neither reads nor
      creates .spexcode, a Git-derived project namespace, an XDG directory, or a SpexCode global config file.
---
# session-protocol loss

The package boundary is real only when an installed consumer can use the durable protocol and when the
receipt/queue crash boundaries remain one implementation rather than knowledge every runtime must reproduce.
