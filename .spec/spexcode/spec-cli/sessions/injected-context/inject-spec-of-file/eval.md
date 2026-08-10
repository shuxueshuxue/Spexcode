---
scenarios:
  - name: actionable-edit-context-uses-the-runtime-prompt-registry
    tags: [cli]
    test:
      path: spec-cli/src/hook-dispatch.test.ts
      name: spec-of-file
    description: >-
      Through the real dispatch.sh + spec-of-file.sh + `spex spec owner --actionable` path in a temporary
      project, send Claude-shaped Write and Codex-shaped apply_patch payloads for one uncovered source file,
      then repeat each edit.
    expected: >-
      The first edit on each harness exits 0 and emits one PostToolUse additionalContext whose fixed envelope
      is the HookPromptCatalog template and whose dynamic detail identifies the uncovered file. Repeating the
      same file emits no second context. The prompt catalog and the live handler therefore share the same
      model-facing text while the once-per-file ledger remains intact.
---
# eval.md — inject-spec-of-file

The loss is prompt drift at the hook boundary: a public catalog entry must name the text the runtime actually
emits, without making a once-per-file annotation chatty or moving harness-specific matching out of the adapter.
