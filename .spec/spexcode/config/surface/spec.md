---
title: surface
status: pending
hue: 260
desc: A config node declares how it plugs in via a `surface` field; the engine gathers presets by surface.
code:
---
# surface

A config node declares **where it plugs in** with a `surface` field, one of
`slash | system | skill | setup`. The engine gathers every config node and routes it by that field:

- **slash** — offered in the new-session `/` dropdown as a launchable preset the human picks.
- **system** — its body is folded into a launched agent's system prompt: an always-on contract, not a
  chosen command.
- **skill** — its folder is exposed as a skill bundle the agent can invoke on demand.
- **setup** — its script runs at onboarding/init to prepare the environment.

`surface` is the single axis the launcher reads to decide *when and how* a preset is delivered; a node's
body and co-located bundle files mean the same thing across surfaces — only the delivery differs. A node
with no `surface` keeps today's behavior (a `slash` preset).
