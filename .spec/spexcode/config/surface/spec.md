---
title: surface
status: active
hue: 260
desc: A config node's surface is a frontmatter FIELD — surface: system|slash|hook — not its location; discovered recursively under a config root.
code:
---
# surface

A config node's **surface** — where it plugs in — is a `surface` **frontmatter field**, one of three values:

- `surface: slash` — a **slash** preset, offered in the new-session `/` dropdown.
- `surface: system` — a **system** contract, its body folded into a launched agent's
  `--append-system-prompt`.
- `surface: hook` — a **lifecycle hook handler**: a co-located script the [[hook-dispatch]] layer runs on
  the harness events in its `events:` list, in `order:`, blocking when `block: true`. The handler set is
  compiled into a per-session manifest, so adding or retiring a hook is a one-line surface edit, not a code
  change in the launcher.

The surface is a FIELD, not a path: a plugin carrying it is a real graph node and is discovered
**recursively** under a config root — so a grouping plugin may itself be a plugin whose children carry a
different surface (e.g. [[.config]]'s `core` is a `system` contract whose children are `hook` handlers).
There are no `slash/`/`system/`/`hook/` bucket dirs. Changing a surface is a one-line frontmatter edit.

Both config roots participate: [[.config]] (the instance — the DIY dev-flow plugins) and [[config]] (the
project system spec). A node that declares no `surface` (e.g. this doc node, or any non-plugin folder)
reaches no surface at all.

In [[source-of-truth]]'s `specs.ts`, `loadSurface(s)` walks each root recursively and keeps the nodes whose
`surface` field equals `s`: `loadConfig` gathers slash ([[spec-cli]]'s `/api/config`, the
[[session-console]] `/` palette), `loadSystemConfig` gathers system ([[sessions]]'s launcher), and
`loadHookConfig` gathers hook (compiled into the dispatch manifest). Only **built/active** plugins gather —
a `status: pending` node is declared intent, so it renders on the board but reaches no surface.
