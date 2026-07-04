const SETUP = `spex guide — run SpexCode on your own repo

The product model: install SpexCode ONCE, then use it across all your projects — an agent drives
the rest, you don't hand-author the spec tree or wire the dashboard yourself.

1. Install the CLI (one-time, global — this ONE checkout serves every project)
     cd spec-cli && npm install && npm link      # \`spex\` now runs from ANY directory
   It always operates on the repo of your current directory — that cwd is the only "which repo" knob.

2. Adopt a repo
     cd <your-repo> && spex init                 # seeds .spec/ + git hooks (additive, never overwrites)
   Works on any git repo. Edit .spec/project/spec.md to describe it, then grow child nodes
   (each a dir with a spec.md + a \`code:\` list of the files it governs).

3. Run the backend — it reads .spec + git from the cwd repo
     spex serve                                  # http://localhost:8787  (PORT=<n> for another endpoint)
   Serve a different repo by running it from there; two repos at once = two \`spex serve\` on two PORTs.

4. Open the dashboard — the SAME board for every project, pointed per project
     cd spec-dashboard && npm install                        # once
     API_URL=http://localhost:<port> npm run dev             # point this board at step 3's backend
   The board is a viewer: API_URL is how the shared install points at each project (one dev-server
   per project). "dashboard": { "apiUrl": "..." } in spexcode.json is the default ONLY when the board
   lives inside the project (the dogfood layout) — for a shared install, use API_URL.

5. Govern your layout (optional)
     spexcode.json sets lint's governedRoots/sourceExtensions and any non-default worktree layout.
     \`spex lint\` must report 0 errors; coverage warnings are your adoption TODO (files no node claims yet).

Look these up on demand — the formats an agent authors, and the settings it configures:
  spex guide spec     the spec.md format (frontmatter + body + the rules lint enforces)
  spex guide yatsu    the yatsu.md format (scenario schema + how loss is measured and filed)
  spex guide config   the spexcode.json / spexcode.local.json settings (launchers, dashboard icon, lint
                      budgets, layout) — every field, and which of the two files it belongs in`

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
behaviour and the spec. It is optional, but a FRONTEND node (its code: includes a UI file —
.jsx/.tsx/.vue/.svelte/.css, or the dashboard) with no yatsu.md is a blind spot: \`spex yatsu scan\` flags
it \`yatsu-uncovered\`. yatsu defines no DSL and RUNS NOTHING — the agent measures; yatsu keeps score.

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

MEASURING AND FILING: the agent runs the scenario however it likes (a browser screenshot, an API
transcript, a by-hand pass), compares the result to \`expected\`, and files it:
  spex yatsu eval <node> --scenario <name> (--pass | --fail) [--note <text>] [--image <png> | --result <txt>|-]
The verdict is \`--pass\` or \`--fail\` (a measurement must commit to one — an unmeasured scenario is \`missing\`,
not a hedged fail). \`--note <text>\` is an OPTIONAL one-line annotation on either (why it failed, how far a
pass sits from ideal); it does NOT replace evidence — the image/transcript is the captured actual behaviour.
Frontend → \`--image <png>\` (visual evidence); backend → \`--result <txt>\` (a transcript; \`-\` reads stdin).

THE SCOREBOARD: readings live in yatsu.evals.ndjson beside the yatsu.md — one JSON line per measurement
(a second git-as-database axis). Freshness is derived live from git: a reading goes STALE when a governed
code file, the scenario (the yatsu.md), or the evaluator moves since it was filed.
  spex yatsu scan [--changed]   blind spots: yatsu-schema (malformed) · yatsu-drift (stale) ·
                                yatsu-missing (never measured) · yatsu-uncovered (frontend, no yatsu.md) ·
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
                        paths, private-overlay mode. Layered OVER spexcode.json (see MERGE below); an env
                        var (SPEXCODE_CLAUDE_CMD, …) still overrides both at its read site.

Rule of thumb — is the value TRUE FOR THE PROJECT or TRUE FOR THIS MACHINE? A branch name, a dashboard
icon, a lint budget, a launcher's name+harness are project facts → committed spexcode.json. The ABSOLUTE
PATH of a launcher wrapper, a TLS cert path, private mode are machine facts → gitignored spexcode.local.json.
Both files are optional; omit any field to take its default.

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
  sessions.maxActive        concurrency cap — max agents AUTONOMOUSLY PROGRESSING at once (default 6).
                            A policy number → committed spexcode.json.
  sessions.claudeCmd        the UNNAMED default worker launcher for Claude (default
                            'claude --dangerously-skip-permissions'); env SPEXCODE_CLAUDE_CMD overrides.
  sessions.codexCmd         the UNNAMED default worker launcher for Codex (default 'codex --yolo'); env
                            SPEXCODE_CODEX_CMD overrides.
  sessions.launchers        NAMED launcher profiles (see LAUNCHERS).
  sessions.defaultLauncher  the launcher name a create with no explicit --launcher/dropdown pick uses
                            (else the unnamed claudeCmd/codexCmd path). A portable NAME → committed.
A claudeCmd/codexCmd or a launcher \`cmd\` that is a HOST-SPECIFIC ABSOLUTE PATH belongs in
spexcode.local.json — the committed file must stay free of machine paths.

── LAUNCHERS (the profile block, split across the two files) ──
A named launcher profile fixes BOTH a session's harness AND its exact launch command; a create picks one
by name, and the chosen name is persisted on the record so a resume reuses the same auth. Shape:
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

── ISSUES (spexcode.json — portable policy) ──
  issues.enabled      the issues-workflow on/off switch (default ON). OFF silences the post-merge nudge and
                      hides the dashboard view; the CLI toggle is \`spex issues on|off\`.

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
              { "plugin": "<folder>" } bundle. Default (omitted): all native harnesses.
  private     (spexcode.local.json ONLY) private-overlay mode — when true, \`spex materialize\` leaves ZERO
              trace in the host's TRACKED files: managed ignore entries go to .git/info/exclude and any
              tracked contract file is marked skip-worktree. Trades away git-derived spec version history.
              A HOST decision → never the committed file. See PRIVATE MODE below.

── PRIVATE MODE (default ⇄ private — the two delivery modes) ──
DEFAULT mode (private absent/false): materialize commits .spec + spexcode.json and writes its ignore list as
a managed block in the TRACKED .gitignore — transparent, but every collaborator sees it. PRIVATE mode
(spexcode.local.json { "private": true }): the SAME contract reaches the agent, but the ignore list goes to
the per-clone .git/info/exclude and any host-tracked CLAUDE.md/AGENTS.md is skip-worktree'd — so \`git status\`
stays clean and nothing enters shared history.

  Switch:   edit spexcode.local.json  ({ "private": true } on / false or remove = off), then \`spex materialize\`
            (the hook gate also re-runs it on the next agent turn).
  Reversible + idempotent: the two modes fully CANCEL OUT. default→private→default (or private→default→private)
            converges to the SAME on-disk state as running that mode once — each mode re-asserts the inverse of
            the other (exclude block ⇄ .gitignore block, skip-worktree set ⇄ cleared). Switch order never
            matters; running a mode twice changes nothing.

MANUAL STEP (the only one materialize can't do for you — it also PRINTS this when needed):
  .git/info/exclude hides UNTRACKED paths only. If you adopted DEFAULT mode first, .spec + spexcode.json are
  already committed, so private mode can't hide them until you un-track them ONCE:
      git rm -r --cached .spec spexcode.json     # keeps the files on disk, stops tracking them
  (then commit that on your branch). A private-from-the-start adoption never needs this.

FOOTGUN (skip-worktree): a host-tracked CLAUDE.md/AGENTS.md is skip-worktree'd in private mode, so a later
  \`git pull\` that touches it can complain. Fix: flip back to DEFAULT mode (or \`git update-index
  --no-skip-worktree CLAUDE.md AGENTS.md\`), pull, then re-materialize.`

const TOPICS: Record<string, string> = { spec: SPEC, yatsu: YATSU, config: CONFIG }

export function guideText(topic?: string): string {
  if (!topic) return SETUP
  const t = TOPICS[topic]
  if (t) return t
  return `spex guide: no topic '${topic}'. Topics: spec, yatsu, config. Run \`spex guide\` (no topic) for the setup workflow.`
}
