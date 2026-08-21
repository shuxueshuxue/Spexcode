---
title: runtime bindings package entry
status: active
hue: 280
desc: The public entry point for adopter-owned runtime identity bindings.
code:
  - packages/session-runtime/src/index.ts
related:
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
---
# runtime bindings package entry

The package entry exposes only the binding component API. It composes with a live `SessionProtocol` handle and
never imports session topology, a harness implementation, a process manager, or an event projection. Its generation
fence is the only concurrency policy in this package: an adopter decides what a native identity means and when to
bind or unbind it.
