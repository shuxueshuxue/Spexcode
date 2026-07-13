---
title: commands
status: active
hue: 40
desc: Grouping shelf for the `surface: command` plugins — the `/`-dropdown launch presets a new session can pick. A shelf, not a surface — routing stays field-driven.
---
# commands

The invocable **command** plugins live here: leaf plugins whose body is a launch preset a new session
picks from the `/` dropdown, each carrying `surface: command`. Grouping them keeps `.plugins/` legible at
a glance — the command presets on this shelf, the skill plugins on `skills/`, the auxiliary system
contracts on `prompts/`, with `core` a flat child beside them.

This node is a **shelf, not a surface**: it declares no `surface` field and gathers nothing itself.
Discovery is recursive and field-driven, so a resident plugs in exactly as it would at the root — a
plugin that serves both surfaces shelves once by its primary identity, never duplicated.
