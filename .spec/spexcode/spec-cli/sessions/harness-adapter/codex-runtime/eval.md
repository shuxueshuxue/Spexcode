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
---
# measuring codex-runtime

Both halves of the layer-anchor rule are measured: presence fires everything, absence of the root shim fires nothing.
