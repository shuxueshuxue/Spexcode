---
title: surface
status: active
hue: 260
desc: A config node's surface is its LOCATION — slash/ vs system/ — not a frontmatter field; the engine routes by path.
code:
---
# surface

A config node's **surface** — where it plugs in — is its **location on disk**, not a declared field. The
parent routing dir under a config root names the surface:

- `<root>/slash/<name>/spec.md` — a **slash** preset, offered in the new-session `/` dropdown.
- `<root>/system/<name>/spec.md` — a **system** contract, its body folded into a launched agent's
  `--append-system-prompt`.

Both config roots participate: [[.config]] (the instance — the DIY dev-flow plugins) and [[config]] (the
project system spec). The `slash/` and `system/` dirs are pure routing — they hold no `spec.md` of their
own, so they are not nodes; each preset's board parent stays the config root, and moving a node between
surfaces is a version-neutral reparent.

In [[source-of-truth]]'s `specs.ts`, `loadSurface(s)` scans `<root>/<s>/*` across every root: `loadConfig`
gathers the slash surface ([[spec-cli]]'s `/api/config`, the [[session-console]] `/` palette), and
`loadSystemConfig` gathers the system surface ([[sessions]]'s launcher, layered on top of the always-on base
contract). Only **built/active** plugins gather — a `status: pending` node is declared intent, so it renders
on the board but reaches no surface.

Path-driven routing is the whole mechanism: there is no `surface` frontmatter to parse, validate, or keep in
sync — a node's surface is wherever it lives, and re-homing it is the only way to change it.
