---
title: plugin-harness
status: active
hue: 280
desc: The plugin BUNDLE emitter — materialize the whole SpexCode system into one self-contained Claude-plugin bundle dropped into the spexcode.json-named folder, so a plugin host (z-code/Claude/future Codex) reads it natively with zero --append-system-prompt.
code:
  - spec-cli/src/plugin-harness.ts
related:
  - spec-cli/src/plugin-harness.test.ts
---

# plugin-harness

[[harness-select]] resolves a `{"plugin":"<folder>"}` target but emits nothing — it only validates the choice
and (being exclusive) leaves every native harness to be pruned. This node is that missing EMITTER: it materializes
the entire SpexCode system into ONE self-contained bundle and drops it under the host-scanned `<folder>` as
`<folder>/plugins/spexcode/`. [[harness-delivery]]'s materialize calls it AFTER pruning the natives (a plugin
is a SUPERSET delivery, so it replaces them, never coexists).

The bundle is the de-facto **Claude-plugin** schema: a `.claude-plugin/plugin.json` (`name: spexcode`, version,
description) pointing at `hooks/`, `skills/`, `commands/`, `agents/`. One `.claude-plugin` bundle reaches every
host because their discovery order is `.zcode-plugin > .claude-plugin > .codex-plugin` and z-code/Claude both
read a `.claude-plugin` directly — so the SAME emit serves ZCode, Claude, and a future Codex.

The pieces map from the same [[surface]] nodes the native path materializes, but through a plugin host's seams:

- **the contract** (the [[harness-delivery]] assembly — `docs/AGENT_GUIDE.md` followed by the `surface: system`
  bodies) is NOT an always-on `CLAUDE.md` block here — the bundle never edits the repo's own files. It maps to a
  **SessionStart hook that emits `hookSpecificOutput.additionalContext`** (the harness-neutral injection
  Claude/z-code normalize; the superpowers pattern), the stand-in for the `--append-system-prompt` a plugin host
  can't take. The additionalContext JSON is encoded at MATERIALIZE time into `hooks/contract-context.json`, so the
  runtime injector (`inject-contract.sh`) is a trivial `cat` — never a fragile shell escaping of arbitrary prose.
  The contract is delivered by a hook, NOT a resident skill.
- **the hooks** reuse the SAME `dispatch.sh` wiring as the natives — `dispatch.sh` + its shell mirror
  `harness.sh` are copied verbatim into `hooks/`, and `hooks/hooks.json` (the Claude/z-code shape
  `{ "hooks": { "<Event>": [...] } }`) binds every lifecycle event to `dispatch.sh`, located via the host's
  `${CLAUDE_PLUGIN_ROOT}` variable. The dispatcher's first arg is the harness id **`plugin`**, so its
  manifest dispatch runs exactly as for a native; `harness.sh` routes `plugin` through the **claude family**
  (z-code/Claude share Claude's tool names + `file_path`) via its default case, no separate arm. The per-event
  command bakes `SPEX` for the cli-needing handlers (the bundle re-emits at the git-native materialize anchors,
  [[commit-surgery]] — never on a harness event).
- **skills / commands / agents** ship as files in the Claude-plugin layout, reusing the same materialized
  skill and agent contents the native path uses plus a command build. Commands become real host slash-menu
  entries here — the
  plugin counterpart of the native path serving its command presets through the dashboard.

`clean()` is the bundle's surgical inverse, identity-gated on the bundle's own `plugin.json` name so it removes
ONLY a spexcode bundle, never a folder the user filled with another plugin. Because a plugin folder is an
open-ended string (unlike the finite native adapter set), pruning a DESELECTED folder needs the PREVIOUS set:
materialize keeps a tiny ledger in the global store of the folders it last emitted, and on each run cleans any
folder the current set dropped (plugin→native, or folder A→B). The emitted bundle is a generated, machine-local
artifact (its `hooks.json` bakes this install's `SPEX` path), so it joins the managed exclude block — like
every other materialized artifact, regenerated per clone/launch, never committed.
