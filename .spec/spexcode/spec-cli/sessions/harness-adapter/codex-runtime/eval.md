---
scenarios:
  - name: codex-generation-ledger-parse-cached
    tags: [backend-api]
    code: [spec-cli/src/codex-runtime-generations.ts#readCodexGenerationLedger]
    description: >
      Warm the same backend and capture a 5 s CDP CPU profile with the repository's profiler. Repeat the
      profile after the ledger cache is warm, keeping the backend, store, and profiler interval identical.
    expected: >
      In the measured throwaway workload, the ledger parser is absent from the self-time and inclusive CPU
      tops; unchanged `(path, mtimeNs, size)` signatures reuse the parsed value without a file read, and a
      ledger replacement is observed on the next read. Production-load percentage validation is a live-backend
      follow-up because the throwaway has no active SSE/poll demand.
  - name: worktree-thread-hooks-fire-from-the-root-checkout-shim
    tags: [backend-api, cli]
    code: [spec-cli/src/codex-harness.ts#codexHarness]
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
    code: [spec-cli/src/codex-harness.ts#writeCodexTrust]
    description: >
      Point CODEX_HOME at a directory holding a small parseable config.toml with mode 0600 and run
      `spex init --harness codex` on a fresh git repository. Then overwrite that config with one that ends in a
      line cut short mid-value (the shape a concurrent codex rewrite leaves when read mid-way), still 0600, and
      run `spex materialize`.
    expected: >
      After init the file carries this project's trust block, parses, and is still mode 0600. The materialize
      against the truncated file exits non-zero naming the config path and "does not parse as TOML", and the
      file's bytes are identical before and after — nothing of SpexCode's is appended to a file codex could not
      load, and no staging file is left beside it.
    test:
      path: spec-cli/src/harness.test.ts
      name: writeCodexTrust refuses to persist a config.toml that codex could not load, and replaces a good one without changing its mode
  - name: codex-tui-finished-turn-closes-through-public-api
    tags: [backend-api, cli]
    code: [spec-cli/src/codex-harness.ts#codexHarness, spec-cli/src/sessions.ts]
    description: >-
      Through the public `spex session new --launcher codex` path, run a trivial no-edit task whose final work
      action is a tool call, wait for `done --propose close` and `close-pending`, then invoke `spex session close`
      immediately and inspect the native rollout tail and retained session record.
    expected: >-
      The native rollout has a terminal task-complete event, the record is close-pending before close, and the
      public close succeeds without an active-turn refusal; the session is retired and its worktree is removed.
---
# measuring codex-runtime

Both halves of the layer-anchor rule are measured: presence fires everything, absence of the root shim fires nothing.
