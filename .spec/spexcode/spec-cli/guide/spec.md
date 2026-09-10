---
title: guide
status: active
hue: 200
desc: `spex guide` is the reference surface as a command — no topic prints the setup workflow; `spec` prints the spec.md file-format manual, `settings` the runtime-settings manual, `footprint` the residence-model manual, `files` the agent-to-human path handoff, `web` the local-web-service handoff, and `diagram` a node's diagram and the loop that draws it.
code:
  - spec-cli/src/guide.ts
related:
  - spec-cli/src/cli.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/docs-quickstart.test.ts
  - README.md
  - docs/README.zh-CN.md
---
# guide

`spex guide` is SpexCode's **reference surface as a command**, not buried docs. It serves the human and
the agent from one verb, picked by an optional topic:

- **no topic → the human SETUP workflow.** The model it teaches is **install once, then let an agent
  drive** — one global install (`npm i -g spexcode`, the [[packaging]] contract) serves *every* project.
  It requires Node >= 22.
  Each adopted repo runs its own `spex serve` from that repo's cwd and publishes its endpoint into the
  current user's host registry; one host-level `spex dashboard` serves the shared gateway/UI, continuously
  discovers backends that are already running or start later, exposes `/projects` for global switching and
  management, and scopes each project's dashboard under `/p/:id/`. There is no per-project UI process or
  API/UI port pairing. Each step names the real seam, not internals: **cwd** picks the repo a backend serves,
  backend **`--port`** avoids listen collisions, and **`.spec/spexcode.json`** governs lint's layout. The
  source-checkout path (repo-root `npm link`, `npm run api`, and the Vite/HMR `npm run web`) stays a
  *contributor footnote*, never the installed-user headline: teaching the maintainer's path as the install
  was exactly the drift the packaging node's arrival made stale. The adopt step represents **every
  supported harness, privileging none**: its `spex init --harness` example lists the full built-in
  registry (the prose says to drop what you don't use — any one id or comma-separated subset is
  valid, required with no default). A registry-derived docs assertion (`docs-quickstart.test.ts`)
  holds this page and both READMEs' Quick start to exactly that set, so the example can neither
  regress to one privileged harness nor silently drift from the registry.
- **`spec` → the agent-facing FILE-FORMAT manual.** The whole detail of the one authored artifact —
  spec.md: frontmatter, body, the rules lint enforces — so an agent looks the format up on demand instead
  of reverse-engineering it. Compact always-on prompts point here for their operational detail: the page
  carries comment altitude, the lifecycle rule (one node per commit, lint at 0 errors before merge, product
  evidence to the reviewer through `spex session files add`), and the shared-checkout mid-merge recovery
  rule.
  The always-on system prompt is the **clue** that the format exists; this manual carries the detail. An
  unknown topic fails loud, naming **every** registered topic and never a silent setup dump — and that list
  is DERIVED from the topic registry rather than re-typed beside it. A hand-kept enumeration of the topics
  is a wrong-population defect one layer down, and it had already happened: `files` and `web` were
  registered as real pages while the unknown-topic error still named four. Nothing about the shorter list
  looked wrong, because an enumeration cannot report what it is missing.
- **`settings` → the agent-facing RUNTIME-SETTINGS manual.** SpexCode's own settings are self-documenting
  through this same primitive rather than a new mechanism: `spex guide settings` prints every `.spec/spexcode.json`
  / `.spec/spexcode.local.json` field (launchers, dashboard icon, upload transfer policy, deterministic lint policy,
  doctor health budgets, layout overrides) with a working
  example — crucially teaching **which of the two files each belongs in**: the committed, portable
  `.spec/spexcode.json` vs. the gitignored, host-specific `.spec/spexcode.local.json` (absolute launcher paths,
  secrets). Deterministic lint policy and the doctor's altitude/breadth health budgets remain separate
  owners. Its launcher table mirrors [[launcher-select]]: interactive clean-init profiles use ordinary
  commands that preserve the harness permission model, while the independent [[opencode-headless]] profile
  is the one explicit `opencode --auto` seed required by its terminal-free runtime. Other automatic-permission
  commands remain authored profiles, never silent defaults. The sessions section names the worker cap's default, precedence,
  and the important meaning of "active": it counts compute slots, not total session rows, so human-waiting
  sessions do not block launches.
  It mirrors the project `Config` type in `layout.ts` (the single source of truth — the manual
  restates the type's own field comments, it does not invent fields, and it omits fields the type keeps
  only as retired compat for the loud notice). Its uploads section names every transfer number, says that
  `templates/spexcode.json` is the sole numeric-default source, and teaches the ordinary local-over-portable
  override rather than inventing an upload settings command. It also names [[identity-config]]'s one separate host-level
  gateway icon at `SPEXCODE_HOME/config.json`, so an agent can configure SpexCode
  for a user who doesn't know the schema by editing the JSON directly. There is deliberately no imperative
  `spex config set` — the guide + a direct edit is the whole surface.
- **`footprint` → the residence MODEL manual.** The [[residence]] model as an operator's handbook: the
  four artifact kinds and their fixed track facts (materialized artifacts never tracked), the migration
  recipe for a legacy untracked spec tree (`git add .spec` with the pushed-history WARN),
  how the [[content-filter]] behaves on a host-tracked contract file, and the forgetting-law guarantees
  (any-order switching, `spex uninstall` as the empty policy).
- **`files` → the agent-to-human PATH handoff.** The three `session files` verbs, the live and host-local
  meaning of a posted absolute path, add-time readable-file check, list-time invalid marker, the default
  persistent evidence location outside the product repository, and the dashboard's click-time preview/download. It states the safe
  preview types and 2 MiB refusal ceiling rather than implying every file can render, and distinguishes this
  from [[file-attach]] so an agent does not upload an artifact merely to hand it back.
- **`web` → the agent-to-human LOOPBACK handoff.** The three `session web` verbs, their explicit-port
  loopback URL requirement, and the dashboard's click-time same-origin proxy. It makes clear that posting
  neither starts nor copies the service, so an agent builds and serves a production dist with relative asset
  paths, reads its base from `location.pathname`, and keeps that local server alive rather than mistaking a live
  page for an uploaded artifact.
- **`diagram` → the node-DIAGRAM manual.** A node's one `diagram.json` ([[diagram]]): the five kinds and when each
  fits, the two tree rules an architecture diagram obeys, the fields an author writes, where the full schemas
  live, what not to put on a picture, and the loop — find the node, `spex diagram scaffold`, edit,
  `spex diagram check` until it passes, lint, commit with the spec ([[diagram-cli]]). The page names the schemas
  by package, never by a machine path, because the guide pages are exported into the guidance catalog.

Every page describes the PRESENT model. `spex guide settings` documents `SPEX_PROFILE` as a launch-time
harness property, never repository configuration. A retired knob is absent from the active field list; when silently
ignoring a stale authored field would leave its owner ambiguous, one concise migration note names the live
replacement and the runtime diagnosis repeats that repair. History remains git's job, not a static
retirement catalogue.

`guide` is the SKILL layer of the help journey ([[cli-surface]]): **help answers "what do I type",
guide answers "how do I work".** Command usage — the map (`spex help`) and each command's own page
(`spex help <cmd>` / `spex <cmd> --help`) — lives in `help.ts`; every guide page footers back to those
layers and the help layers name the guide's topics, so neither surface dead-ends. The `--help`
interception's safety contract is unchanged: it prints and EXITS **before** the verb runs — the flag
used to be an ignored no-op that fell through to the verb's side effect, so probing a STREAMING verb
(`spex session watch stream --help` started a watch that never exits) or a MUTATING one (`spex session new --help`
created a stray session) detonated the very command the user was only asking about. A help probe must
never fire a side effect, and the help it prints must read its own caveats honestly: a verb that blocks
forever (`watch`) says so and points at the one-shot alternative.

The narration is static help text (the spirit of `printHelp` and `spex init`'s next-steps), now living in
its own `guide.ts` module rather than the shared `cli.ts` hub — *not* a planted `.spec` template the way
[[spex-init]]'s contracts are, and *not* routed through the dashboard's i18n catalogs ([[settings]]),
which translate the browser UI, not operator-facing CLI output. `guide` tells you the loop and the
formats; [[spex-init]] performs the first step of it.

This node's stake in `cli.ts` is now a thin dispatch (`process.argv[3]` → `guideText`, plus `guideTopics()`
for the unknown-topic list so that list cannot drift from the registry); the content lives
in `guide.ts`. `cli.ts` is the shared command hub every verb routes through, so a sibling verb's churn
there is that feature's, not `guide`'s drift.
