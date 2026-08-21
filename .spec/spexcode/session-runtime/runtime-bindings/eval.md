---
scenarios:
  - name: binding-generation-fences-stale-runtime
    tags: [backend-api]
    description: A package-level binding test exercises a bind, rebind, and stale-generation writer.
    expected: A stale runtime cannot overwrite a newer binding, and rebinding after restart increments generation.
    test: packages/session-runtime/src/index.test.ts
  - name: binding-preserves-protocol-queue-on-unbind
    tags: [backend-api]
    description: A package-level binding test unbinds a runtime while a protocol message remains pending.
    expected: Unbinding leaves the protocol address and pending messages untouched.
    test: packages/session-runtime/src/index.test.ts
  - name: installed-runtime-bindings-clean-consumer
    tags: [backend-api]
    description: An external installed consumer binds, resolves, unbinds, rebinds, and delivers through the protocol.
    expected: A clean consumer proves the binding component without adding fields to the protocol schema.
    code: scripts/runtime-bindings-yatu.mjs
---
# session runtime bindings eval

The scenario commands are placeholders until the package implementation exists. Readings must be filed only after the
real package and a clean installed consumer run on the committed implementation.
