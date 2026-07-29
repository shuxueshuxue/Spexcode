---
title: hook dispatcher runtime
status: active
hue: 280
desc: The one shell runtime that executes a complete manifest dispatch and preserves native hook blocking output.
code:
  - spec-cli/hooks/dispatch.sh
related:
  - spec-cli/src/hook-dispatch.test.ts
---

# hook dispatcher runtime

## raw source

The compiled manifest needs one executable owner. Dispatching is not merely related to the shell script: this
node governs the exact shell entry every harness invokes, including its scratch-state cleanup.

## expanded spec

`dispatch.sh` resolves the current tree's persistent manifest exactly as [[hook-dispatch]] defines and captures the
event input once before invoking any matching handler. A trap cleans up its per-dispatch scratch state on normal
completion, handler failure, signal, or shell exit.

The same tree slot carries the dispatch-id allowlist from its last successful materialize. A project transport
may remain installed after a selection changes, but an event whose baked harness id is absent from THIS tree's
allowlist exits before any input handling. Before the project migration marker, an absent allowlist is
the one-version legacy shape; afterwards absence is inert until a git-native materialize publishes it.

A missing manifest is a no-op because there is no handler work to run. All matching handlers preserve the
existing deterministic order, stdout concatenation, blocking declaration, and Codex stderr reason translation.
