---
title: session application state schema
status: active
hue: 280
desc: The adopter-owned state projection used by the production session application composition.
code:
  - packages/session-application/src/schema.ts
related:
  - .spec/spexcode/session-runtime/application-service/spec.md
---
# session application state schema

The application component owns one strict state row per initialized protocol address. It stores only the current
status, explicit parent address, and update time. Parent/child relations remain in the neutral topology component;
legacy JSON records are never copied into this table without the composition's explicit compatibility mode.
