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
  - name: contract-files-are-untracked-artifacts
    tags: [backend-api]
    description: >-
      In a fresh git project carrying a docs/AGENT_GUIDE.md, run `spex materialize`. Inspect the generated
      AGENTS.md/CLAUDE.md, `git check-ignore` them (the managed block lives in the per-clone
      .git/info/exclude — the host .gitignore is never touched), then edit a
      surface:system node, commit or run materialize again.
    expected: >-
      AGENTS.md and CLAUDE.md are written and BOTH are ignored via the exclude block (alongside the shims +
      skills), so a clone never carries a committed copy —
      only docs/AGENT_GUIDE.md is tracked, and no .gitignore is created or edited. Each file's
      `<!-- spexcode:start -->…<!-- spexcode:end -->` block
      equals the AGENT_GUIDE.md guide followed by the surface:system bodies in name order; the next materialize
      reflects the edited body. The writeManagedBlock primitive still preserves any bytes outside the markers.
  - name: exclude-block-checkout-invariant
    tags: [backend-api]
    code: spec-cli/src/materialize.ts
    description: >-
      In a repo with a codex harness, run `spex materialize` from the MAIN checkout and (separately) from a
      linked WORKTREE, and compare the managed block in the SHARED .git/info/exclude (common git dir) each
      produces; re-run from each to check for churn.
    expected: >-
      Both checkouts emit the IDENTICAL managed block — in particular the codex hooks shim appears as
      `.codex/hooks.json` from BOTH (a worktree, where that path escapes `proj`, anchors it to the main
      checkout rather than dropping it). A re-run from
      either checkout leaves the shared exclude byte-stable — materialize never churns the common file the
      two checkouts share.
  - name: codex-trust-is-scoped-and-additive
    tags: [backend-api]
    description: >-
      Pre-seed the global ~/.codex/config.toml with unrelated user keys + another project's trust, then run
      `spex materialize` for THIS project. Inspect the config.
    expected: >-
      Only this project's `[projects."<path>"]` + per-hook `[hooks.state."…"]` block (between the spexcode
      sentinels) is added/replaced; the user's other keys and the other project's trust are untouched. The
      trusted_hash values match codex's own computation (codex accepts them with no re-prompt).
  - name: content-key-covers-renderer
    tags: [cli]
    description: >-
      The freshness stamp is a function of (config content, toolchain). With the .config unchanged: source
      the shipped harness.sh from a package root, compute hp_config_hash,
      change the package's content (a version bump / source change), and compute it again; then also edit a
      .config body and compute a third time.
    expected: >-
      The stamp MOVES on the toolchain change alone and again on the config edit, and is byte-stable when
      neither input changed — so a stale stamp is a truthful diagnostic ("the last materialize predates this
      toolchain/config") that doctor/debugging can trust. A key that ignores the toolchain would read an
      out-of-date deploy as fresh.
  - name: dispatcher-never-renders
    tags: [backend-api]
    description: >-
      With artifacts already materialized, EDIT a surface:system node's body by any means (bash echo /
      editor) and fire a harness tool event through dispatch.sh; then bring the edit to a git-native anchor
      (commit it, or run `spex materialize`).
    expected: >-
      The harness event materializes NOTHING — the contract file and manifest are byte-unchanged, the hook hot
      path stays pure bash with zero node boots. The git-native anchor then brings the AGENTS.md/CLAUDE.md
      block and the manifest current: .config edits are git-transactional ([[commit-surgery]]).
---
# eval.md — harness-delivery

Loss is measured through the REAL self-launch surface (YATU): a user-launched codex/claude on a clean,
isolated home must get the full SpexCode system (the assembled guide + contract + hooks + zero-prompt trust)
with no step after `spex init`. The contract files (AGENTS.md/CLAUDE.md) are SpexCode-owned GENERATED
artifacts — never tracked, exclude-hidden, regenerated per clone/launch — so the only tracked contract
prose is the docs/AGENT_GUIDE.md source the materialize folds in. Verify the contract reaches the model via `codex debug
prompt-input` (no model call needed); verify trust via a real TUI launch (zero prompts). Always use isolated
SPEXCODE_HOME/CODEX_HOME — never the real user config.
