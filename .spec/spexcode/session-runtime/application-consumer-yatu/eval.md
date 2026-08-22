---
scenarios:
  - name: installed-complete-application-consumer
    tags: [backend-api, cli]
    description: Pack and install protocol, topology, runtime bindings, events, and application into an external consumer, then attach, publish, and dequeue through public exports.
    expected: The installed dependency graph resolves all five packages and the consumer observes one recipient, one exact durable message, and one successful dequeue.
    test: scripts/session-application-yatu.mjs
    code: scripts/session-application-yatu.mjs
---
# installed application consumer loss

The packed external consumer is the measurement surface. Workspace imports are not sufficient because they can hide a
missing tarball dependency.
