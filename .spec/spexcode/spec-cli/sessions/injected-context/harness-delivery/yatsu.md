---
scenarios:
  - name: self-launch-zero-friction-codex
    tags: [backend-api]
    description: >-
      The whole ideal path on a CLEAN machine state (isolated SPEXCODE_HOME + CODEX_HOME): run `spex init`
      in a fresh project, then launch a REAL codex TUI in that project as a user would (no SpexCode process
      in the launch). Observe the startup and the model-visible prompt.
    expected: >-
      Codex starts straight into the session with ZERO prompts — no directory-trust prompt and no
      hooks-review prompt (the deterministic trusted_hash materialize wrote into the scoped global config is
      accepted). The materialized AGENTS.md <spexcode> block is present in codex's model-visible prompt-input
      and carries BOTH the docs/AGENT_GUIDE.md guide AND the surface:system contract bodies (guide first). The
      user performed no step after `spex init`.
  - name: contract-files-are-gitignored-artifacts
    tags: [backend-api]
    description: >-
      In a fresh git project carrying a docs/AGENT_GUIDE.md, run `spex materialize`. Inspect the generated
      AGENTS.md/CLAUDE.md, `git check-ignore` them and the managed `.gitignore` block, then edit a
      surface:system node and run materialize again.
    expected: >-
      AGENTS.md and CLAUDE.md are written and BOTH are git-ignored (their relative paths sit in the managed
      `# spexcode` .gitignore block alongside the shims + skills), so a clone never carries a committed copy —
      only docs/AGENT_GUIDE.md is tracked. Each file's `<!-- spexcode:start -->…<!-- spexcode:end -->` block
      equals the AGENT_GUIDE.md guide followed by the surface:system bodies in name order; the second run
      reflects the edited body. The writeManagedBlock primitive still preserves any bytes outside the markers.
  - name: gitignore-block-checkout-invariant
    tags: [backend-api]
    code: spec-cli/src/materialize.ts
    description: >-
      In a repo with a codex harness, run `spex materialize` from the MAIN checkout and (separately) from a
      linked WORKTREE, and compare the managed `.gitignore` block each produces; then commit the block and
      re-run materialize from each to check for a diff.
    expected: >-
      Both checkouts emit the IDENTICAL managed block — in particular the codex hooks shim appears as
      `.codex/hooks.json` from BOTH (a worktree, where that path escapes `proj`, anchors it to the main
      checkout rather than dropping it). With the committed `.gitignore` matching that block, a re-run from
      either checkout produces NO diff — materialize never re-dirties a clean tree, so the shared committed
      file is stable across main and every worktree.
  - name: codex-trust-is-scoped-and-additive
    tags: [backend-api]
    description: >-
      Pre-seed the global ~/.codex/config.toml with unrelated user keys + another project's trust, then run
      `spex materialize` for THIS project. Inspect the config.
    expected: >-
      Only this project's `[projects."<path>"]` + per-hook `[hooks.state."…"]` block (between the spexcode
      sentinels) is added/replaced; the user's other keys and the other project's trust are untouched. The
      trusted_hash values match codex's own computation (codex accepts them with no re-prompt).
  - name: pay-per-change-render
    tags: [backend-api]
    description: >-
      With artifacts already materialized and the content-hash marker current, fire a tool event (the
      dispatcher gate runs), then EDIT a surface:system node's body by any means (bash echo / editor) and
      fire another tool event.
    expected: >-
      The first event re-renders nothing (hash matches → ~10ms gate, no node boot, no file rewrite). After
      the edit the next event detects the hash moved and re-runs materialize once, so the AGENTS.md/CLAUDE.md
      block and the manifest reflect the new content; a third unchanged event again no-ops.
---
# yatsu.md — harness-delivery

Loss is measured through the REAL self-launch surface (YATU): a user-launched codex/claude on a clean,
isolated home must get the full SpexCode system (the assembled guide + contract + hooks + zero-prompt trust)
with no step after `spex init`. The contract files (AGENTS.md/CLAUDE.md) are SpexCode-owned GENERATED
artifacts — gitignored, regenerated per clone/launch — so the only tracked contract prose is the
docs/AGENT_GUIDE.md source the render folds in. Verify the contract reaches the model via `codex debug
prompt-input` (no model call needed); verify trust via a real TUI launch (zero prompts). Always use isolated
SPEXCODE_HOME/CODEX_HOME — never the real user config.
