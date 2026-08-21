---
scenarios:
  - name: application-attach-notify-transaction
    tags: [backend-api]
    description: An installed application consumer attaches a relation and publishes one message to each recipient.
    expected: The relation, recipients, and protocol messages commit together and dequeue remains adopter-owned.
    test: packages/session-application/src/index.test.ts
  - name: application-rollback-after-topology-mutation
    tags: [backend-api]
    description: A forced failure after a topology mutation occurs before the application transaction commits.
    expected: The edge and every pending message are absent after rollback.
    test: packages/session-application/src/index.test.ts
  - name: installed-session-application-consumer
    tags: [backend-api]
    description: A clean consumer installs packed protocol, topology, and application packages and completes a real notification loop.
    expected: The clean consumer observes one recipient, one durable message, and one successful dequeue.
    test: scripts/session-application-yatu.mjs
