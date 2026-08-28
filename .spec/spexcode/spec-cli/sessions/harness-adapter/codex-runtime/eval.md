---
scenarios:
  - name: worktree-thread-hooks-fire-from-the-root-checkout-shim
    tags: [backend-api, cli]
    code: [spec-cli/src/harness.ts#codexHarness]
    description: >
      On a fresh-init project with a linked worktree, dispatch one Codex worker through the shared app-server and
      let it run a tool, edit a file, and stop. Read dispatch.sh's log and the session record; then remove
      `<mainCheckout>/.codex/hooks.json` while leaving the worktree's anchor and repeat one turn.
    expected: >
      With the root-checkout shim present all five events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
      Stop) reach dispatch.sh with the worktree as `proj`, the record advances past launch, and the commit carries
      the Session trailer; with the root shim gone and only the anchor left, no hook fires — the anchor is
      discovery plumbing, never the shim.
  - name: trust-write-refuses-an-unparseable-config-and-keeps-mode
    tags: [cli]
    code: [spec-cli/src/harness.ts#writeCodexTrust]
    description: >
      Point CODEX_HOME at a directory whose config.toml is mode 0600 and ends in a line cut short mid-value (the
      shape a concurrent codex rewrite leaves when read mid-way), and run `spex init --harness codex` on a fresh
      git repository. Then replace that config with a small parseable one, still 0600, and init again.
    expected: >
      The first init fails with a non-zero exit naming the config path and "does not parse as TOML", and the
      file's bytes are identical before and after — nothing of SpexCode's is appended to a file codex could not
      load. The second init succeeds, the file carries this project's trust block, and its mode is still 0600.
    test:
      path: spec-cli/src/harness.test.ts
      name: writeCodexTrust refuses to persist a config.toml that codex could not load, and replaces a good one without changing its mode
---
# measuring codex-runtime

Both halves of the layer-anchor rule are measured: presence fires everything, absence of the root shim fires nothing.
