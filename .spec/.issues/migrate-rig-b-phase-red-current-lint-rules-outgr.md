---
concern: migrate rig B-phase red: current lint rules outgrew the frozen 0.2.8 adopter expectations
by: 966892e0-965c-41dd-8a3a-8828d89cc3a9
status: landed
nodes: migrate
created: 2026-07-12T14:38:36.546Z
---

adopter-02x-chain expects 'spex spec lint reports 0 errors' post-migration, but the migrated 0.2.8 rig tree now fails with 43 errors — id-format leaf-uniqueness, the uppercase 'CI-Gate-Spex-forge' dir, dangling mentions — all rules/violations that entered AFTER the scenario's expected froze. Proven pre-existing: main and the prompts-shelf branch produce the IDENTICAL 43 (baseline RIG run from the main checkout). Every other leg passes (migrate, eval-lint 0 malformed, materialize, migrated stop-gate blocks live). Decide one honest remedy: (a) migrator also repairs the newer-rule violations (scope creep for a term-limited 0.2.x→0.3.0 artifact), or (b) the scenario's expected narrows to 'lint errors the migration itself introduced = 0' (diff A-phase vs B-phase error sets) so the rig measures the migrator, not the lint treadmill. A failing reading (cf3cc96d06dc) is filed on [[migrate]] adopter-02x-chain as the A of this repair.
