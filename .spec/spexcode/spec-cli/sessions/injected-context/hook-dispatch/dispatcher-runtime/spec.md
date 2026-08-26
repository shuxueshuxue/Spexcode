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

The materialized shim passes its adapter id before the event. The dispatcher consumes each native id — `claude`,
`codex`, `opencode`, `pi`, and `zcode` — plus the plugin form, exports it as `SPEXCODE_HARNESS`, then dispatches
the following event. An unknown or missing adapter id is an error. `zcode` shares the Claude-family payload parser; it
is still an explicit dispatcher id, so its generated `dispatch.sh zcode Stop` command cannot silently turn
`zcode` into an event name.

The same tree slot carries the dispatch-id allowlist from its last successful materialize. A project transport
may remain installed after a selection changes, but an event whose baked harness id is absent from THIS tree's
allowlist exits before any input handling. An absent allowlist means this tree is unmaterialized and is an error.

A missing manifest is an error because silently dropping lifecycle hooks hides a broken installation. All matching handlers preserve the
existing deterministic order, stdout concatenation, blocking declaration, and Codex stderr reason translation.

**A HANDLER THAT FAILS SAYS SO, whether or not it may block.** A non-blocking handler's exit code was dropped
and its captured stderr was overwritten by the next handler and deleted on exit, so a lifecycle hook that could
not do its job left no trace anywhere: the board simply kept whatever state it last held, and nobody could tell a
hook that ran and declined from a hook that never ran. That silence is the same class of failure as a missing
manifest, and it gets the same answer — the dispatcher names the event, the handler, and the exit code on its own
stderr and forwards whatever the handler wrote there. Reporting is the whole of it: the dispatch VERDICT stays the
blocking handlers', so a hook declared non-blocking can never become a gate by failing, and a noisy handler cannot
acquire the power to stop a turn.
