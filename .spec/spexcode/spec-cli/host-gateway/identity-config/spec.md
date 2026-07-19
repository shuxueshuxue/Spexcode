---
title: identity config
hue: 180
desc: Project identity resolves from the portable dashboard title/icon fields; gateway identity resolves from one host config under SPEXCODE_HOME.
code:
  - spec-cli/src/project-identity.ts
related:
  - spec-cli/src/host.ts
  - spec-cli/src/graph.ts
  - spec-cli/src/index.ts
  - spec-cli/src/supervise.ts
---
# identity-config

Identity has exactly two authored sources. A project's human-readable source is its committed
`spexcode.json` `dashboard.title` and `dashboard.icon`; the gateway icon is the one host-level
`gateway.icon` value in `SPEXCODE_HOME/config.json`. Neither value is copied into the other tier.

Backends and the host catalog carry only a resolved `{title, icon}` projection. Missing values receive
stable defaults. Every backend registers the actual git tree it serves: a linked worktree gets its own
encoded endpoint/catalog id and cannot overwrite the main checkout's slot. The live instance answer repeats
that actual root, so merely claiming another checkout cannot pass validation.

The host exposes narrow, admin-authorized structured icon writes. A project write revision-checks and
updates only `dashboard.icon` in that project's portable JSON, including while its backend is offline; a
gateway write revision-checks and updates only the host config. Both accept the shared resolver's registry
ids and well-formed Iconify names and are atomic. Raw project-config editing remains the general settings
surface, not a second identity store; arbitrary legacy emoji/URL values remain readable without becoming
new structured-write choices.
