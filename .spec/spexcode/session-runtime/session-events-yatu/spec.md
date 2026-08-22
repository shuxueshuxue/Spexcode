---
title: installed session events consumer
status: active
hue: 280
desc: A repository-external install and restart proof through public package exports.
code:
  - scripts/session-events-yatu.mjs
related:
  - .spec/spexcode/session-runtime/session-events/spec.md
---
# installed session events consumer

The YATU script is copied into an external npm consumer that installs packed protocol and events packages. It appends
an event and protocol reference in one transaction, closes the database, reopens it, replays the fact, and verifies
the protocol message still points at the same event id.
