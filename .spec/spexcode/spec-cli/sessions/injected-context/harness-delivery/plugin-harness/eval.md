---
scenarios:
  - name: plugin-target-emits-self-contained-bundle
    tags: [cli]
    description: >-
      In a fresh git project carrying a docs/AGENT_GUIDE.md and the spec tree, set spexcode.json `harnesses` to
      [{"plugin":".zcode"}] and run `spex materialize`. Inspect what landed under .zcode and at the repo root.
    expected: >-
      A self-contained Claude-plugin bundle is written at .zcode/plugins/spexcode/ — a .claude-plugin/plugin.json
      (name spexcode + version + hooks/skills/commands/agents pointers), hooks/ (dispatch.sh + harness.sh copied
      verbatim, hooks.json binding every event to `dispatch.sh plugin <Event>` via ${CLAUDE_PLUGIN_ROOT}, the
      inject-contract.sh + its contract-context.json), and skills/commands/agents files. The contract-context.json
      carries the guide-first surface:system contract as hookSpecificOutput.additionalContext. NO native artifacts
      (CLAUDE.md block, .claude/settings.json) are written — the plugin is exclusive. The bundle dir is hidden via the per-clone exclude block.
  - name: contract-injects-as-sessionstart-additionalContext
    tags: [cli]
    description: >-
      After the emit above, set CLAUDE_PLUGIN_ROOT to the bundle dir and run hooks/inject-contract.sh as a host
      would on SessionStart; parse its stdout.
    expected: >-
      It prints valid JSON whose hookSpecificOutput.hookEventName is SessionStart and whose additionalContext is
      the assembled contract (the AGENT_GUIDE.md guide followed by the surface:system bodies). This is the
      harness-neutral contract delivery — no --append-system-prompt, no resident skill.
  - name: deselecting-a-plugin-folder-prunes-its-bundle
    tags: [cli]
    description: >-
      Materialize with [{"plugin":".zcode"}], confirm the bundle exists, then switch `harnesses` to
      [{"plugin":".claude"}] and re-materialize; finally switch to ["claude"] (native) and re-materialize.
    expected: >-
      Switching the folder PRUNES .zcode/plugins/spexcode and emits .claude/plugins/spexcode; switching to native
      PRUNES the plugin bundle and writes the native CLAUDE.md block + .claude/settings.json shim. The prune is
      identity-gated on the bundle's own plugin.json, so a foreign plugin sharing the folder is never touched.
---
# eval.md — plugin-harness

Loss is read through the CLI surface a real adopter touches (YATU): `spex materialize` on a project whose
spexcode.json names a `{"plugin":"<folder>"}` target. Three things must hold: the emit produces a complete,
self-contained Claude-plugin bundle (manifest + dispatch wiring + contract-as-additionalContext + skills/
commands/agents) and NO native artifacts; the SessionStart injector actually emits the contract as valid
additionalContext JSON (the harness-neutral stand-in for --append-system-prompt); and deselecting a folder
(folder A→B, or plugin→native) prunes the dropped bundle surgically via the previous-folder ledger, never
touching a foreign plugin. Use an isolated SPEXCODE_HOME so a measurement never writes the real user store.
