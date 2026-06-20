---
title: surface
status: active
hue: 260
desc: A config node declares how it plugs in via a `surface` field; the engine gathers presets by surface.
code:
---
# surface

A config node declares **where it plugs in** with a `surface` field — one value, or a list, of
`slash | system | skill | setup`. A node with no `surface` keeps today's behavior (a `slash` preset).
`surface` is the single axis the engine routes on: a node's body and co-located bundle mean the same
thing across surfaces — only the *delivery* differs.

`loadConfig` (in [[source-of-truth]]'s `specs.ts`) reads the plugin instances from the [[.config]] tree,
parses `surface` onto every preset (defaulting to `['slash']`), and `/api/config` ([[spec-cli]]) ships
them. Only **built/active** plugins gather — a `status: pending` node is declared intent, so it is filtered
out and reaches no gather-point. Two gather-points consume the rest today:

- **slash** — the new-session `/` dropdown lists **only** `surface: slash` config nodes as launchable
  presets. The dashboard ([[session-console]]'s `SessionInterface.jsx`) filters to slash nodes for both
  the palette and the `/<name>` compose grammar, so a non-slash node is never offered or composed.
- **system** — at launch, [[sessions]]'s launcher appends each `surface: system` node's body to the
  agent's `--append-system-prompt`, on top of the always-on base contract. These are SpexCode's
  always-on contracts (e.g. the dogfood ritual), configured as spec nodes rather than hardcoded — no
  slash, no agent choice. Built fresh per launch, so editing a system node takes effect on the next launch.

`skill` and `setup` are **defined-but-not-yet-gathered**: recognized, valid `surface` values reserved
for later gather-points — `skill` exposing a node's folder as a Claude Code skill bundle, `setup`
running a node's script at init. They are accepted and reported now; nothing routes on them yet.
