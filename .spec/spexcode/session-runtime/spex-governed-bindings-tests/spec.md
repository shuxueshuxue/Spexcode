---
title: Spex governed binding adapter tests
status: active
hue: 280
desc: Narrow regression tests for transaction ownership, exact identity forwarding, and namespace stability.
code:
  - spec-cli/src/session-runtime-adapter.test.ts
related:
  - .spec/spexcode/session-runtime/spex-governed-bindings/spec.md
---
# Spex governed binding adapter tests

The tests prove that one supplied protocol transaction owns each mutation, that all exact native identity fields and
generation options reach the binding store unchanged, that an absent start token fails before transaction entry, and
that resolve and unbind cannot drift into an adopter-selected namespace.
