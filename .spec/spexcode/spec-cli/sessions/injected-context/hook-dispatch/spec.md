---
title: hook-dispatch
status: active
hue: 280
desc: The harness-agnostic hook delivery layer — discover surface:hook nodes, compile them into a PERSISTENT flat manifest, and run them deterministically through one pure-shell dispatcher whose cheap content-hash gate re-renders only when the editable .config moves.
code:
  - spec-cli/src/hooks.ts
related:
  - spec-cli/src/hook-dispatch.test.ts
  - spec-cli/hooks/dispatch.sh
---

# hook-dispatch

## raw source

A launched agent's lifecycle hooks are not wired harness-by-harness in code; they are **discovered** from
the spec tree and delivered through one stable mechanism that works the same on Claude Code and Codex.
Three parts: the **handlers** are `surface: hook` nodes (each a co-located script declaring the `events`
it binds, an `order`, and whether it may `block`) — the spec-governed content, discovered recursively
under the config roots. A **compiler** flattens them into a flat manifest (`event · order · block · script`),
written PERSISTENTLY to `<runtime>/hooks-manifest` — the per-project GLOBAL store dir (`layout.runtimeRoot`,
mirrored in shell as `hp_runtime_dir`), NOT the worktree, so rendering leaves zero SpexCode runtime in the
tree ([[runtime]]). It is a pure function of the `.config` content, so it is regenerated NOT per session but
only when that content actually moves. The **dispatcher** (`dispatch.sh`, the one shim entry per event) runs
in two steps: a **gate** — a ~10ms pure-shell content hash of the config roots on every event; on a mismatch
with the stored `<runtime>/content-hash` it runs `spex materialize` ([[harness-delivery]], the ~0.85s node
render) under a re-checked lock (also in `<runtime>`), so node boots only on a real change and concurrent
sessions never race the write — then it dispatches the event's handlers from the (now-fresh) persistent manifest.
That gate lock is **POSIX-portable** — an atomic `mkdir` mutex with a bounded wait, NOT util-linux `flock`
(absent on macOS, where the flock path silently no-op'd and let concurrent sessions race the write); it is held
only across the re-check + render and released immediately, and a stale lock dir left by a dead entrant is
cleared after a bounded wait so it can never deadlock a launch. The hash is content-based, so it catches bash/sed/user/other-agent/git edits alike;
a tool-payload path would miss them.

The dispatcher reproduces the native multi-hook contract — which on BOTH harnesses runs matching hooks in
parallel with no ordering guarantee — but **deterministically**: it feeds each handler the original hook
stdin, runs them all in manifest order so every side effect is preserved, concatenates their stdout
(block decisions / additionalContext) through, and exits 2 when a handler declared `block: true` and either
exited 2 OR emitted a `{"decision":"block", ...}` JSON decision. That exit code is the signal both harnesses
propagate back to the model; the stdout JSON is the reason/additionalContext payload Claude reads. Codex,
however, reads a Stop block's continuation prompt from STDERR — so on the JSON-decision path under codex,
when the handler wrote its `decision:block` to stdout and left stderr empty, the dispatcher extracts the
`reason` and forwards it to stderr; else codex would see exit 2 with no continuation. A handler that did not
declare blocking can never block its event; a missing manifest dispatches nothing.

This is the substrate the spec-aware injections ([[spec-first]], [[spec-of-file]]) and the lifecycle gates
ride on. Which nodes plug in is a [[surface]] field decision, not a code change here; adding or retiring a
hook is a spec edit. The contract text (the `surface: system` bodies) is rendered by the same gate into the
AGENTS.md/CLAUDE.md block ([[harness-delivery]]); only the event HOOKS converge through this dispatcher.
