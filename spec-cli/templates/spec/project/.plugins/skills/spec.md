---
title: skills
status: active
hue: 280
desc: Grouping shelf for the `surface: skill` plugins — the harness skills an agent invokes on demand. A shelf, not a surface — routing stays field-driven.
---
# skills

The invocable **skill** plugins live here: leaf plugins that materialize into the harness's skill dir,
where an agent invokes them on demand, each carrying `surface: skill`. Grouping them keeps `.plugins/`
legible at a glance — the skill plugins on this shelf, the command presets on `commands/`, the auxiliary
system contracts on `prompts/`, with `core` a flat child beside them.

This node is a **shelf, not a surface**: it declares no `surface` field and gathers nothing itself.
Discovery is recursive and field-driven, so a resident plugs in exactly as it would at the root. A plugin
that serves both surfaces shelves here by its primary (skill) identity and still gathers as a command
through its field.
