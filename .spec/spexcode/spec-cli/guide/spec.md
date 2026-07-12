---
title: guide
status: active
hue: 200
desc: `spex guide` is the reference surface as a command — no topic prints the setup workflow; `spec`/`eval` print the file-format manual, `settings` the runtime-settings manual, `footprint` the residence-model manual.
code:
  - spec-cli/src/guide.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/layout.ts
---
# guide

`spex guide` is SpexCode's **reference surface as a command**, not buried docs. It serves the human and
the agent from one verb, picked by an optional topic:

- **no topic → the human SETUP workflow.** The model it teaches is **install once, then let an agent
  drive** — one global install (`npm i -g spexcode`, the [[packaging]] contract) serves *every* project
  (the `spex` CLI acts on whatever repo is cwd, `spex serve ui` is a viewer pointed per project), so the
  human's only manual steps are the global install and pointing at a backend; authoring spec nodes and the
  dogfood ritual are an agent's job. Each step names the real seam, not internals: **cwd** is the "which
  repo" knob, **`--api-port`** is the dashboard's endpoint seam, **`spexcode.json`** governs lint's layout.
  The source-checkout path (repo-root `npm link`, the dashboard dev server) stays a *dogfood footnote* with
  its real footguns (shared `spex` bin — uninstall before switching; no prebuilt dist under a source link),
  never the headline: teaching the maintainer's path as the install was exactly the drift the packaging
  node's arrival made stale.
- **`spec` / `eval` → the agent-facing FILE-FORMAT manual.** The whole detail of the two authored
  artifacts — spec.md (frontmatter, body, the rules lint enforces) and eval.md (the scenario schema, how
  loss is measured and filed) — so an agent looks the format up on demand instead of reverse-engineering
  it. The eval page is **prescriptive about evidence**: step-unfolding evidence carries a step-map — named
  steps on the evidence's own axis, emitted by the run that produced it, never eyeballed off the artefact.
  The concept is tool-neutral (Playwright is one emitter); `--timeline` is axis-tagged (a video's `time`,
  a transcript's `line`, a still sequence's `frame`, a data export's `index` — legacy `tMs` maps read as
  `time`), and a filing's axis must match an attached evidence entry's kind.
  The always-on system prompt is the **clue** that the format exists; this manual carries the detail. An
  unknown topic fails loud (names the real topics), never a silent setup dump.
- **`settings` → the agent-facing RUNTIME-SETTINGS manual.** SpexCode's own settings are self-documenting
  through this same primitive rather than a new mechanism: `spex guide settings` prints every `spexcode.json`
  / `spexcode.local.json` field (launchers, dashboard icon, lint budgets, layout overrides) with a working
  example — crucially teaching **which of the two files each belongs in**: the committed, portable
  `spexcode.json` vs. the gitignored, host-specific `spexcode.local.json` (absolute launcher paths,
  secrets). The sessions section names the worker cap's default, precedence, and the important meaning of
  "active": it counts compute slots, not total session rows, so human-waiting sessions do not block launches.
  It **mirrors the `Config` type** in `layout.ts` (the single source of truth — the manual
  restates the type's own field comments, it does not invent fields, and it omits fields the type keeps
  only as retired compat for the loud notice), so an agent can configure SpexCode
  for a user who doesn't know the schema by editing the JSON directly. There is deliberately no imperative
  `spex config set` — the guide + a direct edit is the whole surface.
- **`footprint` → the residence MODEL manual.** The [[residence]] model as an operator's handbook: the
  four artifact kinds and their fixed track facts (materialized artifacts never tracked), the migration
  recipe for a legacy untracked spec tree (`git add .spec spexcode.json` with the pushed-history WARN),
  how the [[content-filter]] behaves on a host-tracked contract file, and the forgetting-law guarantees
  (any-order switching, `spex uninstall` as the empty policy).

Every page describes the PRESENT model only — a retired knob or mechanism is simply absent, never kept
around as a retirement announcement (history is git's job). Whoever still carries a retired config field
is reached by the runtime's loud notice, which names the removal recipe itself; the guide never
duplicates that notice as static text.

`guide` is the SKILL layer of the help journey ([[cli-surface]]): **help answers "what do I type",
guide answers "how do I work".** Command usage — the map (`spex help`) and each command's own page
(`spex help <cmd>` / `spex <cmd> --help`) — lives in `help.ts`; every guide page footers back to those
layers and the help layers name the guide's topics, so neither surface dead-ends. The `--help`
interception's safety contract is unchanged: it prints and EXITS **before** the verb runs — the flag
used to be an ignored no-op that fell through to the verb's side effect, so probing a STREAMING verb
(`spex watch --help` started a watch that never exits) or a MUTATING one (`spex session new --help`
created a stray session) detonated the very command the user was only asking about. A help probe must
never fire a side effect, and the help it prints must read its own caveats honestly: a verb that blocks
forever (`watch`) says so and points at the one-shot alternative.

The narration is static help text (the spirit of `printHelp` and `spex init`'s next-steps), now living in
its own `guide.ts` module rather than the shared `cli.ts` hub — *not* a planted `.spec` template the way
[[spex-init]]'s contracts are, and *not* routed through the dashboard's i18n catalogs ([[settings]]),
which translate the browser UI, not operator-facing CLI output. `guide` tells you the loop and the
formats; [[spex-init]] performs the first step of it.

This node's stake in `cli.ts` is now a thin dispatch (`process.argv[3]` → `guideText`); the content lives
in `guide.ts`. `cli.ts` is the shared command hub every verb routes through, so a sibling verb's churn
there is that feature's, not `guide`'s drift.
