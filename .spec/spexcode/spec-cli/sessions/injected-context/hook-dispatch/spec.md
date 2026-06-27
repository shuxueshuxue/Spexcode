---
title: hook-dispatch
status: active
hue: 280
desc: The harness-agnostic hook delivery layer — discover surface:hook nodes, compile them once per session into a flat manifest, and run them deterministically through one pure-shell dispatcher the committed .claude/.codex shim binds to every lifecycle event.
code:
  - spec-cli/src/hooks.ts
  - spec-cli/hooks/dispatch.sh
  - spec-cli/hooks/sessionstart.sh
---

# hook-dispatch

## raw source

A launched agent's lifecycle hooks are not wired harness-by-harness in code; they are **discovered** from
the spec tree and delivered through one stable mechanism that works the same on Claude Code and Codex.
Three parts: the **handlers** are `surface: hook` nodes (each a co-located script declaring the `events`
it binds, an `order`, and whether it may `block`) — the spec-governed content, discovered recursively
under the config roots. A **compiler** flattens them, once per session at SessionStart, into a flat
per-session manifest (`event · order · block · script`); this is the only step that parses spec
frontmatter, so the hot path never walks the tree. A pure-shell **dispatcher**, bound by the committed
shim to one line per harness event, reads the manifest and runs every handler for that event.

The dispatcher reproduces the native multi-hook contract — which on BOTH harnesses runs matching hooks in
parallel with no ordering guarantee — but **deterministically**: it feeds each handler the original hook
stdin, runs them all in manifest order so every side effect is preserved, concatenates their stdout
(additionalContext) through, and exits 2 with a handler's stderr only when that handler declared
`block: true` and itself exited 2 — the one signal the harness propagates back to the model. A handler
that did not declare blocking can never block its event; a missing manifest dispatches nothing.

This is the substrate the spec-aware injections ([[spec-first]], [[spec-of-file]]) and the lifecycle gates
ride on. Which nodes plug in is a [[surface]] field decision, not a code change here; adding or retiring a
hook is a spec edit. The system surface (the appended prompt) is delivered separately by the launcher, not
through this layer — only the event hooks converge here.
