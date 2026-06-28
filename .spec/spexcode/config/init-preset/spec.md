---
title: init-preset
status: active
hue: 100
desc: The policy of what `spex init` seeds — which active .config plugins ship to a new project and which are held back as spexcode-only.
---
# init-preset

The init preset is the **policy** half of adoption — *which* [[.config]] plugins a fresh
project inherits. The *mechanism* (the CLI scaffold that copies template files into a target
tree) belongs to [[spex-init]]; this node owns only the set, and states nothing about how the
copy happens.

**The rule, in one line:** every **active** `.config` plugin ships EXCEPT the spexcode-only
ones. The preset is therefore *derived* from `.config`, not a hand-kept list — so a new dev-flow
plugin is shipped by default and only a spexcode-only one is held back.

### 1. Seeding — the template IS the preset, materialized
`spex init` plants the CLI's `templates/spec/project/.config` tree as the new project's
`.spec/<proj>/.config`. That directory is not an abstraction over the preset — it *is* the
preset frozen as files, each plugin a verbatim copy of the dogfood `.config` node. Editing the
preset means editing those template files (adoption is data, not code — [[spex-init]]). It is
kept in lockstep by hand today, so the durable fix is to regenerate it from "active `.config`
minus the spexcode-only nodes".

### 2. The shipped command workflows
Seeded as `surface: command` new-session presets — the dev-flow commands every adopter gets:
- `extract`
- `regroup`
- `scenario`
- `supervisor`
- `tidy`

### 3. The shipped core contract — hooks + system prompts
Seeded as `surface: system`, folded verbatim into every launched agent's
`--append-system-prompt`:
- `core` — and with it the materialized hooks it co-locates: the spec-first dispatch and the
  stop-gate, plus the session-lifecycle scripts the contract carries.
- `forge-link`
- `memory-hygiene`

### 4. What is NOT a preset — the spexcode-only holdbacks
Held back because they bind to *this* repo's own setup and must never reach an adopter:
- `taste` (`surface: skill`) — SpexCode's own engineering principles; an adopter authors their
  own taste, so this never ships.
- `voice-before-ask` (`surface: system`) — needs this repo's local voice MCP, absent in an
  adopter's environment.
