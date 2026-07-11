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
accepts any of the three; none (or @all) means every session.`

const ROUTING_NOTE = `Backend routing: every backend-touching verb accepts --api <url> (--port <n> = localhost sugar) to name
its backend explicitly — the flag always wins. Bare, it resolves: worker env / the cwd project's live
recorded backend / fallback / :8787 (spex guide config → BACKEND ROUTING).`

const DOT_NOTE = `\`.\` as a node argument means the node THIS worktree works on (the session's bound node, else the
node/<id> branch). Every read supports --json.`

const MENTION_NOTE = `Mentions: @session · [[node]] · @new work in ANY prompt, issue, or remark body — text passed as a CLI
arg included. [[node]] names the topic node; @session hands the text to that live agent; @new spawns a
fresh worker on the thread's node.`

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
  --json        the full payload (tree · overlay · sessions), identical to GET /api/board — machine
                food; with --focus/--depth it is that filtered subtree as nested objects instead`,
    see: 'spex spec search (find one node by intent) · spex session ls (just the sessions, as a table)',
  },
  init: {
    line: 'init [dir]            adopt SpexCode on a repo: seed .spec + hooks + materialize  [--preset name]',
    body: `Usage: spex init [dir=cwd] [--preset default|careful]

Scaffolds adoption in one shot: seeds a starter .spec tree (project root + .config plugins), plants
spexcode.json, installs the git hooks, and materializes the harness artifacts (contract block +
shims). Additive — never overwrites your files. --preset picks the .config plugin tier (cumulative).
Footprint is fixed: materialized artifacts are never tracked — hidden via the per-clone .git/info/exclude, with
a tracked/mixed CLAUDE.md/AGENTS.md covered by the clean/smudge filter (see spex guide footprint).`,
    see: 'spex guide (the full setup workflow) · spex uninstall (the inverse) · spex spec lint (adoption TODO)',
  },
  materialize: {
    line: 'materialize           re-materialize the harness artifacts (contract block · shims) for cwd’s project',
    body: `Usage: spex materialize

Materializes the surface:system config nodes into the managed <!-- spexcode --> block of
CLAUDE.md/AGENTS.md plus the .claude/.codex shims, and prints the content hash. The materialize anchors on
git-native events only (init · this verb · session-worktree creation · the pre-commit/post-checkout/
post-merge hooks) — run it by hand after a toolchain update, or in the setup step of any clone that
has no spex-planted hooks yet (CI, a cloud agent): the artifacts are generated and excluded, so they
never arrive via git.`,
    see: 'spex doctor (verify the materialized artifacts actually reach an agent)',
  },
  doctor: {
    line: 'doctor                diagnose whether the workflow actually reaches this agent  [--contract|--conflicts]',
    body: `Usage: spex doctor                per-layer coverage report: preconditions · git-hook floor · contract ·
                                  hooks + handler existence · backend — for every harness materialize delivers to
       spex doctor --contract     print the composed surface:system text any agent here reads
       spex doctor --conflicts    detect double-delivery (loose artifacts beside the managed ones)

Run it when a worker seems to be missing its contract or hooks — it names the broken layer and the
repair, instead of you diffing materialized files by hand.`,
    see: 'spex materialize (re-materialize the artifacts doctor checks)',
  },
  uninstall: {
    line: 'uninstall [dir]       surgical inverse of init — removes generated artifacts, keeps your .spec  [--hooks]',
    body: `Usage: spex uninstall [dir=cwd] [--hooks]

Removes every SpexCode-GENERATED artifact (harness shims · contract blocks · trust entries ·
exclude/ignore blocks · global store · plugin bundle) and never your .spec/.config data or your own
prose. Git hooks are preserved unless --hooks.`,
    see: 'spex init (re-adopt later — your .spec survives)',
  },
  serve: {
    line: 'serve [api|ui]        api (default) = the backend :8787 · ui = the dashboard :5173 on top of it',
    body: `Usage: spex serve [api] [--port N=8787]
       spex serve [api] --public --password <pw> [--tls-cert F --tls-key F] [--http]
       spex serve ui [--port N=5173] [--api-port N=8787] [--host H=127.0.0.1]

\`serve\` (or \`serve api\`) runs the backend for the repo at cwd behind a zero-downtime supervisor
(hot-reloads on source change; the public port never gaps). On a successful bind it RECORDS its
endpoint in the per-project runtime tier — that's how a bare \`spex\` run from this project's tree
finds this backend (spex guide config → BACKEND ROUTING). --public exposes it on a public IP behind
a password + self-signed TLS (own cert via --tls-cert/--tls-key; --http drops TLS).

\`serve ui\` is a SEPARATE process: it serves the bundled dashboard on its own port and proxies /api +
the terminal socket to a running backend (--api-port pairs with the backend's --port, so many
projects coexist on one host). Loopback-only by default; --host 0.0.0.0 opens it to a LAN/tailnet —
still plain HTTP with no gate, so bind wide only on a network you trust.`,
    see: 'GET /health (backend liveness probe)',
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

owner — the reverse edge: a file's GOVERNORS (code: — drives drift/yatsu) and REFERENCERS (related:
— coverage only), with the verdict spelled out (uncovered / related-only / sanely governed /
over-owned → split the file). --actionable prints NOTHING unless action is needed (hook use).

lint — checks the whole spec↔code graph and exits non-zero on errors (or a blocked commit-local
drift gate): integrity (error) · living (error) · altitude (warn) · coverage (warn) · drift (warn) ·
owners (warn). spec lint's errors BLOCK commits (the pre-commit shim; bypass SPEXCODE_SKIP_LINT=1);
contrast \`spex eval lint\`, which is pure advisory and never blocks anyone.

ack — stamp Spec-OK on HEAD (an empty stamp commit): the drift remedy when only MECHANICS changed
and the spec's contract still holds. --reason is required but NOT stored. If the intent DID change,
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
  spex session wait <SEL> [--timeout S=1200] [--interval S=2]
      Block until the session is actionable, print the status, EXIT (guaranteed to terminate; the
      supervisor's per-worker monitor — background one wait per worker; the exit is your wake-up).
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

Worker verbs (declare YOUR OWN state — a claim the board and your supervisor act on):
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
    line: 'eval <verb>           the measurement system: add · ls · lint · retract · clean',
    body: `Usage: spex eval add [<node>|.] [--scenario <name>] (--pass|--fail) [--note <text>]
                    [--image <png> …repeatable] [--result <path|->] [--video <webm|mp4>] [--timeline <json>]
       spex eval ls [<node>|.] [--json]                a node's reading timeline, newest first
       spex eval ls --session <SEL> [--json]           a session's aggregate: its changed nodes' scores
       spex eval ls --session <SEL> --export [--open | --out <path> | --json]
       spex eval lint [--changed]                      measurement-layer gaps (advisory, always exit 0)
       spex eval retract [<node>|.] [--scenario <name>] [--last | --ts <iso>] [--note <why>]
       spex eval clean [--keep-latest | --all]         GC the content-addressed evidence cache

add — file a reading of a scenario against its expected: the loss signal the optimizer reads.
Measure through the REAL product surface, never by reasoning about the code. Evidence kind follows
the behaviour: MOVING/timed behaviour records a --video; a STATIC end state screenshots --image;
backend/CLI files a --result transcript. A fix's proof is a fail→pass pair on the SAME scenario.

ls — node-scoped bare (its per-scenario reading history); session-scoped with an EXPLICIT --session
(never type-sniffed): every node the session's diff touches, blind spots first, its OWN measurements
✦-marked ahead of the inherited baseline. --export writes that evaluation as ONE self-contained
HTML artifact (diff · evidence inlined · gates) for CI/sharing.

lint — the measurement layer's gaps: malformed yatsu.md (schema) · unmeasured (missing) · stale
(drift) · orphaned remark tracks (dangling) · source with no scenarios (uncovered) · over-owned
files (owners). --changed scopes to the nodes THIS branch touched. spec lint's errors block
commits; eval lint is PURE ADVISORY — a measurement gap never blocks anyone.

retract — the sanctioned undo for a botched filing: APPENDS a retraction event (traceable, never
deletes a line); the previous reading becomes latest again, or the scenario honestly returns to
unmeasured.

${DOT_NOTE}`,
    see: 'spex guide yatsu (the scenario file format + evidence rules) · spex evidence (bare byte transport)',
  },
  issue: {
    line: 'issue <verb>          concern threads, local + forge merged: ls · open · reply · close · promote · links',
    body: `Usage: spex issue ls [--node <id>] [--store local|<host>] [--all] [--json]
       spex issue open "<concern>" [--store local|<host>] [--node <id>…] [--evidence <hash>…] [--body -|<text>]
       spex issue reply <id> --body -|<text> [--evidence <hash>…]
       spex issue close <id>
       spex issue promote <id>
       spex issue links [--pending] [--store <host>] [--node <id>] [--json]
       spex issue on|off|status

ls is the drain view a supervisor reads: ONE store-tagged list, local + forge interleaved by
creation time. \`open\` welcomes taste, annotations, and off-mainline smells — not only bugs;
--store <host> opens straight on the forge. \`reply\` and \`close\` route by the issue's store — one
verb, local or forge. \`promote\` moves an OPEN local issue to the forge as one recorded action.
\`links\` is the read-only forge trace: which open forge issues/PRs serve which spec node (--pending
narrows to threads still awaiting an eval reading). \`on|off|status\` toggles the local-issue
workflow (spexcode.json issues.enabled).
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
only, no reading filed. Use the hash with --evidence on issues/remarks; re-putting the same content
restores a pruned or cloned-away blob.

get is the symmetric read: hash in, bytes out. Local cache first (no backend needed — the evidence
is usually on this disk), then the backend on a local miss; both missing fails loud naming each
path. Bytes go to stdout by default (pipe-friendly); -o writes a file.`,
    see: 'spex eval add (file a reading WITH evidence) · spex issue open --evidence <hash>',
  },

  // ── help & guide ──────────────────────────────────────────────────────────
  guide: {
    line: 'guide [topic]         the manuals: setup workflow · spec/yatsu file formats · spexcode.json · footprint',
    body: `Usage: spex guide            the human setup workflow (install once, adopt a repo, serve)
       spex guide spec       the spec.md file format + every lint rule
       spex guide yatsu      the scenario file format + how loss is measured and filed
       spex guide config     every spexcode.json / spexcode.local.json field, and which file it belongs in
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
  check-staged      pre-commit yatsu backstop: reject staged stray blobs / malformed yatsu.md
  session-state <st> --session <id>   a lifecycle hook authors the session's state
  session-fail  --session <id>        the StopFailure hook marks the session errored
  session-idle  --session <id>        the idle-prompt hook marks an active session idle
  commit-gate       the Stop gate's deterministic commit check (exit 0 = ready to declare done)
  nudge <node>      the post-merge hook prints the issue nudge for a merged node
  codex-launch <sock> <cwd> [prompt…]   backend-owned codex thread/start + first turn (launch script)
  codex-turn   <sock> <threadId> <text…>  fire a follow-up turn on an owned thread (tests/scripts)

If you reached for one of these by hand, the porcelain you want is probably elsewhere: the trunk
name also lives at GET /api/layout; sessions are driven with spex session new / session send;
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

Concepts & best practice live in the guide: spex guide (setup) · guide spec · guide yatsu · guide config.
Machine plumbing (hook/launch-script callees) lives under \`spex internal\` — not part of your vocabulary.`
}
