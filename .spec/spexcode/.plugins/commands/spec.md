---
title: commands
status: active
hue: 40
desc: Grouping shelf for the `surface: command` plugins — the `/`-dropdown launch presets a new session can pick. A shelf, not a surface — routing stays field-driven per [[surface]].
---
# commands

The invocable **command** plugins live here: leaf plugins whose body is a launch preset a new session
picks from the `/` dropdown, each carrying `surface: command`. Grouping them keeps `.plugins/` legible at
a glance — the command presets on this shelf, the skill plugins on [[skills]], the auxiliary system
contracts on [[prompts]], with [[core]] (the dev-flow contract subsystem) a flat child beside them.

This node is a **shelf, not a surface** (the [[prompts]] shape): it declares no `surface` field and
gathers nothing itself. Discovery is recursive and field-driven ([[surface]]), so a resident plugs in
exactly as it would at the root — the gather set is path-independent, so shelving a command changes
nothing about what `/api/plugins` and the launcher offer. A plugin that serves BOTH surfaces (e.g.
[[distill]], skill and command) shelves once by its primary identity, never duplicated. The init
templates mirror this layout. The shelf stays pure presentation: moving a resident beneath it changes
neither that plugin's identity nor the surfaces gathered from its frontmatter.
