// @@@ help journey - the CLI's three help layers, each pointing at the next so no probe dead-ends:
//   1. `spex help`            → the MAP: every porcelain command, grouped by the loop it serves.
//   2. `spex help <cmd>`      → ONE command's usage (also `spex <cmd> --help`, intercepted pre-verb).
//   3. `spex guide [topic]`   → the SKILL layer: workflows, file formats, best practice (guide.ts).
// help answers "what do I type"; guide answers "how do I work". Machine plumbing (hook/launch-script
// callees) lives under `spex internal` and is deliberately absent from the map — an agent scanning
// `spex help` sees only verbs meant for it. Governed by the cli-surface spec node.

// One command's help entry. `see` renders as a trailing "see also:" journey pointer.
type Entry = { line: string; body: string; see?: string }

const SEL_NOTE = `SEL = session id (or unique id-prefix) | node id | branch — every session read/control verb
accepts any of the three; none (or @all) means every session.`

const ROUTING_NOTE = `Backend routing: every session verb accepts --api <url> (--port <n> = localhost sugar) to name its
backend explicitly — the flag always wins. Bare, it resolves: worker env / the cwd project's live
recorded backend / fallback / :8787 (spex guide config → BACKEND ROUTING).`

// aliases resolve to a canonical entry so `spex help session` and `spex session new --help` meet the same text.
const ALIAS: Record<string, string> = { 'review-proof': 'eval', help: 'help' }

const ENTRIES: Record<string, Entry> = {
  // ── find & read the graph ─────────────────────────────────────────────────
  search: {
    line: 'search <query>        which spec node GOVERNS a topic — ranked by user-story, not grep',
    body: `Usage: spex search <query…> [--limit N=10] [--json]

Finds the spec node(s) whose INTENT matches your topic — ranked by user-story relevance, which
surfaces user-facing behaviour a code-grep misses. Run it BEFORE touching code: the returned node's
spec.md body is the current contract for that area. Prints title, id, path, snippet per hit.
The corpus is English — query in English (translate first if your question isn't).`,
    see: 'spex owner (file → node, the reverse edge) · spex guide spec (what a node is)',
  },
  owner: {
    line: 'owner <path>          the reverse edge: which spec node(s) govern or reference a file',
    body: `Usage: spex owner <path> [--actionable]

Maps a source file to BOTH spec relations: its GOVERNORS (code: — the source of truth; drives
drift/yatsu) and its REFERENCERS (related: — coverage only), with the verdict spelled out:
uncovered ("give it a home"), related-only (covered, but nothing tracks its drift), sanely
governed (read/honor that spec), or over-owned (> maxOwners — split the file). --actionable
prints NOTHING unless action is needed (hook use): only uncovered / over-owned fire.`,
    see: 'spex search (topic → node) · spex lint (coverage over the whole tree)',
  },
  tree: {
    line: 'tree                  the graph as a human-readable tree (status-coloured, badges)',
    body: `Usage: spex tree [--node <id>] [--depth N] [--json]

Prints the assembled spec graph as an indented tree — the CLI twin of the dashboard's tidy-tree,
built from the same board (merged tree + worktree overlay). One line per node: id, derived status
(coloured when stdout is a tty; NO_COLOR respected — the status word always prints), title, and
attention badges: drift:N (drifted files), stale:N (yatsu scenarios whose latest reading aged),
issues:N (open issues), ghost (being added by a worktree).
  --node <id>   render just that subtree (unknown id fails loud)
  --depth N     limit levels below the shown root; prunes are counted, never silent
  --json        the same filtered subtree as nested objects, badge counts precomputed`,
    see: 'spex board (the full flat JSON payload) · spex search (find one node by intent)',
  },
  board: {
    line: 'board                 dump the assembled board as JSON (tree · overlay · sessions)',
    body: `Usage: spex board

Prints the full dashboard board state as JSON — the merged spec tree, per-worktree overlay, and the
session list. Identical to GET /api/board; needs the backend (spex serve) reachable.`,
    see: 'spex tree (the same graph, human-readable) · spex ls (just the sessions, as a table) · spex search (find one node instead of dumping all)',
  },
  guide: {
    line: 'guide [topic]         the manuals: setup workflow · spec/yatsu file formats · spexcode.json',
    body: `Usage: spex guide            the human setup workflow (install once, adopt a repo, serve)
       spex guide spec       the spec.md file format + every lint rule
       spex guide yatsu      the yatsu.md scenario format + how loss is measured and filed
       spex guide config     every spexcode.json / spexcode.local.json field, and which file it belongs in

guide is the SKILL layer — workflows and formats. Command usage lives here in help
(\`spex help <cmd>\`); guide carries what the commands assume you know.`,
  },

  // ── author & verify (worker loop) ─────────────────────────────────────────
  lint: {
    line: 'lint                  check the spec↔code graph (integrity·living·altitude·coverage·drift·owners)',
    body: `Usage: spex lint

Checks the whole graph and exits non-zero on errors (or a blocked commit-local drift gate):
  integrity (error)  a code:/related: path doesn't exist
  living    (error)  a body accretes a "## vN" changelog instead of staying current-state
  altitude  (warn)   a body slid below contract altitude into a mechanics dump
  coverage  (warn)   a governed source file no node claims yet
  drift     (warn)   a governed file changed after its spec's last version
  owners    (warn)   a file governed by more than maxOwners nodes — split it
When run from the pre-commit hook, a staged commit touching a heavily-drifted node BLOCKS
(bypass: SPEXCODE_SKIP_LINT=1); CI/manual runs are advisory beyond errors.`,
    see: 'spex guide spec (each rule explained) · spex ack (drift that is mechanics-only)',
  },
  ack: {
    line: 'ack <node>… --reason  stamp Spec-OK on HEAD: this change keeps those specs valid',
    body: `Usage: spex ack <node-id>… --reason "<why the contract still holds>"

Amends HEAD with a Spec-OK trailer per node — the drift remedy when only MECHANICS changed and the
spec's contract still holds. --reason is required (it forces the check) but NOT stored; git keeps
only the trailer. If the intent DID change, edit the spec instead — same commit as the code.`,
    see: 'spex lint (where drift is reported) · spex guide spec (drift remedies)',
  },
  yatsu: {
    line: 'yatsu <sub>           measure a node’s scenarios & file the loss signal: scan | eval | retract | show | clean',
    body: `Usage: spex yatsu scan [--changed]                       list nodes/scenarios missing readings
       spex yatsu eval [.|<node>] [--scenario <name>] (--pass|--fail)
                       [--note <text>] [--image <png> | --result <path|->]
       spex yatsu retract [.|<node>] [--scenario <name>] [--last | --ts <iso>] [--note <why>]
       spex yatsu show [.|<node>] [--json]              readings history for a node
       spex yatsu clean [--keep-latest | --all]         prune stored readings

Files a reading of a scenario against its expected — the loss signal the optimizer reads. Measure
through the REAL product surface (run it, drive a browser, screenshot), never by reasoning about
the code. A fix's proof is a fail→pass pair on the SAME scenario. \`retract\` is the sanctioned
undo for a botched filing: it APPENDS a retraction event (traceable, never deletes a line).`,
    see: 'spex guide yatsu (yatsu.md format + evidence rules) · spex blob (stash evidence bytes)',
  },
  blob: {
    line: 'blob put|get          evidence bytes ⇄ content hash: put stashes & prints the hash, get reads back',
    body: `Usage: spex blob put <file|->
       spex blob get <hash> [-o <file>]

put writes bytes into the shared content-addressed evidence cache and prints the hash — transport
only, no reading filed. Use the hash with --evidence on issues/remarks; re-putting the same content
restores a pruned or cloned-away blob.

get is the symmetric read: hash in, bytes out. Local cache first (no backend needed — the evidence
is usually on this disk), then the backend's /api/yatsu/blob/:hash on a local miss; both missing
fails loud naming each path. Bytes go to stdout by default (pipe-friendly); -o writes a file.`,
    see: 'spex yatsu eval (file a reading with evidence) · spex issues open --evidence <hash>',
  },
  issues: {
    line: 'issues …              THE issue surface: one merged local+forge list, plus all write verbs',
    body: `Usage: spex issues                                        the merged read (local + forge, store-tagged)
                  [--node <id>] [--store local|github] [--all] [--json]
       spex issues open "<concern>" [--store local|<host>] [--node <id>…] [--evidence <hash>…] [--body -|<text>]
       spex issues reply <id> --body -|<text> [--evidence <hash>…]     (routes by the issue's store)
       spex issues close <id>             close by the issue's store: local lands, forge closes remote
       spex issues promote <id>           move an OPEN local issue to the forge (one recorded action)
       spex issues on|off|status          toggle/inspect the local-issue workflow

Bare \`spex issues\` is the drain view a supervisor reads. \`open\` welcomes taste, annotations, and
off-mainline smells — not only bugs; \`--store <host>\` opens straight on the forge (the same port the
dashboard's New form uses). \`close\` and \`reply\` route by the issue's store — one verb, local or forge,
the same routing as the dashboard. (\`nudge\` exists but is fired by the post-merge hook, not typed.)`,
    see: 'spex remark (pin a resolvable concern to an issue or scenario) · spex forge (trace forge → nodes)',
  },
  remark: {
    line: 'remark / resolve / retract   pin a resolvable concern to a host; a peer resolves, the author retracts',
    body: `Usage: spex remark <issue-id | <node> --scenario <name>> --body -|<text> [--code-sha <sha>] [--evidence <hash>…]
       spex resolve <remark-ref>          (the <thread-id>#<rid> that \`spex remark\` printed)
       spex retract <remark-ref>

The resolvable interaction primitive: pin a concern to a HOST — a local issue or a yatsu scenario —
that a second agent can \`resolve\` and the author can \`retract\`. The whole loop is CLI-first; the
dashboard adds no capability.`,
    see: 'spex issues (the hosts) · spex yatsu show (scenario hosts)',
  },
  forge: {
    line: 'forge <sub>           read-only trace of forge issues/PRs onto spec nodes: links | eval-pending',
    body: `Usage: spex forge links        [--host github] [--node <id>] [--json]
       spex forge eval-pending [--host github] [--node <id>] [--json]

Resolves a forge's open issues/PRs to the spec nodes they serve (the Spec: marker in an issue body;
a node/<id> branch links its PR for free). Read-only — git/.spec stays the single source of truth.`,
    see: 'spex issues (the merged read that includes forge threads)',
  },
  // ── dispatch & manage sessions (manager loop) ─────────────────────────────
  new: {
    line: 'new "<prompt>"        launch a worker session in its own node worktree  [--node <id>]',
    body: `Usage: spex new "<task prompt>" [--node <id>] [--harness <name>] [--launcher <cmd>]

Creates a session: node branch + worktree + a launched agent carrying your prompt (= session new).
Give it ONLY its task — the dev-flow contract reaches it through the materialized system prompt.
Routes through the running backend (auth env + concurrency cap); prints the created session JSON.
Then MONITOR it: background \`spex wait <id>\`, or \`spex watch\` for the whole stream.`,
    see: 'spex wait / spex watch (monitor) · spex review (when it proposes) · ' + SEL_NOTE.split('\n')[0],
  },
  ls: {
    line: 'ls [SEL…]             living-sessions table  [--status a,b] [--json] [--api URL]',
    body: `Usage: spex ls [SEL…] [--status a,b] [--json] [--api <url> | --port <n>]

One-shot table of living sessions and their states, from the resolved backend — bare \`spex ls\` in a
project's tree hits THAT project's live backend; --api <url> (or --port <n>) points it anywhere,
including a remote machine's. ${SEL_NOTE}
${ROUTING_NOTE}`,
    see: 'spex watch (the live stream) · spex wait (block on one session)',
  },
  watch: {
    line: 'watch [SEL…]          stream actionable transitions — NEVER EXITS; background it, never block on it',
    body: `Usage: spex watch [SEL…] [--as NAME] [--status a,b] [--idle] [--interval N=5]

Streams session lifecycle transitions (launched → review/done/offline/error/needs-input → closed)
until killed. It NEVER EXITS — it is the human's forever stream. An agent must background it or use
\`spex wait <SEL>\` (one-shot) instead; blocking a turn on watch freezes you. Watching draws a
supervision edge on the session graph and greets the watched sessions once.
${SEL_NOTE}`,
    see: 'spex wait (the one-shot, guaranteed-to-exit counterpart)',
  },
  wait: {
    line: 'wait <SEL>            block until <SEL> is actionable, print the status, exit',
    body: `Usage: spex wait <SEL> [--timeout S=1200] [--interval S=2] [--idle]

Blocks until the session reaches an actionable status, prints it, and EXITS — the supervisor's
per-worker monitor (background one wait per worker; the exit is your wake-up). Guaranteed to
terminate: --timeout is the hard wall (exit 1); a vanished session exits 2; a down backend fails
loud (exit 1), never a false timeout. Draws the watcher→worker edge for the whole wait.
${SEL_NOTE}`,
    see: 'spex watch (the forever stream) · spex review (what to run when it prints review/done)',
  },
  review: {
    line: 'review <SEL>          manager cockpit: ahead · merge-base diff · gates · proposal  [--json]',
    body: `Usage: spex review <SEL> [--json]

The ONE review payload for a session: commits ahead of the trunk, uncommitted files, its proposal,
the gates (conflicts with the trunk, lint), and the merge-base diff — decide from this, don't
hand-run git. The MEASURED side of the decision is \`spex eval <SEL>\`: the changed nodes' eval
readings, and (--proof) the self-contained proof export.
${SEL_NOTE}`,
    see: 'spex eval (the session’s measured loss) · spex merge (act on an approved review)',
  },
  eval: {
    line: 'eval <SEL>            the session’s eval readings: its changed nodes’ measured loss  [--proof]',
    body: `Usage: spex eval <SEL> [--json]
       spex eval <SEL> --proof [--open | --out <path> | --json]

The session's evaluation, read from the backend (the dashboard Eval tab's CLI twin): every spec node
the session's diff touches, each DECLARED scenario at its CURRENT score (latest reading, rooted at
the session's worktree). Blind spots lead (declared, never measured — the outstanding loss), then
the session's OWN measurements ✦-marked, then the inherited baseline (other sessions' latest
readings) under an explicit divider. A frontend change with no yatsu.md is flagged, never hidden.
--proof exports the review PROOF instead — the self-contained HTML artifact (diff · evidence
inlined · gates; --json = the model) for CI/sharing. (\`spex review proof\` is its deprecated alias.)
This is the READ; filing a reading stays \`spex yatsu eval\`.
${SEL_NOTE}`,
    see: 'spex review (gates + diff — the merge decision) · spex yatsu eval (FILE a reading, the write verb)',
  },
  merge: {
    line: 'merge <SEL>           gated merge into the trunk — dispatched to the session’s own agent',
    body: `Usage: spex merge <SEL>

Dispatches the merge to the session's OWN agent (it knows the work's intent and resolves conflicts);
the server never touches the trunk's tree. Gates re-check first. After it lands, confirm HEAD
advanced before closing the session — closing an unmerged branch discards the work.
Mutating verbs are PROJECT-BOUND: a backend serving another project's repo refuses the write loudly
(name the target with --api <url> to write cross-project on purpose).
${SEL_NOTE}`,
    see: 'spex review (before) · spex session close (after the merge is confirmed)',
  },
  session: {
    line: 'session <sub>         the state machine: new·reopen·done·park·ask·exit·close·send·capture·attach·rename·rawkey·prompt',
    body: `Worker verbs (declare YOUR OWN state — a claim the board and your supervisor act on):
  spex session done --propose merge|nothing|close [--note T]   committed and stopping; merge = ready for review
  spex session park --note <what-you-await>                    a real background task will wake you
  spex session ask  --note <your-question>                     stopped on the human; resumes when they reply

Manager verbs (control another session; all take SEL):
  spex session send <SEL> "<msg>"      deliver a message (fail-loud: a dead dispatch exits non-zero)
  spex session capture <SEL>           the live pane as text
  spex session rename <SEL> "<name>"   set the display name ("" clears; the right-click rename, as a verb)
  spex session rawkey <SEL> "<keys>"   raw nav keys to a TUI dialog, in strike order (e.g. "Up Up Enter";
                                       named keys · single chars · C-/M-/S- combos; fail-loud)
  spex session prompt <SEL>            the session's originating prompt
  spex session reopen <SEL> [--force]  relaunch ONLY if confirmed offline (--force for a wedged live one)
  spex session exit <SEL>              soft stop: kill the agent, KEEP the worktree (resumable)
  spex session close <SEL>             retire the session and its worktree
  spex session new "<prompt>"          = spex new

Human escape hatch:
  spex session attach <SEL>            sit in the worker's REAL tmux (detach: C-b d; the session keeps
                                       running). INTERACTIVE AND BLOCKING — like watch, an agent must
                                       NEVER run it in a turn (it freezes you): use capture/send/rawkey.
                                       LOCAL-only — the tmux server is the backend machine's, so it fails
                                       loud when the resolved backend is remote. Offline session → loud.

(state · fail · idle · commit-gate also exist but are hook-driven — the lifecycle hooks call them;
never type them.) ${SEL_NOTE}
Manager verbs that WRITE (send/rename/rawkey/reopen/exit/close) are PROJECT-BOUND: a backend serving
another project's repo refuses loudly — name the target with --api <url> to drive it on purpose.
${ROUTING_NOTE}`,
    see: 'spex new (launch) · spex wait/watch (monitor) · spex review/merge (land)',
  },

  // ── install & serve (operator) ────────────────────────────────────────────
  init: {
    line: 'init [dir]            adopt SpexCode on a repo: seed .spec + hooks + materialize  [--preset name]',
    body: `Usage: spex init [dir=cwd] [--preset default|careful]

Scaffolds adoption in one shot: seeds a starter .spec tree (project root + .config plugins), plants
spexcode.json, installs the git hooks, and materializes the harness artifacts (contract block +
shims). Additive — never overwrites your files. --preset picks the .config plugin tier (cumulative).`,
    see: 'spex guide (the full setup workflow) · spex uninstall (the inverse) · spex lint (adoption TODO)',
  },
  uninstall: {
    line: 'uninstall [dir]       surgical inverse of init — removes generated artifacts, keeps your .spec  [--hooks]',
    body: `Usage: spex uninstall [dir=cwd] [--hooks]

Removes every SpexCode-GENERATED artifact (harness shims · contract blocks · trust entries ·
.gitignore block · global store · plugin bundle) and never your .spec/.config data or your own
prose. Git hooks are preserved unless --hooks.`,
    see: 'spex init (re-adopt later — your .spec survives)',
  },
  materialize: {
    line: 'materialize           re-render the harness artifacts (contract block · shims) for cwd’s project',
    body: `Usage: spex materialize

Renders the surface:system config nodes into the managed <!-- spexcode --> block of
CLAUDE.md/AGENTS.md plus the .claude/.codex shims, and prints the content hash. Run it after a
toolchain update or any .config edit that the automatic dispatch gate hasn't picked up — these
artifacts are generated and gitignored, so they never arrive via git.`,
    see: 'spex doctor (verify the render actually reaches an agent)',
  },
  doctor: {
    line: 'doctor                diagnose whether the workflow actually reaches this agent — per-layer, per-harness',
    body: `Usage: spex doctor             per-layer coverage report: preconditions · git-hook floor · contract ·
                               hooks + handler existence · backend — for every harness materialize renders
       spex doctor contract    print the composed surface:system text any agent here reads
       spex doctor conflicts   detect double-delivery (loose artifacts beside the managed ones)

Run it when a worker seems to be missing its contract or hooks — it names the broken layer and the
repair, instead of you diffing materialized files by hand.`,
    see: 'spex materialize (re-render the artifacts doctor checks)',
  },
  serve: {
    line: 'serve                 run the API backend (default :8787)  [--port N] [--public --password pw]',
    body: `Usage: spex serve [--port N=8787]
       spex serve --public --password <pw> [--tls-cert F --tls-key F] [--http]

Runs the backend for the repo at cwd behind a zero-downtime supervisor (hot-reloads on source
change; the public port never gaps). --port pairs with \`spex dashboard --api-port\`, so many
projects coexist on one host. On a successful bind it RECORDS its endpoint in the per-project
runtime tier — that's how a bare \`spex\` run from this project's tree finds this backend (see
spex guide config → BACKEND ROUTING). --public exposes it on a public IP behind a password +
self-signed TLS (own cert via --tls-cert/--tls-key; --http drops TLS).`,
    see: 'spex dashboard (the UI on top) · GET /health (liveness probe)',
  },
  dashboard: {
    line: 'dashboard             serve the dashboard UI (default :5173), proxying /api to a running serve',
    body: `Usage: spex dashboard [--port N=5173] [--api-port N=8787] [--host H=127.0.0.1]

Serves the bundled dashboard on its own port and proxies /api + the terminal socket to a running
\`spex serve\`. The installed replacement for the dev-only \`npm run web\`. Loopback-only by default;
--host 0.0.0.0 (or a specific interface) opens it to a LAN/tailnet — still plain HTTP with no gate,
so bind wide only on a network you trust (for the internet, use \`spex serve --public\`).`,
    see: 'spex serve (must be running first)',
  },

  // ── plumbing ──────────────────────────────────────────────────────────────
  internal: {
    line: '',   // deliberately not on the map
    body: `Usage: spex internal <trunk | codex-launch | codex-turn>

Machine plumbing — called by generated hooks and launch scripts, never typed by a human or agent:
  trunk         print the resolved source-of-truth branch (the pre-commit main-guard captures it)
  codex-launch  <sock> <cwd> [prompt…]   backend-owned codex thread/start + first turn (launch script)
  codex-turn    <sock> <threadId> <text…>  fire a follow-up turn on an owned thread (tests/scripts)

If you reached for one of these by hand, the porcelain you want is probably elsewhere: the trunk
name also lives at GET /api/layout; sessions are driven with spex new / session send.`,
    see: 'spex help (the porcelain map)',
  },
  help: {
    line: '',
    body: `Usage: spex help              the command map, grouped by the loop each verb serves
       spex help <command>    one command's usage (same as spex <command> --help)
       spex guide [topic]     the skill layer: workflows, file formats, best practice`,
  },
}

// `spex <cmd> --help` must meet the user wherever they typed it: sub-namespace tokens map to their
// canonical entry, so \`spex session send --help\` and \`spex help session\` print the same text.
export function commandHelp(name: string): string | null {
  const key = ALIAS[name] ?? (name === 'resolve' || name === 'retract' ? 'remark' : name)
  const e = ENTRIES[key]
  if (!e) return null
  const oneLiner = e.line.replace(/^\S+(\s+\S+)*?\s{2,}/, '')   // the map line minus its "cmd args" column
  const header = oneLiner ? `spex ${key} — ${oneLiner}\n\n` : ''  // unlisted entries (internal, help) lead with their own Usage
  return `${header}${e.body}${e.see ? `\n\nsee also: ${e.see}` : ''}\n\nmap: spex help · skills: spex guide`
}

export function overviewHelp(): string {
  return `spex — SpexCode CLI (spec↔code graph + worktree session state machine)

Usage: spex <command> [args]      one command's usage: spex help <command>  (or spex <command> --help)

Find & read the graph
  ${ENTRIES.search.line}
  ${ENTRIES.owner.line}
  ${ENTRIES.tree.line}
  ${ENTRIES.board.line}
  ${ENTRIES.guide.line}

Author & verify (the worker loop)
  ${ENTRIES.lint.line}
  ${ENTRIES.ack.line}
  ${ENTRIES.yatsu.line}
  ${ENTRIES.blob.line}
  ${ENTRIES.issues.line}
  ${ENTRIES.remark.line}
  ${ENTRIES.forge.line}

Dispatch & manage sessions (the manager loop)
  ${ENTRIES.new.line}
  ${ENTRIES.ls.line}
  ${ENTRIES.watch.line}
  ${ENTRIES.wait.line}
  ${ENTRIES.review.line}
  ${ENTRIES.eval.line}
  ${ENTRIES.merge.line}
  ${ENTRIES.session.line}

Install & serve (the operator loop)
  ${ENTRIES.init.line}
  ${ENTRIES.uninstall.line}
  ${ENTRIES.materialize.line}
  ${ENTRIES.doctor.line}
  ${ENTRIES.serve.line}
  ${ENTRIES.dashboard.line}

${SEL_NOTE}

${ROUTING_NOTE}

Concepts & best practice live in the guide: spex guide (setup) · guide spec · guide yatsu · guide config.
Machine plumbing (hook/launch-script callees) lives under \`spex internal\` — not part of your vocabulary.`
}
