---
scenarios:
  - name: self-launch-zero-friction-codex
    description: >-
      The whole ideal path on a CLEAN machine state (isolated SPEXCODE_HOME + CODEX_HOME): run `spex init`
      in a fresh project, then launch a REAL codex TUI in that project as a user would (no SpexCode process
      in the launch). Observe the startup and the model-visible prompt.
    expected: >-
      Codex starts straight into the session with ZERO prompts — no directory-trust prompt and no
      hooks-review prompt (the deterministic trusted_hash materialize wrote into the scoped global config is
      accepted). The materialized AGENTS.md <spexcode> block (the surface:system contract) is present in
      codex's model-visible prompt-input. The user performed no step after `spex init`.
  - name: managed-block-preserves-user-content
    description: >-
      In a project whose AGENTS.md (and CLAUDE.md) already contains the user's own text above and below where
      the block will go, run `spex materialize` once, then edit a surface:system node and run it again.
    expected: >-
      Only the content between the `<!-- spexcode:start -->` / `<!-- spexcode:end -->` markers is written/
      updated; every byte of the user's own surrounding text is preserved across both runs. The block content
      equals the current surface:system bodies in name order.
  - name: codex-trust-is-scoped-and-additive
    description: >-
      Pre-seed the global ~/.codex/config.toml with unrelated user keys + another project's trust, then run
      `spex materialize` for THIS project. Inspect the config.
    expected: >-
      Only this project's `[projects."<path>"]` + per-hook `[hooks.state."…"]` block (between the spexcode
      sentinels) is added/replaced; the user's other keys and the other project's trust are untouched. The
      trusted_hash values match codex's own computation (codex accepts them with no re-prompt).
  - name: pay-per-change-render
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
isolated home must get the full SpexCode system (contract + hooks + zero-prompt trust) with no step after
`spex init`, and must never clobber the user's own AGENTS.md/CLAUDE.md content. Verify the contract reaches
the model via `codex debug prompt-input` (no model call needed); verify trust via a real TUI launch (zero
prompts). Always use isolated SPEXCODE_HOME/CODEX_HOME — never the real user config.
