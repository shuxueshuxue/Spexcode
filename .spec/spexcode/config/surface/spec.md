---
title: surface
status: active
hue: 260
desc: A config node's surface is a frontmatter FIELD — one or more of system|command|hook|skill|agent (comma-listed when several) — not its location; discovered recursively under a config root.
code:
---
# surface

A config node's **surface** — where it plugs in — is a `surface` **frontmatter field** naming one or MORE
of five values (comma-separated when several: the node plugs into EVERY surface it lists, one body serving
each — e.g. a plugin that is both an on-demand skill and a new-session command preset):

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
- `surface: agent` — an **on-demand sub-agent**: its body is rendered to a `<name>.md` definition under each
  harness's agent dir (claude `.claude/agents/`) that the harness auto-discovers as a spawnable Agent-tool
  sub-agent, loaded **only when a session needs it** (matched on the node's `desc:` trigger) — like a skill,
  never folded into the always-on contract. Its `tools:` field is the spawned agent's read/write tool
  allowlist. Same render shape as `skill`, one definition per harness: the divergence is a single
  [[harness-adapter]] `agentDir` line, and a harness with NO agent primitive (e.g. Codex today) gets none —
  exactly as a harness with no skill primitive gets no `SKILL.md`. The canonical example is [[spec-scout]].

The surface is a FIELD, not a path: a plugin carrying it is a real graph node and is discovered
**recursively** under a config root — so a grouping plugin may itself be a plugin whose children carry a
different surface (e.g. [[.config]]'s `core` is a `system` contract whose children are `hook` handlers).
There are no `command/`/`system/`/`hook/` bucket dirs. Changing a surface is a one-line frontmatter edit.

Both config roots participate: [[.config]] (the instance — the DIY dev-flow plugins) and [[config]] (the
project system spec). A node that declares no `surface` (e.g. this doc node, or any non-plugin folder)
reaches no surface at all.

In [[source-of-truth]]'s `specs.ts`, `loadSurface(s)` walks each root recursively and keeps the nodes whose
`surface` field lists `s` (membership, not equality): `loadConfig` gathers command ([[spec-cli]]'s `/api/config`, the
[[session-console]] `/` palette), `loadSystemConfig` gathers system ([[sessions]]'s launcher), and
`loadHookConfig` gathers hook (compiled into the dispatch manifest), `loadSkillConfig` gathers skill
(rendered to a per-harness `SKILL.md` by [[harness-delivery]]'s materialize), and `loadAgentConfig` gathers
agent (rendered to a per-harness `<name>.md` sub-agent definition by that same materialize). Only
**built/active** plugins gather — a `status: pending` node is declared intent, so it renders on the board but
reaches no surface.
