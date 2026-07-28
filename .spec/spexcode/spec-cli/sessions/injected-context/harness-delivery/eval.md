---
scenarios:
  - name: self-launch-zero-friction-codex
    tags: [backend-api]
    description: >-
      The whole ideal path on a CLEAN machine state (isolated SPEXCODE_HOME + CODEX_HOME): run `spex init
      --harness codex` in a fresh project, enter an ordinary or linked checkout, then launch a REAL Codex
      session there as a user would (no SpexCode process in the launch). Give only a product task, with no
      Spex commands or workflow in the prompt, and inspect its concrete command/edit/recovery trajectory.
    expected: >-
      Codex starts straight into the session with ZERO prompts — no directory-trust prompt and no
      hooks-review prompt (the deterministic trusted_hash materialize wrote into the scoped global config is
      accepted). The materialized AGENTS.md <spexcode> index leads the agent to the real owner/help/guide
      surfaces: it reads the governing body, gives independent intent its own node, validates and commits the
      code plus spec, then files a correctly anchored reading. Checkout shape adds no copy/move workaround or
      launch ceremony. The user performed no step after materialize and did not teach that workflow.
  - name: contract-files-are-untracked-artifacts
    tags: [backend-api]
    description: >-
      In a fresh git project carrying the spec tree and an explicit harness selection, run `spex
      materialize`. Inspect the selected contract files, the working/index .gitignore pair and the common
      .git/info/exclude; then edit a surface:system node and run materialize again.
    expected: >-
      Only the selected harness contracts are written and none is tracked. Tree-local contracts, shims and
      skills are ignored by that tree's filtered working .gitignore while its index retains any host bytes;
      checkout-invariant residue and installed shared transport alone occupy common .git/info/exclude. Each
      contract's `<!-- spexcode:start -->…<!-- spexcode:end -->` block equals the surface:system bodies in
      name order — and NOTHING else, no per-project prose file; the next materialize reflects the edit.
      writeManagedBlock preserves bytes outside its markers.
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
      The freshness stamp is a function of (config content, toolchain). With the .plugins unchanged: source
      the shipped harness.sh from a package root, compute hp_config_hash,
      change the package's content (a version bump / source change), and compute it again; then also edit a
      .plugins body and compute a third time.
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
      block and the manifest current: .plugins edits are git-transactional ([[commit-surgery]]).
---
# eval.md — harness-delivery

Loss is measured through the REAL self-launch surface (YATU): a user-launched codex/claude on a clean,
isolated home must get the assembled contract, guides, hooks and zero-prompt trust with no instructional
workflow in the user prompt. The contract files (AGENTS.md/CLAUDE.md) are SpexCode-owned GENERATED artifacts
— never tracked, tree-locally ignored, regenerated per checkout — so the only tracked contract prose is the
plugin tree materialize assembles. Inspect the agent's actual choices and recovery, not only a prompt dump.
Always use isolated SPEXCODE_HOME/CODEX_HOME — never the real user config.
