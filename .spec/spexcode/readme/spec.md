---
title: readme
status: active
hue: 25
desc: The repo's front door — README.md sells the model in one scroll (feature table → model → learning loop → quick start → L0/L1/L2 → agents → dashboard), with self-grounded brand-palette SVG diagrams; docs/README.zh-CN.md mirrors it section for section.
code:
  - README.md
related:
  - docs/README.zh-CN.md
  - docs/readme-model.svg
  - docs/readme-drift-flow.svg
  - docs/readme-loop.svg
  - docs/readme-loop.zh.svg
  - docs/readme-layers.svg
  - docs/readme-worker-flow.svg
  - docs/readme-worker-flow.zh.svg
  - docs/readme-sessions.svg
  - spec-cli/src/docs-quickstart.test.ts
---
# readme

README.md is the front door: a reader who scrolls once should leave knowing what the tool is, why it
is shaped this way, and how to start. Its narrative arc is fixed — hook (intro + five-row feature
table) → **The model** (spec↔code, diagrams) → **Software as a learning loop** → **Quick start** →
**How it's put together** (L0/L1/L2) → **Working with agents (L1)** → **The dashboard (L2)** →
contributing/credit/license. Sections earn their place by answering a reader question, not by
enumerating features; the deep dives (eval discipline, every lint rule, configuration fields)
deliberately live in `spex guide` and spexcode.net, not here — the README states each once, in
passing, where the narrative needs it.

Hard invariants:

- **Quick start is registry-pinned.** `docs-quickstart.test.ts` asserts both READMEs keep their
  Quick start heading (`## Quick start` / `## 快速开始`) and a `spex init --harness` example whose
  value is EXACTLY the built-in harness registry in registry order. Never hand-edit that line's id
  list; it follows `harness-select.ts`.
- **The zh README mirrors section for section.** Same arc, same assets (its image paths are relative
  to `docs/`; it uses `readme-loop.zh.svg` and `readme-worker-flow.zh.svg` where a translated asset
  exists). A change to one README is not done until the other carries it.
- **Diagrams carry their own ground.** GitHub renders a README on light and dark themes and serves
  SVGs as `<img>` (no `prefers-color-scheme`), so every diagram has a solid background in the brand
  palette — paper `#F4EEE0`, ink `#171A20`, teal `#16495A` / `#5FA8BE` on dark (see
  `docs/brand/README.md`). Fonts are generic-family stacks, never webfonts.
- **The terminal animation is an illustration, not evidence.** `readme-sessions.svg` is a
  hand-authored animated SVG modeled on real `spex session ls` output (glyphs, columns, status
  colours match the CLI); its session rows are curated demo content. It must never be captioned as a
  screenshot, and if the CLI's table format changes it is redrawn to match.
- **Plain voice.** Feature-table names are plain capability names (drift detection, session &
  worktree management, shareable URLs, modular layers, cross-harness support), never slogans; the
  table has a real header row (an empty `| | |` header renders as a blank band on GitHub). Copy
  states guarantees positively — rhetorical negation chains ("no X, no Y") are banned across the
  READMEs and the diagram text; a single factual negative ("workers never merge themselves") is
  fine.
- Worker-lifecycle facts in the flow diagrams state the product ritual: workers propose and never
  merge; the human fires the merge and the session's own agent lands it.
