---
scenarios:
  - name: installed-cli-completes-the-offline-self-launch-loop
    tags: [cli]
    description: >
      Pack both packages, install only those tarballs into a clean external consumer, prove package resolution is
      under node_modules, and invoke the installed binary as a fresh process for every initialize, enqueue, pending,
      dequeue, empty-dequeue, idempotent replay, and conflict step.
    expected: >
      With no backend or resident process, pending preserves A then B, dequeue returns A then B then null, bodies are
      base64, exact idempotent replay returns one message id, changed bytes fail with
      PROTOCOL_IDEMPOTENCY_CONFLICT, and a message survives between independent processes with no wake hint. Unknown
      argv including --message-id exits 2; protocol failures exit 1 in the frozen stderr shape.
    code: packages/session-selflaunch/src/cli.ts
---
# self-launch CLI loss

The scenario is measured through `node_modules/.bin/spex-session`, once per operation. Keeping every step in a fresh
process is part of the contract: an in-process helper would hide open/close behaviour and could accidentally provide
the resident state this adopter explicitly does not have.
