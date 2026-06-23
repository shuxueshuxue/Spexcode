---
title: guide
status: active
hue: 200
desc: `spex guide` is the reference surface as a command — no topic prints the setup workflow; `spec`/`yatsu` print the file-format manual an agent authors against.
code:
  - spec-cli/src/cli.ts
  - spec-cli/src/guide.ts
---
# guide

`spex guide` is SpexCode's **reference surface as a command**, not buried docs. It serves two audiences
from one verb, picked by an optional topic:

- **no topic → the human SETUP workflow.** The model it teaches is **install once, then let an agent
  drive** — one SpexCode checkout serves *every* project (the global `spex` CLI acts on whatever repo is
  cwd, the dashboard is a viewer pointed per project), so the human's only manual steps are the global
  install and pointing at a backend; authoring spec nodes and the dogfood ritual are an agent's job. Each
  step names the real seam, not internals: **cwd** is the "which repo" knob, **`API_URL`** is the
  dashboard's endpoint seam, **`spexcode.json`** governs lint's layout.
- **`spec` / `yatsu` → the agent-facing FILE-FORMAT manual.** The whole detail of the two authored
  artifacts — spec.md (frontmatter, body, the rules lint enforces) and yatsu.md (the scenario schema, how
  loss is measured and filed) — so an agent looks the format up on demand instead of reverse-engineering
  it. The always-on system prompt is the **clue** that the format exists; this manual carries the detail.
  An unknown topic fails loud (names the real topics), never a silent setup dump.

The narration is static help text (the spirit of `printHelp` and `spex init`'s next-steps), now living in
its own `guide.ts` module rather than the shared `cli.ts` hub — *not* a planted `.spec` template the way
[[spex-init]]'s contracts are, and *not* routed through the dashboard's i18n catalogs ([[settings]]),
which translate the browser UI, not operator-facing CLI output. `guide` tells you the loop and the
formats; [[spex-init]] performs the first step of it.

This node's stake in `cli.ts` is now a thin dispatch (`process.argv[3]` → `guideText`); the content lives
in `guide.ts`. `cli.ts` is the shared command hub every verb routes through, so a sibling verb's churn
there is that feature's, not `guide`'s drift.
