// @@@ guide - SpexCode's reference surface as a COMMAND (the model: install once, then an agent drives).
// `spex guide` with no topic prints the human SETUP workflow; `spex guide spec` / `spex guide yatsu` are the
// agent-facing FILE-FORMAT manuals — the whole detail of the two authored artifacts, so an agent can look up
// the schema on demand instead of reverse-engineering it. The system prompt is the CLUE that these exist;
// this is the manual that carries the detail. Static narration like printHelp, NOT a planted .spec template,
// and not routed through the dashboard i18n (operator-facing CLI output, not browser UI).

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

The file formats an agent authors — run these for the full schema:
  spex guide spec     the spec.md format (frontmatter + body + the rules lint enforces)
  spex guide yatsu    the yatsu.md format (scenario schema + how loss is measured and filed)`

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
  surface  config/.config nodes only: system (folded into every agent's prompt) | slash (a /command) |
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

THE SCHEMA IS ENFORCED (closed field set, three required fields, unique names). A missing required field,
an unknown key (a typo like \`descripton:\`), a duplicate name, or no scenarios at all is rejected LOUD:
\`spex yatsu scan\` reports it as \`yatsu-schema\`, and the pre-commit \`yatsu check-staged\` BLOCKS the commit.

BODY (after the frontmatter): prose naming the measurement method — YATU ("You As The User"): the agent
looks at / calls the real product surface, not an internal helper chosen to make the proof easy.

MEASURING AND FILING: the agent runs the scenario however it likes (a browser screenshot, an API
transcript, a by-hand pass), compares the result to \`expected\`, and files it:
  spex yatsu eval <node> --scenario <name> (--pass | --fail | --note <text>) [--image <png> | --result <txt>|-]
Frontend → \`--image <png>\` (visual evidence); backend → \`--result <txt>\` (a transcript; \`-\` reads stdin).

THE SCOREBOARD: readings live in yatsu.evals.ndjson beside the yatsu.md — one JSON line per measurement
(a second git-as-database axis). Freshness is derived live from git: a reading goes STALE when a governed
code file, the scenario (the yatsu.md), or the evaluator moves since it was filed.
  spex yatsu scan [--changed]   blind spots: yatsu-schema (malformed) · yatsu-drift (stale) ·
                                yatsu-missing (never measured) · yatsu-uncovered (frontend, no yatsu.md) ·
                                yatsu-owners (a file governed by > maxOwners scenarios — split it)
  spex yatsu show <node>        the reading timeline (verdict · freshness · evidence), newest first
  spex yatsu clean              GC the content-addressed evidence cache`

const TOPICS: Record<string, string> = { spec: SPEC, yatsu: YATSU }

// @@@ guideText - dispatch on the optional topic: no topic → the setup workflow; a known topic → its
// file-format manual; anything else → a one-line pointer at the real topics (fail-loud, not a silent setup
// dump). The single text surface `spex guide [topic]` routes through.
export function guideText(topic?: string): string {
  if (!topic) return SETUP
  const t = TOPICS[topic]
  if (t) return t
  return `spex guide: no topic '${topic}'. Topics: spec, yatsu. Run \`spex guide\` (no topic) for the setup workflow.`
}
