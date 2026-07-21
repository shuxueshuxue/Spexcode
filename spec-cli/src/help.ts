// @@@ help journey - the CLI's three help layers, each pointing at the next so no probe dead-ends:
//   1. `spex help`            → the MAP: the whole noun-first surface, one line per drawer/verb.
//   2. `spex help <cmd>`      → ONE drawer/command's usage (also `spex <cmd> --help`, intercepted pre-verb).
//   3. `spex guide [topic]`   → the SKILL layer: workflows, file formats, best practice (guide.ts).
// help answers "what do I type"; guide answers "how do I work". Machine plumbing (hook/launch-script
// callees) lives under `spex internal` and is deliberately absent from the map — an agent scanning
// `spex help` sees only verbs meant for it. Governed by the cli-surface spec node.
//
// The grammar the map teaches: `spex <noun> <verb> [object] [flags]` — the verb is always the second
// token after its noun; a bare noun prints its drawer's help; a bare verb exists only where the object is
// invariably THIS PROJECT. One verb, one spelling: there are no aliases and no promoted twins.

// One command's help entry. `see` renders as a trailing "see also:" journey pointer.
type Entry = { line: string; body: string; see?: string }

const SEL_NOTE = `SEL = session id (or unique id-prefix) | node id | branch — every session read/control verb
accepts any of the four; inside a session worktree, . means that worktree's session. On the list verbs (ls/watch),
none (or @all) means every session.`

const ROUTING_NOTE = `Backend routing: every backend-touching verb accepts --api <url> (--port <n> = localhost sugar) to name
its backend explicitly — the flag always wins. Bare, it resolves: worker env / the cwd project's live
recorded backend / fallback / :8787 (spex guide settings → BACKEND ROUTING).`

const DOT_NOTE = `\`.\` as a node argument means the node THIS worktree works on (the session's bound node, else the
node/<id> branch). One-shot payload reads (graph · spec search · session ls/show/review · eval ls ·
scenario ls · issue ls/show/links) take --json.`

const MENTION_NOTE = `Mentions: @session · [[node]] · @new / @new:<launcher> work in ANY prompt, issue, or remark body —
text passed as a CLI arg included. [[node]] names the topic node; @session hands the text to that live agent;
@new spawns a fresh worker on the thread's node (bare = configured default; :<launcher> = that named profile).`

const ENTRIES: Record<string, Entry> = {
  // ── project verbs (implicit object = this project) ────────────────────────
  graph: {
    line: 'graph                 the assembled view: bare = readable tree · --json = the full payload',
    body: `Usage: spex graph [--focus <id>] [--depth N] [--json]

The ONE assembled view — merged spec tree + worktree overlay + sessions. Bare it renders the
status-coloured tree (coloured when stdout is a tty; NO_COLOR respected), one line per node: id,
derived status, title, and attention badges (drift:N · stale:N · issues:N · ghost).
  --focus <id>  render just that subtree (unknown id fails loud)
  --depth N     limit levels below the shown root; prunes are counted, never silent
  --json        the full payload (tree · overlay · sessions), identical to GET /api/graph — machine
                food; with --focus/--depth it is that filtered subtree as nested objects instead`,
    see: 'spex spec search (find one node by intent) · spex session ls (just the sessions, as a table)',
  },
  init: {
    line: 'init [dir]            adopt SpexCode on a repo: seed .spec + hooks + materialize  --harness <ids> [--preset name]',
    body: `Usage: spex init [dir=cwd] --harness <id[,id]|plugin:<folder>> [--preset default]

Scaffolds adoption in one shot: seeds a starter .spec tree (project root + .plugins plugins), plants
spexcode.json, installs the git hooks, and materializes the harness artifacts (contract block +
shims). --harness is REQUIRED — the explicit choice of which harnesses materialize delivers into
(stamped as spexcode.json "harnesses"; only their launchers are seeded); a pre-existing "harnesses"
field satisfies it. Additive — never overwrites your files. --preset picks the .plugins plugin tier (cumulative).
Footprint is fixed: materialized artifacts are never tracked — hidden via the per-clone .git/info/exclude, with
a tracked/mixed CLAUDE.md/AGENTS.md covered by the clean/smudge filter (see spex guide footprint).`,
    see: 'spex guide (the full setup workflow) · spex uninstall (the inverse) · spex spec lint (adoption TODO)',
  },
  materialize: {
    line: 'materialize           the base pass of harness adaptation: render .spec/.plugins into your harness’s artifacts',
    body: `Usage: spex materialize

The base operation of HARNESS ADAPTATION: one pass renders the spec tree's surface nodes into the
artifacts each selected harness auto-discovers — the managed <!-- spexcode --> block of
CLAUDE.md/AGENTS.md, the .claude/.codex shims, the skills/agents — and prints the content hash.
The outputs are derived and never tracked: to change one, edit its source (.plugins, spexcode.json)
and re-materialize — never the artifact. Not a one-time setup: it anchors on git-native events
(init · this verb · session-worktree creation · the pre-commit/post-checkout/post-merge hooks) —
run it by hand after a toolchain update, or in the setup step of any clone that has no spex-planted
hooks yet (CI, a cloud agent): generated and excluded, the artifacts never arrive via git.`,
    see: 'spex doctor (verify the materialized artifacts actually reach an agent)',
  },
  doctor: {
    line: 'doctor                diagnose spec health and whether the workflow reaches this agent  [--contract|--conflicts]',
    body: `Usage: spex doctor                spec-health findings + delivery report: preconditions · git-hook floor ·
                                  contract · hooks + handler existence · backend · footprint
       spex doctor --contract     print the composed surface:system text any agent here reads
       spex doctor --conflicts    detect double-delivery (loose artifacts beside the managed ones)

Bare doctor is the opt-in, read-only health surface: it reports altitude and breadth findings without
putting them in the lint gate, then audits workflow delivery. Run it directly or let the tidy workflow
consume the same visible diagnosis.`,
    see: 'spex spec lint (deterministic graph/contract gate) · spex materialize (repair delivery artifacts)',
  },
  uninstall: {
    line: 'uninstall [dir]       remove all derived artifacts + local state; preserve tracked intent  [--hooks]',
    body: `Usage: spex uninstall [dir=cwd] [--hooks]

Removes all SpexCode-derived wiring and project-local state: contract blocks, harness shims,
generated skills/agents, plugin bundles, trust/filter/exclude entries, and the global per-project
store. Your tracked intent (.spec including .plugins, plus spexcode.json) and surrounding user prose
are preserved. Git hooks remain unless --hooks; that flag removes only unmodified canonical copies.`,
    see: 'spex init (re-adopt later — your tracked intent survives)',
  },
  serve: {
    line: 'serve [api|ui]        api (default) = the backend :8787 · ui = the dashboard :5173 on top of it',
    body: `Usage: spex serve [api] [--port N=8787]
       spex serve [api] --public --password <pw> [--tls-cert F --tls-key F] [--http]
       spex serve ui [--port N=5173] [--api-port N=8787] [--host H=127.0.0.1]

\`serve\` (or \`serve api\`) runs the backend for the repo at cwd behind a zero-downtime supervisor
(hot-reloads on source change; the public port never gaps). On a successful bind it RECORDS its
endpoint in the per-project runtime tier — that's how a bare \`spex\` run from this project's tree
finds this backend (spex guide settings → BACKEND ROUTING). --public exposes it on a public IP behind
a password + self-signed TLS (own cert via --tls-cert/--tls-key; --http drops TLS).

\`serve ui\` is a SEPARATE process: it serves the bundled dashboard on its own port and proxies /api +
the terminal socket to a running backend (--api-port pairs with the backend's --port, so many
projects coexist on one host). Loopback-only by default; --host 0.0.0.0 opens it to a LAN/tailnet —
still plain HTTP with no gate, so bind wide only on a network you trust.`,
    see: 'GET /health (backend liveness probe)',
  },
  dashboard: {
    line: 'dashboard             ONE dashboard for every project you serve — no --api-port pairing  [--port N=5173]',
    body: `Usage: spex dashboard [--port N=5173] [--host H=127.0.0.1]

The HOST gateway: serves the built dashboard once and routes to EVERY backend the current user runs —
the multi-project hub engine plus the host registry on top. It continuously reconciles the per-project
endpoint records each \`spex serve\` publishes (validating each against the live backend's /api/instance
identity), keeps a durable known-project catalog, and proxies each project's API + SSE + terminal
socket under /p/<projectId>/* — the project is named in the path, so nothing is "current" and no
pairing flag exists.

Admin surface (hub-authorized: implicit from loopback until an admin password is set, then cookie
sessions): GET /projects (the validated list + gating state) · GET /projects/stream (SSE) ·
GET /projects/browse?path=… (read-only host folder picker) · POST /projects {root, initGit?, init?}
(explicit setup, then register) · GET|PUT /projects/<id>/config (raw portable
spexcode.json, revision-guarded) · POST /projects/<id>/init|doctor|serve
(run the real \`spex init\`/\`spex doctor\`, or start an offline project's backend, detached — a
backend never depends on this gateway staying up) · PUT|DELETE /projects/admin-password and
/projects/<id>/password (the gates). A gated project answers /p/<id>/login with the designed page.

Loopback-only by default; --host widens the bind — the admin surface stays locked to loopback until
an admin password exists, and ungated projects serve open.`,
    see: 'spex serve (each project\'s backend) · spex serve ui (explicit one-backend pairing)',
  },

  // ── the noun drawers ──────────────────────────────────────────────────────
  spec: {
    line: 'spec <verb>           the governance graph: search · owner · lint · ack',
    body: `Usage: spex spec search <query…> [--limit N=10] [--json]
       spex spec owner <path> [--actionable]
       spex spec lint
       spex spec ack <node-id>… --reason "<why the contract still holds>"

search — which spec node GOVERNS a topic, ranked by user-story relevance (which surfaces user-facing
behaviour a code-grep misses). Run it BEFORE touching code: the node's spec.md body is the current
contract. The corpus is English — query in English.

owner — the reverse edge: a file's GOVERNORS (code: — drives drift + eval freshness) and REFERENCERS (related:
— coverage only), with the verdict spelled out (uncovered / related-only / sanely governed /
over-owned → split the file). --actionable prints NOTHING unless action is needed (hook use).

lint — checks the whole spec↔code graph and exits non-zero on errors. Errors: integrity (a
code:/related: file does not exist; a dead/ambiguous/unverifiable \`path#symbol\` selector; a selector
whose language has no designated extractor or whose extractor can't run here; a duplicate entry, a
base path both bare and scoped, or a selector on a glob/directory) · anchor-drift (a
commit since the spec's version touched an ANCHORED unit's lines, unacked — the blocking tier of
drift; same-file selectors OR'd, one error naming the hit selectors) · one-govern (a node
governs >1 DISTINCT file) · living (a "## vN" changelog heading) · id-format (an
id char outside the whitelist — ascii [a-z0-9-] or a non-ascii unicode letter/number, CJK ok — or a
leaf id reused) · mention (a [[id]] naming no node). Warns: coverage · drift
(UNANCHORED drift — always advisory, never blocks; on a scoped file's MISS, \`lint.scopedCodeMiss:
"ignore"\` may silence it) · anchor (anchoring a type) · related-drift (a scoped related row warns
per selector HIT, misses silent) · owners (whole-file governors only; scoped don't count) ·
confusable-id (two leaf ids one edit apart). spec lint's errors BLOCK commits (the pre-commit shim; bypass SPEXCODE_SKIP_LINT=1);
contrast \`spex eval lint\`, which is pure advisory and never blocks anyone.

ack — stamp Spec-OK on HEAD (an empty stamp commit): the drift remedy when only MECHANICS changed
and the spec's contract still holds. --reason is required and recorded in the ack commit's body
(quieting an anchor hit is a strong claim — the why must be durable). If the intent DID change,
edit the spec instead — same commit as the code.`,
    see: 'spex guide spec (the file format + every lint rule) · spex graph (browse the whole tree)',
  },
  session: {
    line: 'session <verb>        the worktree state machine: new · ls · watch · wait · review · merge · send · …',
    body: `Manager verbs (dispatch, monitor, land):
  spex session new "<prompt>" [--prompt-file <path>|-] [--node <id>] [--launcher <name>]
      Launch a worker in its own node worktree. Give it ONLY its task — the dev-flow contract
      reaches it through the materialized system prompt. --node (or the prompt's first [[id]],
      same effect) binds the session to that node. --prompt-file <path>|- carries a long prompt
      without shell quoting (exclusive with the inline prompt). Then MONITOR it (wait/watch below).
  spex session ls [SEL…] [--status a,b] [--json]        one-shot table of living sessions
  spex session watch [SEL…] [--as NAME] [--idle] [--interval N=5]
      Streams lifecycle transitions until killed — it NEVER EXITS; the human's forever stream. An
      agent must background it or use wait; blocking a turn on watch freezes you.
  spex session wait <SEL> [--timeout S=1200] [--interval S=2] [--idle]
      EDGE-TRIGGERED sleep on one session — ALWAYS run it in the BACKGROUND; its exit is your wake-up.
      Prints the session's current status immediately (stderr), then exits 0 only when it OBSERVES
      the session TRANSITION from a non-actionable status into an actionable one, printing the
      observed path on stdout (e.g. working→review — read the LAST token as the status reached).
      USE IT to sleep until a dispatched worker next needs you — including a dispatched MERGE
      actually landing (review→working while the merge runs, then the edge back is your wake-up).
      It NEVER returns just because the session is actionable ALREADY — for "what is it right NOW"
      use \`session ls\` / \`session review\` instead. --timeout is the guaranteed exit (code 1,
      observed path on stderr). Background one wait per worker.
  spex session review <SEL> [--json]     the merge cockpit: ahead · uncommitted · proposal · gates ·
                                         merge-base diff — decide from this, don't hand-run git
  spex session merge <SEL>               gated merge, dispatched to the session's OWN agent; confirm
                                         HEAD advanced before closing — closing unmerged discards work

Control another session (all take SEL):
  spex session send <SEL> "<msg>"        deliver a message (fail-loud: a dead dispatch exits non-zero)
  spex session send <SEL> --keys "<keys>"
      LAST RESORT: raw nav-mode keystrokes to a TUI dialog ("Up Up Enter", C-/M-/S- combos). The raw
      key surface is UNSTABLE and can confirm dangerous dialogs — don't reach for it unless a plain
      \`session send\` text provably cannot land.
  spex session rename <SEL> "<name>"     set the display name ("" clears)
  spex session show <SEL> [--capture] [--json]
      The session record: status · node · branch · launcher · the full originating prompt.
      --capture prints the LIVE PANE as text instead (empty pane = exit 0; unknown session = exit 2).
  spex session resume <SEL> [--force]    relaunch ONLY if confirmed offline (--force for a wedged one)
  spex session stop <SEL>                soft stop: kill the agent, KEEP the worktree (resumable)
  spex session close <SEL>               retire the session and its worktree

Worker verbs (declare YOUR OWN state — a claim the graph and your supervisor act on):
  spex session done --propose merge|nothing|close [--note T]   committed and stopping
  spex session park --note <what-you-await>                    a real background task will wake you
  spex session ask  --note <your-question>                     stopped on the human; resumes on reply

Human escape hatch:
  spex session attach <SEL>              sit in the worker's REAL tmux (detach: C-b d). INTERACTIVE
                                         AND BLOCKING — an agent must NEVER run it in a turn: use
                                         show --capture / send. LOCAL-only (fails loud on a remote backend).

${SEL_NOTE}
Manager verbs that WRITE (send/rename/resume/stop/close/merge) are PROJECT-BOUND: a backend serving
another project's repo refuses loudly — name the target with --api <url> to drive it on purpose.
${MENTION_NOTE}`,
    see: 'spex eval ls --session <SEL> (the session’s measured loss) · spex help eval',
  },
  eval: {
    line: 'eval <verb>           the measurement system: add · ls · scenario ls · matrix · lint · ok · retract · clean',
    body: `Usage: spex eval add [<node>|.] [--scenario <name>] (--pass|--fail) [--note <text>]
                    [--image <png> …repeatable] [--result <path|->] [--video <webm|mp4>] [--timeline <json>]
       spex eval ls [<node>|.] [--json]                a node's eval timeline, newest first
       spex eval ls --session <SEL> [--json]           a session's aggregate: its changed nodes' scores
       spex eval ls --session <SEL> --export [--open | --out <path>]
       spex eval scenario ls [<node>|.] [--unmeasured] [--json]   declared scenarios; bare = every node
       spex eval matrix <launcher> [--node <id>] [--rows k1,k2]   the harness live-behavior matrix
       spex eval lint [--changed]                      measurement-layer findings (advisory, always exit 0)
       spex eval ok <node> [--scenario <name>]         the HUMAN sign-off on the scenario's latest measurement
       spex eval retract [<node>|.] [--scenario <name>] [--last | --ts <iso>] [--note <why>]
       spex eval clean [--keep-latest | --all]         GC the content-addressed evidence cache

add — file an eval of a scenario against its expected: the loss signal the optimizer reads.
Measure through the REAL product surface, never by reasoning about the code. Evidence kind follows
the behaviour: MOVING/timed behaviour records a --video; a STATIC end state screenshots --image;
backend/CLI files a --result transcript. A fix's evidence is a fail→pass pair on the SAME scenario.

ls — node-scoped bare (its per-scenario eval history); session-scoped with an EXPLICIT --session
(never type-sniffed): every node the session's diff touches, blind spots first, its OWN measurements
✦-marked ahead of the inherited baseline. --export writes that evaluation as ONE self-contained
HTML artifact (diff · evidence inlined · gates) for CI/sharing.

scenario ls — the DECLARED contracts (name · tags · normalized test reference · latest verdict), no evals: bare lists every
measurable node's scenarios; --unmeasured keeps only the never-measured — the blind-spot worklist.

matrix — run the eight-row harness live-behavior matrix against a REAL dispatched session of the named
launcher (the harness-adapter acceptance rule, defined once in spec-eval/src/matrix.ts): it syncs the
rows into the \`<harness>-harness\` node's eval.md scenarios, drives one worker through undeclared-stop ·
pretooluse-block · ask-note · deliver-steer · resume · liveness · commit-gate · close-residue, and files
a per-row measurement with its evidence transcript. A new harness needs only its launcher + spec node.

lint — the measurement layer's findings: malformed eval.md (eval-schema) · unmeasured (eval-missing) ·
stale (eval-drift) · orphaned remark tracks (eval-dangling) · governed source with no eval.md
(eval-coverage — the same name and shape as spec lint's coverage, one rule per layer) · over-owned
files (eval-owners). --changed scopes to the nodes THIS branch touched. spec lint's errors block
commits; eval lint is PURE ADVISORY, always exit 0 — a measurement gap never blocks anyone.

ok — the human's reviewed-and-agreed mark on the scenario's LATEST measurement: an appended, monotonic
sign-off bound to that one immutable measurement (a newer measurement or staleness releases it on its own —
no un-ok exists). The evals feed default-hides a fresh, ok'd scenario; a governed session is refused
(an agent's judgment on a measurement is a remark, never a self-blessing).

retract — the sanctioned undo for a botched filing: APPENDS a retraction event (traceable, never
deletes a line); the previous eval becomes latest again, or the scenario honestly returns to
unmeasured.

${DOT_NOTE}`,
    see: 'spex guide eval (the eval.md scenario format + evidence rules) · spex evidence (bare byte transport)',
  },
  issue: {
    line: 'issue <verb>          concern threads, local + forge merged: ls · show · open · reply · close · promote · links',
    body: `Usage: spex issue ls [--node <id>] [--store local|<host>] [--all] [--json]
       spex issue show <id> [--json]
       spex issue open "<concern>" [--store local|<host>] [--node <id>…] [--evidence <hash>…] [--body -|<text>]
       spex issue reply <id> --body -|<text> [--evidence <hash>…]
       spex issue close <id>
       spex issue promote <id>
       spex issue links [--pending] [--store <host>] [--node <id>] [--json]

ls is the drain view a supervisor reads: ONE store-tagged list, local + forge interleaved by
creation time. \`show <id>\` is the single-thread detail — the whole thread with its replies (a local
id, or a forge id like github#12). \`open\` welcomes taste, annotations, and off-mainline smells —
not only bugs; --store <host> opens straight on the forge. \`reply\` and \`close\` route by the
issue's store — one verb, local or forge. \`promote\` moves an OPEN local issue to the forge as one
recorded action. \`links\` is the read-only forge trace: which open forge issues/PRs serve which
spec node (--pending narrows to threads still awaiting an eval). The issues workflow's
on/off switch is the \`issues.enabled\` key in spexcode.json (no CLI toggle verb — edit the JSON;
\`spex doctor\` reports its state).
${MENTION_NOTE}`,
    see: 'spex remark (pin a resolvable concern to an issue or scenario) · spex evidence put (stash evidence bytes)',
  },
  remark: {
    line: 'remark <verb>         resolvable pins on a host: add · resolve · retract',
    body: `Usage: spex remark add <issue-id | <node> --scenario <name>> --body -|<text> [--code-sha <sha>] [--evidence <hash>…]
       spex remark resolve <ref>          (the <thread-id>#<rid> that \`spex remark add\` printed)
       spex remark retract <ref>

The resolvable interaction primitive: \`add\` pins a concern to a HOST — a local issue, or a scenario
(\`--scenario\` present ⇒ the positional is a node; otherwise it is an issue id — the flag decides,
never type-sniffing). A SECOND agent \`resolve\`s it (never the author); the AUTHOR \`retract\`s their
own. The whole loop is CLI-first; the dashboard adds no capability.`,
    see: 'spex issue (the thread hosts) · spex eval ls (scenario hosts)',
  },
  evidence: {
    line: 'evidence put|get      content-addressed bytes: put stashes & prints the hash, get reads back',
    body: `Usage: spex evidence put <file|->
       spex evidence get <hash> [-o <file>]

put writes bytes into the shared content-addressed evidence cache and prints the hash — transport
only, no eval filed. Use the hash with --evidence on issues/remarks; re-putting the same content
restores pruned or cloned-away evidence.

get is the symmetric read: hash in, bytes out. Local cache first (no backend needed — the evidence
is usually on this disk), then the backend on a local miss; both missing fails loud naming each
path. Bytes go to stdout by default (pipe-friendly); -o writes a file.`,
    see: 'spex eval add (file an eval WITH evidence) · spex issue open --evidence <hash>',
  },

  // ── help & guide ──────────────────────────────────────────────────────────
  guide: {
    line: 'guide [topic]         the manuals: setup workflow · spec/eval file formats · spexcode.json · footprint',
    body: `Usage: spex guide            the human setup workflow (install once, adopt a repo, serve)
       spex guide spec       the spec.md file format + every lint rule
       spex guide eval       the eval.md scenario format + how loss is measured and filed
       spex guide settings   every spexcode.json / spexcode.local.json field, and which file it belongs in
       spex guide footprint  the footprint model: never-tracked artifacts, exclude + content filter, anchors

guide is the SKILL layer — workflows and formats. Command usage lives here in help
(\`spex help <cmd>\`); guide carries what the commands assume you know.`,
  },

  // ── plumbing ──────────────────────────────────────────────────────────────
  internal: {
    line: '',   // deliberately not on the map
    body: `Usage: spex internal <sub>

Machine plumbing — called by generated hooks and launch scripts, never typed by a human or agent:
  trunk             print the resolved source-of-truth branch (the pre-commit main-guard captures it)
  commit-surgery    pre-commit footprint anchor: unconditional materialize + staged-index repair
  refresh-footprint quiet materialize — the post-checkout/post-merge freshness anchor
  check-staged      pre-commit eval backstop: reject staged stray evidence files / malformed eval.md
  session-state <st> --session <id>   a lifecycle hook authors the session's state
  session-fail  --session <id>        the StopFailure hook marks the session errored
  session-idle  --session <id>        the idle-prompt hook marks an active session idle
  commit-gate       the Stop gate's deterministic commit check (exit 0 = ready to declare done)
  nudge <node>      the post-merge hook prints the issue nudge for a merged node
  codex-launch <sock> <cwd> [prompt…]   backend-owned codex thread/start + first turn (launch script)
  codex-turn   <sock> <threadId> <text…>  fire a follow-up turn on an owned thread (tests/scripts)

If you reached for one of these by hand, the porcelain you want is probably elsewhere: the trunk
name also lives at GET /api/settings (.layout); sessions are driven with spex session new / session send;
your own state is declared with spex session done|park|ask.`,
    see: 'spex help (the porcelain map)',
  },
  help: {
    line: '',
    body: `Usage: spex help              the command map
       spex help <command>    one command/drawer's usage (same as spex <command> --help)
       spex guide [topic]     the skill layer: workflows, file formats, best practice`,
  },
}

// `spex <cmd> --help` must meet the user wherever they typed it: cli.ts intercepts the probe pre-verb and
// asks for the FIRST token's entry, so `spex session send --help` answers with the session drawer's entry.
export function commandHelp(name: string): string | null {
  const e = ENTRIES[name]
  if (!e) return null
  const oneLiner = e.line.replace(/^\S+(\s+\S+)*?\s{2,}/, '')   // the map line minus its "cmd args" column
  const header = oneLiner ? `spex ${name} — ${oneLiner}\n\n` : ''  // unlisted entries (internal, help) lead with their own Usage
  return `${header}${e.body}${e.see ? `\n\nsee also: ${e.see}` : ''}\n\nmap: spex help · skills: spex guide`
}

export function overviewHelp(): string {
  return `spex — SpexCode CLI (spec↔code graph + worktree session state machine)

Usage: spex <noun> <verb> [object] [flags]     the verb is always the token after its noun;
                                               a bare noun prints that drawer's help
       spex help <command>                     one command's usage (or spex <command> --help — always
                                               safe: a help probe never runs the verb)

Project verbs (implicit object = this project)
  ${ENTRIES.graph.line}
  ${ENTRIES.init.line}
  ${ENTRIES.materialize.line}
  ${ENTRIES.doctor.line}
  ${ENTRIES.uninstall.line}
  ${ENTRIES.serve.line}
  ${ENTRIES.dashboard.line}

Noun drawers
  ${ENTRIES.spec.line}
  ${ENTRIES.session.line}
  ${ENTRIES.eval.line}
  ${ENTRIES.issue.line}
  ${ENTRIES.remark.line}
  ${ENTRIES.evidence.line}

Manuals
  ${ENTRIES.guide.line}

Conventions (stated once, hold everywhere)
  ${SEL_NOTE.split('\n').join('\n  ')}
  ${DOT_NOTE.split('\n').join('\n  ')}
  ${ROUTING_NOTE.split('\n').join('\n  ')}
  ${MENTION_NOTE.split('\n').join('\n  ')}

Concepts & best practice live in the guide: spex guide (setup) · guide spec · guide eval · guide settings · guide footprint.
Machine plumbing (hook/launch-script callees) lives under \`spex internal\` — not part of your vocabulary.`
}
