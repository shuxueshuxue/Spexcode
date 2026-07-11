---
title: hook-dispatch
status: active
hue: 280
desc: The harness-agnostic hook delivery layer — discover surface:hook nodes, compile them into a PERSISTENT flat manifest in the materialized tree's own store slot, and run them deterministically through one pure-shell dispatcher; dispatch only, never a materialize trigger (the old content-hash gate is retired).
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
written PERSISTENTLY into the materialized tree's OWN slot — `<runtime>/trees/<enc-worktree>/hooks-manifest`
under the per-project GLOBAL store ([[runtime]]; shell mirror `hp_tree_dir`), NOT the worktree, so
materializing leaves zero SpexCode runtime in the tree. The slot is PER WORKTREE because the manifest is a
pure function of the `.config` content of the tree that materialized it: the old single global file made the
LAST materialize win, so when two trees' `.config` diverged (any node branch editing `.config` vs main),
dispatch ran tree A's compiled hook set inside tree B's sessions — cross-session hook bleed. The slot key
is the sessions-store `encodeProject` transform applied to the worktree's `rev-parse --show-toplevel`;
the dispatcher derives it from its own cwd, so a dispatch can only ever read the manifest of the tree it
fires in. The **dispatcher** (`dispatch.sh`, the one shim entry per event)
does exactly ONE job: it dispatches the event's handlers from the persistent manifest. It is deliberately
NOT a materialize trigger — the old content-hash gate (an auto-`spex materialize` on every event when the
config fingerprint moved, serialized by a mkdir mutex) is RETIRED ([[commit-surgery]]): a harness event
never materializes. The manifest and every other artifact refresh at the git-native anchors (the spex verbs,
session-worktree creation, the pre-commit / post-checkout / post-merge hooks), which keeps the hook hot
path pure bash with zero node boots and makes `.config` edits git-transactional — they take effect at the
commit/checkout/merge that carries them, like any other source change.

**Migration window (pre-slot trees).** A worktree last materialized by a pre-slot toolchain has no slot until
its next git-native anchor plants one. A slot-less dispatch FALLS BACK to the legacy global
`<runtime>/hooks-manifest` — the very file (and one-slot semantics) it read before the migration — so no
hook, the Stop gate included, silently no-ops in the window. The legacy file is never written again: the
tree's next anchor plants its slot, the fallback goes dead, and the stale file is residue until
[[spex-uninstall]]'s whole-store sweep. An explicit `SPEX_HOOK_MANIFEST` override skips both lookups.

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
hook is a spec edit. The contract text (the `surface: system` bodies) is materialized by the same pass
into the AGENTS.md/CLAUDE.md block ([[harness-delivery]]); only the event HOOKS converge through this
dispatcher.
