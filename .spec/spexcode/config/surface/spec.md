---
title: surface
status: active
hue: 260
desc: A config node's surface is a frontmatter FIELD — surface: system|slash — not its location; plugins are flat children of a config root.
code:
---
# surface

A config node's **surface** — where it plugs in — is a `surface` **frontmatter field**, one of two values:

- `surface: slash` — a **slash** preset, offered in the new-session `/` dropdown.
- `surface: system` — a **system** contract, its body folded into a launched agent's
  `--append-system-prompt`.

A config plugin is a **flat direct child** of a config root (`<root>/<name>/spec.md`) carrying that field.
There are no `slash/` or `system/` bucket dirs: those were graph-invisible grouping dirs (no `spec.md`, so
the spec graph skipped them — path didn't match the graph). With the surface as a field, every plugin is a
real graph child of its root, and changing a surface is a one-line frontmatter edit, not a reparent.

Both config roots participate: [[.config]] (the instance — the DIY dev-flow plugins) and [[config]] (the
project system spec). A flat child that declares no `surface` (e.g. this doc node, or any non-plugin folder)
reaches no surface at all.

In [[source-of-truth]]'s `specs.ts`, `loadSurface(s)` scans each root's flat children and keeps those whose
`surface` field equals `s`: `loadConfig` gathers the slash surface ([[spec-cli]]'s `/api/config`, the
[[session-console]] `/` palette), and `loadSystemConfig` gathers the system surface ([[sessions]]'s launcher).
Only **built/active** plugins gather — a `status: pending` node is declared intent, so it renders on the
board but reaches no surface.
