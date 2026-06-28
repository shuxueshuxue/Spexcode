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
materialized into the agent's contract.

**Preset vs spexcode-only.** Two audiences read `.config`: this repo, and any project that runs `spex init`.
Most plugins are the **preset** — the universal spec-discipline machinery `init` seeds into every adopter from
`spec-cli/templates/spec/project/.config`: `core` (+ its hooks), `extract`, `forge-link`, `health`,
`memory-hygiene`, `regroup`, `sanity-check`, `scenario`, `supervisor`, `tidy`. Two are **spexcode-only** and
never ship, because they bind to this repo's own setup: `taste` (SpexCode's *own* engineering principles, which
an adopter authors for themselves) and `voice-before-ask` (needs this repo's local voice MCP). The template IS
the preset, node-for-node — a plugin added here ships to adopters unless it is one of those two. The template is
hand-kept in sync today (drift risk: a new preset plugin must be copied over); regenerating it from this set
minus the spexcode-only nodes is the durable fix.
