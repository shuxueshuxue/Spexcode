const SETUP = `spex guide — run SpexCode on your own repo

The product model: install SpexCode ONCE, then use it across all your projects — an agent drives
the rest, you don't hand-author the spec tree or wire the dashboard yourself.

1. Install the CLI (one-time, global — ONE install serves every project)
     npm i -g spexcode                           # ONE command lands on PATH: \`spex\` (Node ≥ 22)
   It always operates on the repo of your current directory — that cwd is the only "which repo" knob.
   (Dogfooding an unpublished HEAD from a source checkout? \`npm link\` at the repo ROOT — that links
   the \`spexcode\` package itself, never the internal @spexcode/spec-cli. Both paths own the same
   \`spex\` bin, so uninstall one before switching (\`npm rm -g spexcode\`; a legacy link of the
   inner package uninstalls as \`@spexcode/spec-cli\`). A source link ships no
   prebuilt dashboard dist — \`spex dashboard\` needs a manual dashboard build, or use the dev server.)

2. Adopt a repo
     cd <your-repo> && spex init                 # seeds .spec/ + git hooks (additive, never overwrites)
   Works on any git repo. Edit .spec/project/spec.md to describe it, then grow child nodes
   (each a dir with a spec.md + a \`code:\` list of the files it governs).

3. Run the backend — it reads .spec + git from the cwd repo
     spex serve                                  # http://localhost:8787  (PORT=<n> for another endpoint)
   Serve a different repo by running it from there; two repos at once = two \`spex serve\` on two PORTs.

4. Open the dashboard — the SAME board for every project, pointed per project
     spex dashboard                              # serves the bundled board on :5173, proxying /api
   Point it at another backend with --api-port (pairs with \`spex serve --port\`); one dashboard per
   project. The board is a viewer — which backend it proxies is the only "which project" knob.
   Loopback-only by default: viewing from another machine needs \`--host 0.0.0.0\` (or a specific
   interface) — still plain HTTP with no gate, so bind wide only on a LAN/tailnet you trust (for
   the internet, use \`spex serve --public\` instead).
   (Dogfood/source alternative: API_URL=http://localhost:<port> npm run dev in spec-dashboard —
   the dev server; "dashboard": { "apiUrl": "..." } in spexcode.json applies only to that layout.)

5. Govern your layout (optional)
     spexcode.json sets lint's governedRoots/sourceExtensions and any non-default worktree layout.
     \`spex lint\` must report 0 errors; coverage warnings are your adoption TODO (files no node claims yet).

Look these up on demand — the formats an agent authors, and the settings it configures:
  spex guide spec       the spec.md format (frontmatter + body + the rules lint enforces)
  spex guide yatsu      the yatsu.md format (scenario schema + how loss is measured and filed)
  spex guide config     the spexcode.json / spexcode.local.json settings (launchers, dashboard icon, lint
                        budgets, layout) — every field, and which of the two files it belongs in
  spex guide footprint  the footprint model — what SpexCode plants in a repo, and who sees it
                        (committed | ignored | hidden), and every migration recipe`

const SPEC = `spex guide spec — the spec.md file format

A spec node is a DIRECTORY under .spec/<project>/…/<id>/ holding a spec.md. The node's id is its leaf dir
name when that is globally unique, else the shortest parent-qualified path-suffix that disambiguates (so ids
are unique by construction) — the same id \`spex board\`, \`ack\`, and a node/<id> branch use. A spec states a node's PRESENT
intent at CONTRACT altitude — what it guarantees and why — and is rewritten in place as intent changes;
version history is git's job, never a changelog in the body.

FRONTMATTER (YAML between the opening and closing --- lines; every field optional, sensible defaults):
  title    display name. Defaults to the dir id.
  desc     one-line summary shown on the board.
  hue      board colour, 0–360. Default 210.
  status   pending | active | merged | drift. Usually DERIVED from git state — rarely hand-set.
  code:    files this node GOVERNS (is source of truth for) — ideally ONE, a YAML list of repo-relative
           paths/dirs/*-globs. Drives drift + yatsu. Many nodes MAY govern the same file (ordinary
           composition); a file governed by > maxOwners nodes warns (the \`owners\` rule — split it). Omit
           for a pure-prose node: a cross-cutting contract no file owns.
  related: files this node REFERENCES but does not own — a YAML list, same path forms. Carries coverage
           (never drift, never yatsu, nothing to ack); it is the many-to-many net that claims the files
           govern doesn't. Every listed path must exist (lint integrity error otherwise).
  surface  config/.config nodes only: system (folded into every agent's prompt) | command (a /command) |
           hook (a lifecycle hook handler — a co-located script the dispatcher runs on the harness events
           in events:, ordered by order:, blocking when block: true). hook nodes may nest under a grouping
           plugin (e.g. .config/core/<id>); surface is a field, discovered recursively.
  events   hook surface only: harness lifecycle events this node binds (YAML list — PreToolUse, Stop, …).
  order    hook surface only: integer; the dispatcher runs same-event hooks low to high.
  block    hook surface only: true if the hook may block its event (honored only on block-capable events).

BODY (Markdown after the frontmatter): the contract — intent, invariants, outward behaviour; NOT how the
code does it. Two optional level-2 headings split ground truth from detail:
  ## raw source      human-authored, rarely-changed intent — the loss function's target.
  ## expanded spec   agent-authored detail that must keep serving the raw source.
Bodies without those headings are read whole. Link sibling nodes with [[node-id]] (a dangling link is
fine — it marks a node worth writing).

WHAT lint CHECKS (spex lint; the pre-commit hook gates on errors):
  integrity (error)  every code: path exists.
  living    (error)  no "## vN" changelog headings — the body is current-state.
  altitude  (warn)   the body stays high-altitude: line/char budgets (~50 lines / 4200 chars), low
                     code-identifier density, no step-by-step phrasing. Over budget = rewrite higher.
  coverage  (warn)   every source file is claimed by ≥1 node — via code: OR related: (related is the net).
  drift     (warn)   a governed file has commits newer than the node's spec version — it may be stale.
                     Remedy: edit the spec to the new intent (re-versions the node), OR \`spex ack <node>
                     --reason "…"\` when only mechanics changed and the contract still holds.
  owners    (warn)   a file governed by > maxOwners nodes (default 3) does too much — SPLIT it so each
                     governor owns its own module (or merge the nodes, or give it one foundation owner).

LIFECYCLE: author each node on a node/<id> branch, one node per commit; \`spex lint\` must reach 0 errors
before merge. \`spex init\` seeds the first tree; \`spex guide yatsu\` covers the sibling loss-signal file.`

const YATSU = `spex guide yatsu — the yatsu.md file format

A yatsu.md sits BESIDE a node's spec.md and says how to MEASURE the node's loss — the gap between live
behaviour and the spec. It is optional, but a node that governs SOURCE code (its code: includes a file whose extension is in
\`lint.sourceExtensions\` — default .ts/.tsx/.js/.jsx, set it for a Rust/Go/Python tree) with no yatsu.md is
a blind spot: \`spex yatsu scan\` flags it \`yatsu-uncovered\`. yatsu defines no DSL and RUNS NOTHING — the
agent measures; yatsu keeps score.

FRONTMATTER: a \`scenarios:\` list (a YAML block sequence of mappings). Each scenario:
  name         REQUIRED. Unique within the file — it keys the sidecar and \`--scenario <name>\`.
  description  REQUIRED. What to check / how to measure it through the running product.
  expected     REQUIRED. What ZERO loss looks like — the target the measurement is compared against.
  tags         REQUIRED. ≥1 classification tag (a comma list / flow list \`[a, b]\`), each drawn from the
               configured library (\`lint.scenarioTags\` in spexcode.json; ships
               \`frontend-e2e, backend-api, cli, desktop, mobile\`). A tag outside the library is rejected —
               use an existing one, or add it to the library to mint it. Tags classify a scenario (surface,
               device) so it can be filtered and, later, routed to the right driver.
  test         optional. A repo path to a co-located runnable file (a playwright.spec.ts, a script)
               the agent MAY run by hand. Not a driver — yatsu never executes it.
  code         optional. The file THIS scenario GOVERNS, ideally one (a comma list / flow list \`[a, b]\` is
               allowed) — its own slice of the code freshness axis, so scenarios on one node go stale
               independently. Absent → it inherits the node's \`code:\` list. A file governed by > maxOwners
               scenarios warns \`yatsu-owners\` (split it). Each path must exist (a ghost → \`yatsu-schema\`).
  related      optional. Files this scenario REFERENCES but does not govern — same path forms. They do NOT
               stale it (the freshness mirror of a spec node's govern/related). Each path must exist.
Multi-line prose uses YAML block scalars: \`|\` keeps newlines, \`>\` folds wrapped lines to spaces.
A yatsu.md OWNS nothing — only its scenarios govern and relate (see governed-related).

THE SCHEMA IS ENFORCED (closed field set, four required fields, unique names, tags within the library). A
missing required field, an unknown key (a typo like \`descripton:\`), a duplicate name, an out-of-library
tag, or no scenarios at all is rejected LOUD: \`spex yatsu scan\` reports it as \`yatsu-schema\`, and the
pre-commit \`yatsu check-staged\` BLOCKS the commit.

BODY (after the frontmatter): prose naming the measurement method — YATU ("You As The User"): the agent
looks at / calls the real product surface, not an internal helper chosen to make the proof easy.

MEASURING AND FILING: the agent runs the scenario however it likes (a browser run, an API
transcript, a by-hand pass), compares the result to \`expected\`, and files it:
  spex yatsu eval <node> --scenario <name> (--pass | --fail) [--note <text>]
                 [--image <png> …repeatable] [--result <txt>|-] [--video <webm|mp4> [--timeline <json>]]
The verdict is \`--pass\` or \`--fail\` (a measurement must commit to one — an unmeasured scenario is \`missing\`,
not a hedged fail). \`--note <text>\` is an OPTIONAL one-line annotation on either (why it failed, how far a
pass sits from ideal); it does NOT replace evidence — the image/video/transcript is the captured actual behaviour.
PICK THE EVIDENCE KIND BY WHAT THE BEHAVIOUR DOES OVER TIME:
  MOVES / is timed  → \`--video <webm|mp4>\`. Terminal scroll or redraw, an animation or transition, media
                      playback, a multi-step interaction flow, keyboard timing — a still of a moving thing
                      proves the wrong thing; RECORD the run (e.g. playwright \`recordVideo\` on the context).
                      STEP EVIDENCE gets a STEP-MAP: when the evidence unfolds in steps, carry named steps
                      anchored to a POSITION on the evidence's OWN axis, EXPORTED BY THE RUN that produced it
                      — never a value the agent eyeballs off the finished artefact afterwards (that's
                      misaligned and dishonest, worse than none). \`--timeline <json>\` carries one; its \`axis\`
                      is the evidence's: a video is \`time\` (ms), a transcript \`line\`, a still SEQUENCE \`frame\`,
                      an action trace \`index\` (the set is OPEN — an unknown axis just renders as a bare number).
                      \`at\` = the position on that axis, \`step\` = a short name for that moment; copy this shape:
                        { "v": 2, "axis": "time",
                          "events": [ { "at": 0, "step": "open board" },
                                      { "at": 1200, "step": "type query" } ] }
                      The run exports it: in whatever drives the evidence — Playwright, a computer-use hand, a
                      CLI harness stamping line numbers — take a baseline and at EACH real step push
                      \`{ at: <position>, step: "…" }\`; dump that array as \`--timeline\`. Its \`axis\` MUST match the
                      evidence it rides (a \`line\` map needs a \`--result\` transcript, a \`time\` map a \`--video\`);
                      skip it for a short single-step artefact. (Legacy \`{ "v": 1, "events": [{ "tMs" }] }\` — the
                      time axis with \`tMs\` — is still accepted, read as \`axis: "time"\`.)
  STATIC end state  → \`--image <png>\` (repeatable — N stills). Layout, an icon, copy, one rendered frame.
  backend / CLI     → \`--result <txt>\` (a transcript; \`-\` reads stdin). A STRUCTURED export (a JSON
                      \`--export-json\`, an API payload, a metrics dump) is recognized BY CONTENT and kept as
                      \`data\` — rendered as a validatable data block, not flattened into scrolling transcript
                      text; free-form output stays a transcript. You pick the flag; the KIND follows the bytes.
The flags combine in ONE filing — several stills can ride beside the clip of the same run.
ANCHOR DISCIPLINE: a reading's \`codeSha\` is HEAD at filing time, and a git sha names only a COMMIT — an
uncommitted change has none. So measure the tree you are about to commit, COMMIT it, then file; confidence
is earned on the working tree, but the anchor can only land after the commit. Filing from a dirty tree
mis-anchors the reading (its sha lacks the change it measured) and it goes stale the moment you commit.

A botched filing (a junk e2e/smoke run, a wrong verdict) is undone through the SAME surface:
  spex yatsu retract <node> [--scenario <name>] [--last | --ts <iso>] [--note <why>]
retract APPENDS a retraction event to the sidecar (never deletes a line — the trace stays, git records
who/when/why); the scoreboard then drops the retracted reading everywhere: the previous reading becomes
the latest again, or the scenario honestly returns to \`missing\`. Default target is the scenario's latest
reading (\`--last\` makes that explicit; repeat to peel junk back one filing at a time); \`--ts\` pins one.

THE SCOREBOARD: readings live in yatsu.evals.ndjson beside the yatsu.md — one JSON line per measurement
(a second git-as-database axis). Freshness is derived live from git: a reading goes STALE when a governed
code file or the scenario (the yatsu.md) moves since it was filed.
  spex yatsu scan [--changed]   blind spots: yatsu-schema (malformed) · yatsu-drift (stale) ·
                                yatsu-missing (never measured) · yatsu-uncovered (governed source, no yatsu.md) ·
                                yatsu-owners (a file governed by > maxOwners scenarios — split it)
  spex yatsu show <node>        the reading timeline (verdict · freshness · evidence), newest first
  spex yatsu clean              GC the content-addressed evidence cache`

const CONFIG = `spex guide config — SpexCode's runtime settings (spexcode.json / spexcode.local.json)

SpexCode reads its runtime settings from TWO optional JSON files at the repo root. There is no imperative
\`spex config set\` — an agent CONFIGURES SpexCode by EDITING these files directly. The two split by
PORTABILITY, and picking the right one is the whole discipline:

  spexcode.json         COMMITTED — portable, shared by everyone on the repo. Layout, policy, dashboard
                        identity, lint budgets, launcher NAMES. "Git is the database": tracked so the
                        team shares ONE configuration.
  spexcode.local.json   GITIGNORED — host-specific, never committed. Absolute launcher paths, cert/secret
                        paths. Layered OVER spexcode.json (see MERGE
                        below); a targeted env override (SPEXCODE_CODEX_SERVER_CMD, …) still wins at its read site.

Rule of thumb — is the value TRUE FOR THE PROJECT or TRUE FOR THIS MACHINE? A branch name, a dashboard
icon, a lint budget, a launcher's name+harness are project facts → committed spexcode.json. The ABSOLUTE
PATH of a launcher wrapper or a TLS cert path are machine facts → gitignored spexcode.local.json.
Both files are optional; omit any field to take its default, except \`sessions.defaultLauncher\` when using
\`spex new\` or the dashboard without an explicit launcher choice.

MERGE: spexcode.local.json is layered over spexcode.json ONE LEVEL DEEP — per top-level section (dashboard,
sessions, …), the two objects are shallow-merged with LOCAL WINNING per key; sections only one file names
pass through untouched. This is exactly what lets a launcher's portable NAME reference (defaultLauncher)
sit in the committed file while its host-specific DEFINITION (with the abs cmd) sits in the local file —
see LAUNCHERS.

── LAYOUT (spexcode.json — portable; set only for a NON-DEFAULT repo layout) ──
  main          path to the source-of-truth checkout. Default: the \`main\` worktree.
  mainBranch    the source-of-truth BRANCH worktrees fork from. Default: auto-detected.
  branchPrefix  how a node branch is named. Default "node/".
Example — a repo whose trunk is \`staging\`, not \`main\`:
  { "mainBranch": "staging" }

── DASHBOARD (spexcode.json — portable project identity) ──
  dashboard.title   browser-tab name. Default: the repo-root basename.
  dashboard.icon    browser-tab favicon: an emoji ("🔭") OR an Iconify name ("mdi:rocket-launch").
  dashboard.apiUrl  the per-project backend the board proxies to (read frontend-side). For a SHARED
                    install prefer the API_URL env var; apiUrl here is the default only when the board
                    lives inside the project.
Example:
  { "dashboard": { "title": "MyApp specs", "icon": "mdi:rocket-launch" } }

── SESSIONS / WORKERS ──
  sessions.maxActive        concurrency cap — max agents AUTONOMOUSLY PROGRESSING at once (default 8).
                            Counts compute slots, not total sessions: idle/asking/review/done do not
                            occupy one. A policy number → committed spexcode.json; omit it to use the
                            default, or tune higher/lower for the project's usual host.
  sessions.launchers        the NAMED launcher profiles (see LAUNCHERS). \`spex init\` seeds "claude" and
                            "codex" here as ordinary entries; edit/add more like any other.
  sessions.defaultLauncher  the launcher name a create with no explicit --launcher/dropdown pick uses
                            (required for no-choice creates). A portable NAME → committed.
A launcher \`cmd\` that is a HOST-SPECIFIC ABSOLUTE PATH belongs in spexcode.local.json — the committed file
must stay free of machine paths.

── LAUNCHERS (the profile block, split across the two files) ──
A named launcher profile fixes BOTH a session's harness AND its exact launch command; a create picks one
by name with --launcher/the dashboard dropdown, and the chosen name is persisted on the record so a resume
reuses the same auth. There are NO magic built-ins: \`spex init\` SEEDS "claude" and "codex" as ordinary
named launchers,
  "claude" → { "harness": "claude", "cmd": "claude --dangerously-skip-permissions" }
  "codex"  → { "harness": "codex",  "cmd": "codex --yolo" }
after which they are edited (or removed) exactly like any launcher you add. To run workers under an auth
wrapper (e.g. reclaude), point a launcher's \`cmd\` at it in spexcode.local.json — there is no environment
override that rewrites a launcher's command. Add more profiles when a project needs named auth/config-dir
variants. Shape:
  "launchers": { "<name>": { "harness": "claude" | "codex", "cmd": "<launch command>" } }
\`harness\` defaults to "claude"; \`cmd\` is required. Because \`cmd\` is a machine fact (an abs wrapper path),
the DEFINITION lives in the gitignored spexcode.local.json, while the portable defaultLauncher NAME sits
in the committed spexcode.json — the merge keeps both:

  spexcode.json  (committed — the portable name reference)
  { "sessions": { "defaultLauncher": "gpt5" } }

  spexcode.local.json  (gitignored — the host-specific definitions)
  {
    "sessions": {
      "launchers": {
        "gpt5":       { "harness": "codex",  "cmd": "/Users/me/bin/reclaude-codex --yolo" },
        "claude-prod": { "harness": "claude", "cmd": "/Users/me/bin/reclaude --dangerously-skip-permissions" }
      }
    }
  }

── SERVE (spexcode.json — public-exposure for \`spex serve --public\`) ──
  serve.public.enabled   turn public mode on without the --public flag.
  serve.public.http      drop TLS (the --http escape hatch) — the password then travels in cleartext.
  serve.public.tls       { "cert": "<path>", "key": "<path>" } — PATHS to your own cert/key; omit for a
                         cached self-signed default. If the paths are host-specific, put them in
                         spexcode.local.json.
The gateway password is NEVER read from these files (flag/env only), so serve.public stays committable.

── BACKEND ROUTING (not a config field — how a \`spex\` command picks its backend) ──
One host runs many projects' backends, and a shell inherits the launching backend's SPEXCODE_API_URL —
an env var cannot prove intent (exported-on-this-command vs inherited look identical), so the client
resolves its backend per this ladder, flag first:
  1.  --api <url>            explicit flag on any session verb — ALWAYS wins (--port <n> is localhost
                             sugar for --api http://127.0.0.1:<n>).
  2a. worker (SPEXCODE_SESSION_ID set): env SPEXCODE_API_URL — the backend-injected lifeline; cwd
                             discovery never steals it.
  2b. human (no session id): the cwd project's RECORDED live backend — \`spex serve\` records {url,pid}
                             in ~/.spexcode/projects/<enc>/backend.json at bind time; the reader
                             health-probes before trusting (a dead record is ignored).
  3.  the other side as fallback (human with no live record → env; worker with no env → record).
  4.  default http://127.0.0.1:$PORT||8787.
WRITES are project-bound: every mutating verb (new/merge/send/close/rename/rawkey/reopen/exit) refuses
loudly when the resolved backend serves a DIFFERENT same-host project — an explicit --api/--port skips
the guard (the flag is the proof of intent). Reads point anywhere.

── ISSUES (spexcode.json — portable policy) ──
  issues.enabled      the issues-workflow on/off switch (default ON). OFF silences the post-merge nudge and
                      hides the dashboard view; the CLI toggle is \`spex issues on|off\`.

── FORGE (spexcode.json — which forge this repo's remote is; a project fact, so committed) ──
  forge.host          explicit forge host id ('github' | 'gitlab' | …) overriding the automatic derivation.
                      Normally OMIT it: spec-forge resolves the host from the origin remote's hostname —
                      github.com → github, a gitlab/self-hosted remote → gitlab — and only an ambiguous
                      self-hosted domain the heuristic misreads needs the override. A resolved host with no
                      registered driver degrades to an EMPTY forge slice (local issues still work, no error).

── LINT (spexcode.json — a top-level "lint" key; budgets are portable, so committed only) ──
  lint.governedRoots       dirs whose source files must each be governed by a spec (coverage).
                           '.' = the whole project (only git-TRACKED files). Default
                           ["spec-dashboard/src", "spec-cli/src"].
  lint.sourceExtensions    extensions coverage treats as source. Default ["ts","tsx","js","jsx"].
  lint.testGlobs           globs EXCLUDED from coverage (default ["**/*.test.*"]; [] to govern tests too).
  lint.identifierExtensions extensions the altitude bare-filename signal recognises.
  lint.altitude            body budgets: { lineBudget, charBudget, sizeable, dense, steps }
                           (defaults 50 / 4200 / 35 / 1.3 / 3).
  lint.maxChildren         breadth budget: warn at >= this many direct children (default 8).
  lint.driftErrorThreshold commit-local gate HARD-BLOCKS a commit touching a node >= this many commits
                           behind (default 3).
  lint.maxOwners           warn when a file is governed by > this many nodes (default 3).
  lint.scenarioTags        the closed vocabulary a yatsu scenario's tags: must draw from (default
                           ["frontend-e2e","backend-api","cli","desktop","mobile"]); extend to mint a tag.
Example — govern your own source dir and loosen the altitude budget:
  { "lint": { "governedRoots": ["src"], "altitude": { "lineBudget": 70 } } }

── OTHER (spexcode.json unless noted) ──
  preset      the SELECTED init preset — which cumulative .config tier \`spex init\` seeds (default
              'default'; seed-time only, read by init.ts).
  harnesses   which harness targets \`spex materialize\` delivers into — native ids ("claude"|"codex") or a
              { "plugin": "<folder>" } bundle. Default (omitted): all native harnesses. PERSISTENT and
              git-transactional: the edit takes effect at the next git-native materialize anchor (the commit
              that carries it, a checkout/merge that receives it, or a manual \`spex materialize\`) — a
              deselected harness's artifacts are pruned by that pass.`

const FOOTPRINT = `spex guide footprint — what SpexCode plants in a repo, and who sees it (one fixed behavior per kind)

SpexCode claims software engineering's HEAD (the recording of intent) and TAIL (the storage of
measurement) and leaves the MIDDLE — construction — to the harness/agent/test framework; freshness
stitches the two ends into a closed loop. The footprint follows: the head+tail (.spec, spexcode.json,
readings) is the ASSET and lives in git like source; everything else is derived wiring or a machine fact.
Materialized artifacts carry no facts, so they are NEVER tracked — there is exactly one residence
behavior, decided per KIND (and, for a contract file, by its live CONTENT).

── THE FOUR KINDS (all fixed) ──
  spec data       .spec/ (incl .config/) + spexcode.json — ALWAYS tracked. Git is the database; there is
                  deliberately NO way to say "untrack the spec" in this schema.
  machine facts   spexcode.local.json, the hook shims (.claude/settings.json, .codex/hooks.json), plugin
                  bundles — NEVER tracked; always in the per-clone exclude.
  artifacts       the CLAUDE.md/AGENTS.md contract blocks + materialized skills/agents — derived, NEVER
                  tracked; hidden via .git/info/exclude. The host's tracked .gitignore is never touched.
  run residue     .worktrees/, the global store (~/.spexcode), .git/spexcode blobs — never tracked;
                  out-of-tree, or exclude-ruled where in-tree.

── A CONTRACT FILE'S RESIDENCE IS A LIVE CONTENT FACT (re-judged at every materialize) ──
  host-tracked          → the clean/smudge content filter: the repo keeps the pristine host prose, your
                          working tree carries prose + block, status stays clean.
  untracked, wholly ours→ one exclude entry. The exclude is the ignored-bit DECLARATION the rest of git
                          consults (checkout may overwrite, clean -fd spares, status/add -A/stash silent).
  untracked, YOUR prose → the exclude entry is withdrawn (hiding user content would be data-loss shaped)
    entered the file      and the clean filter is pre-armed: the file shows honestly as untracked, and
                          IF you choose to \`git add\` it, the block is stripped automatically — tracking
                          is always your act; SpexCode never stages or commits anything for you.

── THE GIT-NATIVE ANCHORS (no harness event ever triggers a materialize) ──
  spex init / spex materialize / session-worktree creation — the explicit passes;
  pre-commit    the correctness anchor: an UNCONDITIONAL materialize (masks provably fresh at the only
                moment history is written) + staged-index surgery — a staged blob carrying the sentinel
                block is cleaned IN PLACE (partial staging survives; source is the staged blob), a
                HEAD-untracked generated artifact is unstaged. Repairs and proceeds, never rejects.
  post-checkout/post-merge   freshness anchors: .spec/.config edits are git-transactional — they take
                effect at the commit/checkout/merge that carries them, like any other source change.
An environment with no spex-planted hooks (CI, a cloud agent's fresh clone, a teammate who hasn't
installed) simply runs \`spex materialize\` in its setup step — there is no committed-artifact mode.
TRACK ≠ PUSH: none of this ever touches remotes; where commits GO is branch/remote policy.

── GUARANTEES (the forgetting law) ──
materialize(P₂) ∘ materialize(P₁) = materialize(P₂): every materialize first ERASES all landing points by
SpexCode's own identity stamps, then re-asserts — legacy states (a .gitignore managed block, a committed
artifact) are forgotten by the same pass. \`spex uninstall\` is the empty
materialize plus the global store: a total backout that never touches your .spec/.config or prose. Fresh
clones and session worktrees are self-sufficient: data by checkout, materialized artifacts by
re-materialize, the machine snapshot (spexcode.local.json) by copy.

── THE CONTENT FILTER (mixed-content contract files) ──
Per-clone only — git config filter.spexcode.* + .git/info/attributes + a shim under .git/spexcode/ —
planted where mixed content exists or is imminent (tracked, or untracked with your prose). clean strips
the sentinel block (history never sees it); smudge re-injects it on checkout. A missing shim degrades to
identity (never a git fatal). Your own edits to the prose still show as real modifications; only the
block is invisible to git.

── MIGRATIONS ──
  legacy untracked spec     track the sources once:  git add .spec spexcode.json  (commit on your branch)
                            WARNING: tracking is not retroactive secrecy — history already pushed
                            elsewhere cannot be recalled.
  back out entirely         \`spex uninstall\` (add --hooks to also remove the spexcode git hooks).`

const TOPICS: Record<string, string> = { spec: SPEC, yatsu: YATSU, config: CONFIG, footprint: FOOTPRINT }

// every guide page ends by naming the OTHER help layer, so a reader never dead-ends here: guide is
// the skill layer (workflows · formats · settings); command usage lives in help.ts's two layers.
const FOOTER = `\n\n(This is the skill layer. Command usage: \`spex help\` for the map, \`spex help <command>\` for one command.)`

// null = unknown topic: the caller fails loud (exit non-zero) while still naming the layers to go
// back to — an unknown topic must never read as a successful page ([[cli-surface]]'s dead-end rule).
export function guideText(topic?: string): string | null {
  if (!topic) return SETUP + FOOTER
  const t = TOPICS[topic]
  return t ? t + FOOTER : null
}
