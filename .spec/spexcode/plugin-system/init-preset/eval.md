---
scenarios:
  - name: canonical-projector-parity
    tags: [cli]
    description: >
      Run the canonical projector's focused tests and check mode, then run the existing init and materialize
      integration tests against the checked-in generated seed. Inspect the generated membership and the
      high-risk shared core, reproduce-before-fix, and multi-file hook content.
    expected: >
      The generated adopter tree is exactly the seedable projection: every shared byte and executable bit
      matches the live authoring source after only the declared root/link transforms; explicit holdbacks are
      absent; and content, missing, extra, or mode drift is reported. Core carries evidence-kind and post-commit
      codeSha discipline, reproduce-before-fix carries verify→commit→file ordering, and both Codex multi-file
      handlers are current. Init and materialize integration tests pass using that generated tree.
---
# measuring the shipped seed

This is a deterministic CLI/integration contract: the projector proves the template is derived, and the
existing adoption/materialization tests prove that exact output is consumable through the real product path.
