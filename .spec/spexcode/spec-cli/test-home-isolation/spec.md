---
title: test home isolation
desc: Default Node test processes keep temporary project roots out of the user's persistent SpexCode store.
code:
  - scripts/test-home.mjs
related:
  - spec-cli/package.json
  - spec-eval/package.json
  - spec-cli/src/test-home.test.ts
---
# test home isolation

Default Node test processes in packages that exercise temporary project roots use a fresh, disposable
`SPEXCODE_HOME`. A temporary root must never create a project directory in the user's persistent
`~/.spexcode` store; the disposable home is removed when its process exits. Tests that deliberately set
their own isolated `SPEXCODE_HOME` after startup keep that explicit fixture control.

An inherited `SPEXCODE_HOME` resolving to the user's real default home is rejected before the test suite
starts. This failure is deliberately loud: silently replacing that unsafe input would make a broken test
invocation appear isolated while hiding a persistent-store hazard from its caller.
