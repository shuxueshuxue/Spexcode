---
scenarios:
  - name: session-events-contiguous-immutable-stream
    tags: [backend-api]
    description: Package tests interleave two subject streams, mutate caller buffers, and attempt row mutation.
    expected: Each subject starts at sequence one and remains contiguous; stored bytes and prior rows cannot be changed.
    test: packages/session-events/src/index.test.ts
  - name: session-events-unknown-type-discipline
    tags: [backend-api]
    description: A replay contains one known event, one unknown ignorable event, and one unknown required event.
    expected: The ignorable event is skipped, while replay crossing the required unknown event fails loudly.
    test: packages/session-events/src/index.test.ts
  - name: installed-session-events-clean-consumer
    tags: [backend-api]
    description: A repository-external consumer installs packed protocol and events packages and reopens its database.
    expected: The installed public API atomically records a fact and message reference, then replays exact bytes after restart.
    code: scripts/session-events-yatu.mjs
---
# session events eval

Readings are filed only from the committed implementation. The installed-consumer reading must resolve both package
entrypoints from the external consumer rather than the source checkout.
