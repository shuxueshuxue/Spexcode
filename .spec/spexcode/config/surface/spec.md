---
title: surface
status: active
hue: 260
desc: A config node's surface is a frontmatter FIELD — surface: system|command|hook|skill — not its location; discovered recursively under a config root.
code:
---
# surface

A config node's **surface** — where it plugs in — is a `surface` **frontmatter field**, one of four values:

- `surface: command` — a **command** preset, offered in the new-session `/` dropdown.
- `surface: system` — a **system** contract: its body is materialized (in name order) into the
  `<!-- spexcode -->` managed block of the repo's `CLAUDE.md`/`AGENTS.md`, where the harness **auto-discovers**
  it as always-on context. NOT a launch-time `--append-system-prompt` — delivery is by discovered file, the
  SAME for a dashboard- and a user-self-launched agent ([[harness-delivery]]).
- `surface: hook` — a **lifecycle hook handler**: a co-located script the [[hook-dispatch]] layer runs on
  the harness events in its `events:` list, in `order:`, blocking when `block: true`. The handler set is
  compiled into a per-session manifest, so adding or retiring a hook is a one-line surface edit, not a code
  change in the launcher.
- `surface: skill` — an **on-demand skill**: its body is rendered to a `SKILL.md` under each harness's skill
  dir (claude `.claude/skills/<name>/`, codex `.codex/skills/<name>/`) that the agent auto-discovers and loads
  **only when the task matches its `description`** (the node's `desc:`) — never folded into the always-on
  contract. Both harnesses ship the same agentskills.io `SKILL.md` primitive, so this is one format, two dirs:
  the divergence is a single [[harness-adapter]] `skillDir` line, nothing scattered.

The surface is a FIELD, not a path: a plugin carrying it is a real graph node and is discovered
**recursively** under a config root — so a grouping plugin may itself be a plugin whose children carry a
different surface (e.g. [[.config]]'s `core` is a `system` contract whose children are `hook` handlers).
There are no `command/`/`system/`/`hook/` bucket dirs. Changing a surface is a one-line frontmatter edit.

Both config roots participate: [[.config]] (the instance — the DIY dev-flow plugins) and [[config]] (the
project system spec). A node that declares no `surface` (e.g. this doc node, or any non-plugin folder)
reaches no surface at all.

In [[source-of-truth]]'s `specs.ts`, `loadSurface(s)` walks each root recursively and keeps the nodes whose
`surface` field equals `s`: `loadConfig` gathers command ([[spec-cli]]'s `/api/config`, the
[[session-console]] `/` palette), `loadSystemConfig` gathers system ([[sessions]]'s launcher), and
`loadHookConfig` gathers hook (compiled into the dispatch manifest), and `loadSkillConfig` gathers skill
(rendered to a per-harness `SKILL.md` by [[harness-delivery]]'s materialize). Only **built/active** plugins gather —
a `status: pending` node is declared intent, so it renders on the board but reaches no surface.
