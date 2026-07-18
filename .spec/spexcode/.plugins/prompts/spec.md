---
title: prompts
status: active
hue: 110
desc: Grouping shelf for the auxiliary `surface: system` prompt contracts — single-body always-on prose. Core is NOT a resident — the core contract subsystem is a direct `.plugins` child. A shelf, not a surface — routing stays field-driven per [[surface]].
---
# prompts

The **auxiliary** `surface: system` prompt contracts live here: leaf plugins whose whole substance is one
prose body an agent must always carry — materialized (in name order, together with every other system
body) into the `<!-- spexcode -->` contract block — rather than a verb it invokes. Grouping them keeps
`.plugins/` legible at a glance: peripheral prompt contracts on this shelf; the command presets on
[[commands]], the skill plugins on [[skills]], and [[core]] as a flat child beside it.

The shelf boundary is **leafness, not surface**: a single-body prose contract shelves here, while a
contract that anchors its own subtree outranks the shelf — [[core]], the dev-flow contract subsystem
whose children are the `surface: hook` gates, is a *peer* of this shelf, never a resident.

This node is a **shelf, not a surface**: it declares no `surface` field and gathers nothing itself.
Discovery is recursive and field-driven ([[surface]]), so residents plug in exactly as they would at the
root — nothing about materialization order (name order, unchanged names) or gathering changes with the
path. The init templates mirror this layout — a fresh `spex init` (per [[init-preset]]) seeds `core`
flat and its auxiliary system plugins under the same `prompts/` shelf. The shelf stays pure presentation:
changing this path changes neither a plugin's identity nor its gathered surface.
