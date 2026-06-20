---
title: .config
status: active
hue: 110
desc: The instance home — SpexCode's DIY dev-flow plugins live here as skill-shaped config nodes.
---
`.config/` is the **instance** of the config system: the concrete dev-flow plugins SpexCode ships for
working in this repo. Each plugin is a skill-shaped node — its folder *is* the unit (a `spec.md` plus any
co-located scripts) — living as a flat child of `.config/` and carrying a `surface: slash|system` field
that names where it plugs in, per [[config]]'s [[surface]] field-driven routing.

`/api/config` and the launcher's system gather read from here, not from [[config]] (which holds the
*spec of the config system* itself). Only **built/active** plugins gather — a `pending` node is declared
intent, not yet an active plugin, so it renders on the board but is neither offered as a slash preset nor
folded into a system prompt.
