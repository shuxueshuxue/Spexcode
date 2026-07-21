---
title: commands
status: active
hue: 40
desc: Grouping shelf for the `surface: command` prompt presets offered wherever a human composes work for an agent. A shelf, not a surface — routing stays field-driven per [[surface]].
---
# commands

The invocable **command** plugins live here: leaf plugins whose body is a prompt preset a human can pick
from the `/` dropdown while launching or driving a session, each carrying `surface: command`. Grouping them keeps `.plugins/` legible at
a glance — the command presets on this shelf, the skill plugins on [[skills]], the auxiliary system
contracts on [[prompts]], with [[core]] (the dev-flow contract subsystem) a flat child beside them.

Invocation belongs to the backend prompt boundary, not to whichever client happens to render the picker.
Every compose surface sends the raw `/<preset> [[node]]… <free text>` prompt; the shared resolver expands the
live `surface: command` body before either [[launch]] starts a worker or [[dispatch]] sends text to one. At
launch, the raw invocation remains the session's originating prompt and identity source, so links inside a
plugin body can never invent a node target. Dashboard and phone menus are therefore discovery/insertion
chrome, while dashboard, phone, CLI, API, and in-process fallback all invoke through the same backend
resolution. A preset with `{{targets}}` always receives the resolved target block; one without that placeholder
gets a target block only when the invocation actually names a target, so a targetless utility remains a small
prompt. An unknown leading `/name` stays ordinary prompt text and is never swallowed or guessed.

This node is a **shelf, not a surface** (the [[prompts]] shape): it declares no `surface` field and
gathers nothing itself. Discovery is recursive and field-driven ([[surface]]), so a resident plugs in
exactly as it would at the root — the gather set is path-independent, so shelving a command changes
nothing about what `/api/plugins` and the launcher offer. A plugin that serves BOTH surfaces (e.g.
[[distill]], skill and command) shelves once by its primary identity, never duplicated. The init
templates mirror this layout. The shelf stays pure presentation: moving a resident beneath it changes
neither that plugin's identity nor the surfaces gathered from its frontmatter.
