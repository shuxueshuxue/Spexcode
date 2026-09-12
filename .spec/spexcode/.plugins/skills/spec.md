---
title: skills
status: active
hue: 280
desc: Grouping shelf for the `surface: skill` plugins — the harness skills an agent invokes on demand. A shelf, not a surface — routing stays field-driven per [[surface]].
---
# skills

The invocable **skill** plugins live here: leaf plugins that materialize into the harness's skill dir,
where an agent invokes them on demand, each carrying `surface: skill`. Grouping them keeps `.plugins/`
legible at a glance — the skill plugins on this shelf, the command presets on [[commands]], the auxiliary
system contracts on [[prompts]], with [[core]] a flat child beside them.

This node is a **shelf, not a surface**. Its routing and relocation invariant is owned once by
[[.plugins]]'s shelf invariant; this node only describes skill-specific materialization and invocation.
