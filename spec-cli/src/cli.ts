export {} // make this a module so top-level await is allowed
// static import is fine here: mentions.ts is dependency-free at module level, and stripRefSigil is needed
// by several verbs (spec owner, graph, issue/eval node args) — a CLI reference arg tolerates an optional @/[[ ]]
// sigil ([[mentions]]).
import { stripRefSigil } from './mentions.js'

// @@@ noun-first dispatch ([[cli-surface]]) - `spex <noun> <verb> [object] [flags]`: the verb is always the
// second token after its noun, a bare noun prints its drawer's help, and a bare verb exists only where the
// object is invariably THIS PROJECT (graph · init · materialize · doctor · uninstall · serve). There is no
// verb mirror and no promoted spelling — one verb, one spelling. Every REMOVED spelling lives in the
// signpost tables below: it REPORTS the new spelling and exits non-zero, never executes (a signpost is not
// an alias; the tables die in 0.4.0).
const cmd = process.argv[2]

// Registered before any await so a fatal top-level error lands here. Errors we OWN — BackendError, the
// loud malformed-config ConfigError, the --api/--port UsageError, the write-guard GuardError — are
// matched BY NAME (to avoid importing them) and rendered as a one-line `spex: <message>` (a user's
// config typo or a refused cross-project write must read as their situation, not a SpexCode stack dump);
// anything else prints in full so a real bug keeps its trace. A synchronous throw inside an awaited call
// (loadConfig on a malformed spexcode.json) surfaces as uncaughtException, not unhandledRejection, so BOTH
// paths route through the same printer.
function fatal(e: unknown): never {
  if (e instanceof Error && ['BackendError', 'ConfigError', 'UsageError', 'GuardError'].includes(e.name)) console.error(`spex: ${e.message}`)
  else console.error(e)
  process.exit(1)
}
process.on('unhandledRejection', fatal)
process.on('uncaughtException', fatal)

// tiny flag reader: --key value  (and bare positionals)
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// Exit AFTER stdout has flushed. process.exit() force-quits without draining buffered pipe writes, so a
// large piped dump (`spex issue ls --json | …`, graph --json, review --json) is silently cut off at the
// pipe buffer (~64KB). The empty write's callback fires once every prior queued chunk has drained; the
// returned promise never resolves (process.exit ends the process inside the callback), so
// `await flushExit(code)` halts execution here exactly like process.exit did — safe to drop in on any
// unbounded-output verb. EPIPE (a reader that closed early — `| head`, `| jq` exiting) can never drain, so
// we ALSO exit on the stream error rather than hang: the truncation is the reader's choice then, not ours.
function flushExit(code = 0): Promise<never> {
  return new Promise<never>(() => {
    const done = () => process.exit(code)
    process.stdout.on('error', done)
    process.stdout.write('', done)
  })
}
const has = (name: string) => process.argv.includes(`--${name}`)
// bare positionals after argv index `from`, skipping flags and their values (selectors for ls/watch).
const VALUE_FLAGS = new Set(['--status', '--as', '--interval', '--propose', '--note', '--node', '--prompt', '--prompt-file', '--timeout', '--reason', '--out', '--password', '--tls-cert', '--tls-key', '--harness', '--launcher', '--harness-session', '--port', '--api', '--api-port', '--host', '--preset', '--limit', '--session', '--depth', '--focus', '--keys'])
function positionals(from: number): string[] {
  const out: string[] = []
  for (let i = from; i < process.argv.length; i++) {
    const t = process.argv[i]
    if (t.startsWith('--')) { if (VALUE_FLAGS.has(t)) i++; continue }
    out.push(t)
  }
  return out
}

function rejectUnknownFlags(command: string, from: number, allowed: readonly string[]): void {
  const known = new Set(allowed.map((name) => `--${name}`))
  for (let i = from; i < process.argv.length; i++) {
    const token = process.argv[i]
    if (!token.startsWith('--')) continue
    if (!known.has(token)) {
      console.error(`${command}: unknown flag ${token}`)
      process.exit(2)
    }
    if (VALUE_FLAGS.has(token)) i++
  }
}

// @@@ signposts (one version only — delete in 0.4.0) - every spelling v0.3.0 removed maps to its new home.
// A signpost REPORTS and exits 2; it never executes (not an alias): a stale hook or a human's muscle memory
// gets a readable failure that names the migration, and nothing old keeps silently working.
const SIGNPOSTS: Record<string, string> = {
  search: 'spex spec search <query>',
  owner: 'spex spec owner <path>',
  lint: 'spex spec lint',
  ack: 'spex spec ack <node>… --reason "<why>"',
  tree: 'spex graph',
  board: 'spex graph --json',
  blob: 'spex evidence put|get',
  issues: 'spex issue — ls (was: bare issues) · show · open · reply · close · promote; on|off|status → the `issues.enabled` key in spexcode.json; `issues nudge` → spex internal nudge',
  forge: 'spex issue links [--pending] [--store <host>]  (--host is now --store)',
  new: 'spex session new',
  ls: 'spex session ls',
  watch: 'spex session watch',
  wait: 'spex session wait',
  review: 'spex session review',
  merge: 'spex session merge',
  send: 'spex session send',
  reopen: 'spex session resume',
  done: 'spex session done',
  park: 'spex session park',
  ask: 'spex session ask',
  exit: 'spex session stop',
  close: 'spex session close',
  capture: 'spex session show <SEL> --capture',
  attach: 'spex session attach',
  rename: 'spex session rename',
  prompt: 'spex session show <SEL>',
  rawkey: 'spex session send <SEL> --keys "<keys>"',
  resolve: 'spex remark resolve <ref>',
  retract: 'spex remark retract <ref>',
}
// the session drawer's removed sub-spellings: rawkey folded into send; capture/prompt folded into show;
// exit/reopen respelled stop/resume; the hook-only verbs moved to internal.
const SESSION_SIGNPOSTS: Record<string, string> = {
  rawkey: 'spex session send <SEL> --keys "<keys>"',
  exit: 'spex session stop <SEL>',
  reopen: 'spex session resume <SEL> [--force]',
  capture: 'spex session show <SEL> --capture',
  prompt: 'spex session show <SEL>',
  state: 'spex internal session-state',
  fail: 'spex internal session-fail',
  idle: 'spex internal session-idle',
  'commit-gate': 'spex internal commit-gate',
}
function signpost(oldSpelling: string, newSpelling: string): never {
  console.error(`spex: \`${oldSpelling}\` was removed in v0.3.0 — use: ${newSpelling}  (map: spex help)`)
  process.exit(2)
}
if (cmd !== undefined && SIGNPOSTS[cmd]) signpost(`spex ${cmd}`, SIGNPOSTS[cmd])

// After a successful launch, nudge the caller to actually MONITOR the session — launch-then-forget is a real
// gap (a supervisor or human launches and then never watches, so a review/failure goes unnoticed). Goes to
// STDERR so the JSON on stdout (which callers parse) stays clean; keyed to whoever's calling — a supervising
// agent has an own-session id, a human at a terminal does not. The hint also names the COMM channel
// (`spex session send`) — field-tested gap: callers who couldn't find it reached for raw tmux keystrokes instead.
async function launchMonitorReminder(id: string): Promise<void> {
  const { ownSessionId } = await import('./sessions.js')
  const agent = ownSessionId()
  console.error(`\nspex: launched session ${id} — now MONITOR it, or its review/failure goes unnoticed:`)
  if (agent) {
    // a supervising agent: the per-worker monitor is a backgrounded `spex session wait`, which is edge-triggered.
    console.error(`  supervising agent → background \`spex session wait ${id}\` (edge-triggered: exits when it OBSERVES the session transition into an actionable status — also how you await a dispatched merge actually landing; its exit is your wake-up. Already actionable and you just want to read it? \`spex session ls\`)`)
    console.error(`  or watch the whole stream: \`spex session watch\``)
  } else {
    console.error(`  \`spex session watch\` — the live stream of actionable session transitions (or \`spex session wait ${id}\` to sleep until this one's next transition into actionable)`)
  }
  console.error(`  talk to it: \`spex session send ${id} "<msg>"\` — plain text; \`send --keys\` is a LAST RESORT (unstable raw TUI keys — only when a text send provably can't land)`)
}

const greeted = new Set<string>()
async function greetWatchTargets(watcher: string, selectors: string[]): Promise<void> {
  try {
    const real = selectors.filter((sel) => sel && sel !== '@all')
    if (!real.length) return
    const { resolveClientSession, clientSend } = await import('./client.js')
    const { sessionHeadline } = await import('./sessions.js')
    const meR = await resolveClientSession(watcher)
    // name the watcher by its board HEADLINE (same as the reply-channel footer), delimited as a session title.
    const me = 'ok' in meR ? sessionHeadline(meR.ok) : watcher
    const meWho = me && me !== watcher ? `session "${me}" (${watcher})` : `session ${watcher}`
    for (const sel of real) {
      const r = await resolveClientSession(sel)
      if (!('ok' in r)) continue   // none/ambiguous → don't guess a target to interrupt
      const target = r.ok.id
      if (target === watcher || greeted.has(target)) continue
      greeted.add(target)
      const text = `🔭 ${meWho} is now supervising you — they started \`spex session watch\` over this session. To reach them directly, run: spex session send ${watcher} "<your message>". (One-time heads-up; reply only if you need to.)`
      void clientSend(target, text)   // no sender id → the connection notice is not double-counted as comms
    }
  } catch { /* greeting is best-effort — it must never disturb the watch */ }
}

async function withWatchEdge<T>(selectors: string[], intervalMs: number, body: () => Promise<T>, greet = false): Promise<T> {
  const { ownSessionId, reportWatch, reportUnwatch } = await import('./sessions.js')
  const { randomUUID } = await import('node:crypto')
  const watcher = ownSessionId()
  if (!watcher) return body()   // not a launched session (no own id) → nothing to attribute an edge to
  const token = randomUUID()
  const ttlMs = intervalMs * 3   // tolerate two missed heartbeats before the edge is dropped
  void reportWatch(token, watcher, selectors, ttlMs)
  if (greet) void greetWatchTargets(watcher, selectors)   // one-shot connection handshake to specific targets
  const hb = setInterval(() => void reportWatch(token, watcher, selectors, ttlMs), intervalMs)
  const cleanup = () => { clearInterval(hb); void reportUnwatch(token) }
  process.once('SIGINT', () => { cleanup(); process.exit(0) })
  process.once('SIGTERM', () => { cleanup(); process.exit(0) })
  try { return await body() } finally { cleanup() }   // one-shot `wait` clears on return; stream `watch` clears on signal
}

async function resolveSelectorOrExit(selector: string): Promise<string> {
  if (!selector) { console.error('spex: missing session selector (id | id-prefix | node | branch | . for self)'); process.exit(2) }
  const { resolveClientSession } = await import('./client.js')
  const { sessionLabel } = await import('./sessions.js')
  const r = await resolveClientSession(selector)
  if ('ok' in r) return r.ok.id
  if ('none' in r) { console.error(`spex: no such session: ${selector}`); process.exit(2) }
  console.error(`spex: ambiguous selector "${selector}" matches ${r.ambiguous.length} sessions — be more specific:`)
  for (const s of r.ambiguous) console.error(`  ${s.id.slice(0, 8)}  ${sessionLabel(s)}`)
  process.exit(2)
}

// the [[session-eval]] EXPORT artifact behind `spex eval ls --session <SEL> --export`: fetch the
// backend-rendered self-contained HTML, write it (--out, else a tmp file) or open it (--open). Never returns.
async function evalExport(id: string): Promise<never> {
  const { clientEvalExport } = await import('./client.js')
  const r = await clientEvalExport(id)
  if (!r.ok) { console.error(`no export for ${id} (status ${r.status})`); process.exit(1) }
  const { writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const out = flag('out') ?? join(tmpdir(), `spexcode-eval-${id.slice(0, 8)}.html`)
  writeFileSync(out, r.body)
  if (has('open')) {
    const { spawn } = await import('node:child_process')
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    try { spawn(opener, [out], { detached: true, stdio: 'ignore' }).unref(); console.log(`opened ${out}`) }
    catch { console.log(`wrote ${out} — couldn't auto-open, open it in a browser`) }
  } else console.log(out)
  process.exit(0)
}

// appended to a done/ask/block declaration: the note is durable conversation history even though the
// CURRENT board projection correctly flips back to active on the next tool call.
const DECLARED = ' — recorded; the human sees it in the dashboard. This declaration remains in the session timeline; your next tool call flips only the current board state back to active (the mark-active hook, by design).'
// appended ONLY to a propose-close declaration: a worktree about to be discarded may still own ephemeral things the agent started to test this change; nudge (not gate) it to reclaim them before the worktree goes, keyed on whether the thing should outlive the task — never on who started it (a deliberately long-running service / a production build is started-by-you yet must be left alone). Project-agnostic on purpose.
const CLOSE_CLEANUP = '\n\nBefore this worktree closes, check whether you left anything running that you started to test this change — a background process, a dev or preview server, a bound port, a scratch session. If nothing depends on it anymore, shut it down, or it keeps running as an orphan. Leave anything meant to keep running: a service you deliberately stood up, a production build, anything other work relies on. What matters is whether it still needs to exist after this task, not whether you started it. If unsure, leave it. This is a reminder to check, not a required step.'

// @@@ session-state kit - the shared machinery behind the agent-authored state writers, used by BOTH the
// typeable worker declarations (`spex session done|park|ask`) and the hook-only writers under
// `spex internal session-*` — one diagnosis, one truncation-echo, either drawer.
async function stateKit() {
  const s = await import('./sessions.js')
  const l = await import('./layout.js')
  const { existsSync, writeFileSync } = await import('node:fs')
  // the agent-authored state writers resolve WHICH session by id: a `--session <id>` flag (the lifecycle
  // hooks pass it, parsed from the payload, since they no longer have a cwd `.session`) wins, else the
  // harness env var (ownSessionId — the agent's own `spex session …` carries the harness session id).
  const sess = flag('session')
  // @@@ no-record diagnosis ([[state]]) - the session store resolves from the CURRENT directory (runtimeRoot
  // ← the cwd's git common dir), so the classic declaration failure is a cd OUTSIDE the session's project —
  // and a bare "no session record" told the author none of that (field-reported). Name the actual cause and
  // route the fix; each branch is a distinct situation, distinguished by probing the same store the writer used.
  const noRecord = (): string => {
    // cwd probe FIRST: outside a git repo nothing below can resolve — not the store, and not even the env
    // id (ownSessionId's alias walk reads the store too) — so diagnose the cwd before touching either.
    let ids: string[] | null
    try { ids = l.listSessionIds() } catch { ids = null }
    if (ids === null) return `no session record — declarations resolve the session store from the CURRENT directory, and ${process.cwd()} is not inside a git repository. cd back into the session's worktree and re-declare.`
    const wid = sess || s.ownSessionId()   // safe now: the store just resolved, so the alias walk cannot throw
    if (!wid) return 'no session record — no session id to write: this shell carries no harness session env (SPEXCODE_SESSION_ID / CLAUDE_CODE_SESSION_ID) and no --session was given. Pass --session <id> (spex session ls lists ids).'
    if (ids.length === 0) return `no session record for ${wid.slice(0, 8)} — declarations resolve the session store from the CURRENT directory, and the project at ${process.cwd()} has no sessions at all: you are in a different project's checkout. cd back into the session's worktree and re-declare.`
    return `no session record for ${wid.slice(0, 8)} — this project's store (resolved from ${process.cwd()}) holds ${ids.length} session(s) but not this one: a wrong --session id, or you are declaring from a different project's checkout. cd back into the session's worktree and re-declare, or pass a valid --session <id> (spex session ls).`
  }
  // a state writer from a non-repo cwd throws git's not-a-repo before it can return false — map exactly
  // that throw to the no-record path (noRecord re-probes and names the cwd); anything else stays loud.
  const mark = (fn: () => boolean): boolean => {
    try { return fn() }
    catch (e) { if (/not a git repository/i.test(String((e as any)?.stderr ?? e))) return false; throw e }
  }
  // truncation transparency ([[state]]): the session table shows only the first NOTE_BOARD_LIMIT chars of a
  // note. When a declared note overflows that cap, the confirmation says so — length, what the board shows,
  // where the full text is readable — so the cut is visible to the author instead of silently eaten.
  // Taught ONCE per session: the first overflowing note prints the full notice and drops a sentinel beside
  // the record; later overflows stay silent (the rule was taught — a verbatim repeat on every park/ask is
  // noise, field-reported). A nudge riding the echo, never a gate: the declaration has already landed.
  const noteEcho = (note?: string): string => {
    if (!note || note.length <= s.NOTE_BOARD_LIMIT) return ''
    const wid = sess || s.ownSessionId()
    const rid = wid ? (l.readAliasedRawRecord(wid)?.session_id ?? wid) : null   // sentinel lives in the RECORD's dir, so an aliased codex id lands on the same file
    if (rid) {
      const sentinel = l.sessionArtifactPath(rid, 'note-echo-taught')
      try {
        if (existsSync(sentinel)) return ''
        writeFileSync(sentinel, `${new Date().toISOString()}\n`)   // only reached on a successful declaration (the echo rides the success branch)
      } catch { /* unreadable/unwritable store dir → fall through and teach again; never block the echo */ }
    }
    return `\nyour note is ${note.length} chars; the session table shows only the first ${s.NOTE_BOARD_LIMIT} — the full text IS recorded, and readable via spex session review ${(wid || '<your-session>').slice(0, 8)} / spex session ls --json. (said once — later long notes won't repeat this.)`
  }
  return { s, l, sess, noRecord, mark, noteEcho }
}

// a trailing --help/-h prints help and exits BEFORE any verb runs, so a help probe never fires a
// streaming/mutating command. It prints THAT command's usage when an entry exists (the second layer
// of the help journey — see help.ts): a drawer sub's probe (`spex session send --help`) answers with the
// drawer's entry. Unknown tokens fall back to the map. (Removed spellings never reach here — the signpost
// table above already exited.)
if (cmd && cmd !== 'help' && (has('help') || process.argv.includes('-h'))) {
  const { commandHelp, overviewHelp } = await import('./help.js')
  console.log(commandHelp(cmd) ?? overviewHelp())
  process.exit(0)
}

if (cmd === 'serve') {
  // `spex serve [api]` runs the backend; `spex serve ui` serves the dashboard on top of a running backend —
  // two processes, two verbs in one operator drawer.
  const target = positionals(3)[0]
  if (target === 'ui') {
    // the natural post-install UI: serve the bundled dashboard on its OWN port (loopback by default;
    // --host widens the bind for LAN/tailnet viewing), proxying /api + the terminal socket to a
    // separately-run `spex serve`. Replaces the dogfood-only `npm run web` (vite).
    const { serveDashboardLocal } = await import('./gateway.js')
    const port = Number(flag('port') ?? process.env.SPEXCODE_DASHBOARD_PORT ?? 5173)
    const apiPort = Number(flag('api-port') ?? process.env.PORT ?? 8787)
    const host = flag('host') ?? '127.0.0.1'
    if (!Number.isInteger(port) || !Number.isInteger(apiPort)) { console.error('spex serve ui: --port and --api-port must be integers'); process.exit(2) }
    serveDashboardLocal({ port, apiPort, host })
  } else if (target === undefined || target === 'api') {
    // fail loud, not cryptic ([[platform-support]]): serve IS the entry to the session runtime, which needs a
    // POSIX host (tmux/bash/unix-sockets). On a non-POSIX host (native Windows) point at WSL2 and exit here,
    // before importing the supervisor spawns tsx into a downstream ENOENT.
    const { assertSessionRuntime } = await import('./runtime-guard.js')
    assertSessionRuntime()
    // the supervisor owns the public port and runs index.ts as a child for zero-downtime reloads; it
    // (not `tsx watch`) is what watches spec-cli/src, so the package `serve` script must NOT use --watch.
    // --port is sugar over the PORT env supervise.ts reads — set BEFORE importing so it takes effect. This
    // mirrors `spex serve ui --api-port`, so one host runs many projects (each `serve --port N` paired with
    // a `serve ui --api-port N`), cwd picking which project's .spec is served — no shared default collides.
    const portArg = flag('port')
    if (portArg !== undefined) {
      if (!Number.isInteger(Number(portArg))) { console.error('spex serve: --port must be an integer'); process.exit(2) }
      process.env.PORT = portArg
    }
    await import('./supervise.js')
  } else {
    console.error(`spex serve: unknown target '${target}' — spex serve [api] (the backend) | spex serve ui (the dashboard)`)
    process.exit(2)
  }
} else if (cmd === 'dashboard') {
  // the HOST-level dashboard ([[host-gateway]]): ONE gateway for every project this user serves. The
  // engine is [[gateway-hub]] (routing + [[gateway-auth]] authorization: admin scope implicit from
  // loopback until an admin password is set; per-project gates as configured); the host layer mounts the
  // instance-validated project registry, its SSE stream, the durable catalog, and the /projects
  // operations (register · init · doctor · start a backend) as the hub's admin extension. No --api-port
  // pairing: which backend a request reaches is named in its /p/:projectId path, resolved per request.
  // `spex serve ui` remains the explicit one-backend pairing; this verb is the zero-config many-project face.
  const { startHostDashboard } = await import('./host.js')
  const port = Number(flag('port') ?? process.env.SPEXCODE_DASHBOARD_PORT ?? 5173)
  const host = flag('host') ?? '127.0.0.1'
  if (!Number.isInteger(port)) { console.error('spex dashboard: --port must be an integer'); process.exit(2) }
  startHostDashboard({ port, host })
} else if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  // `spex help <cmd>` drills into one command; bare help is the map. Both name the next layer down.
  const { commandHelp, overviewHelp } = await import('./help.js')
  const topic = positionals(3)[0]
  if (cmd === 'help' && topic) {
    if (SIGNPOSTS[topic]) signpost(`spex ${topic}`, SIGNPOSTS[topic])
    const h = commandHelp(topic)
    if (!h) { console.error(`spex help: no command '${topic}' — run \`spex help\` for the map`); process.exit(2) }
    console.log(h)
  } else console.log(overviewHelp())
} else if (cmd === 'guide') {
  const { guideText } = await import('./guide.js')
  if (process.argv[3] === 'config') signpost('spex guide config', 'spex guide settings')
  const text = guideText(process.argv[3])
  if (text === null) {
    console.error(`spex guide: no topic '${process.argv[3]}'. Topics: spec, eval, settings, footprint. Run \`spex guide\` (no topic) for the setup workflow, \`spex help\` for the command map.`)
    process.exit(2)
  }
  console.log(text)
} else if (cmd === 'graph') {
  // @@@ graph - the ONE assembled view (tree + worktree overlay + sessions), both faces of it: bare (with
  // --focus/--depth) renders the human-readable status-coloured tree; --json dumps the full payload —
  // identical to GET /api/graph, machine food. Colour degrades cleanly: off unless stdout is a tty, and
  // NO_COLOR always wins.
  if (flag('node') !== undefined) { console.error('spex graph: --node was renamed — use --focus <id>'); process.exit(2) }
  const { buildBoard } = await import('./graph.js')
  const focusRaw = flag('focus')
  const depthRaw = flag('depth')
  const depth = depthRaw === undefined ? undefined : Number(depthRaw)
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0)) { console.error('spex graph: --depth must be a non-negative integer'); process.exit(2) }
  const board = await buildBoard()
  if (has('json') && focusRaw === undefined && depth === undefined) {
    // interactive-only stderr hint: the JSON dump is machine food; a human at a tty gets pointed at
    // the readable twin. Piped/redirected stdout stays byte-identical (the hint never touches stdout).
    if (process.stdout.isTTY) console.error('(human-readable: spex graph)')
    console.log(JSON.stringify(board, null, 2))
    await flushExit(0)
  }
  const { renderTree, treeJson } = await import('./tree.js')
  const opts = { node: focusRaw && stripRefSigil(focusRaw), depth, color: process.stdout.isTTY && !process.env.NO_COLOR }
  try {
    // --json on a FOCUSED/pruned view is that view's JSON (the filtered subtree, badge counts precomputed);
    // --json bare is the full payload above — the filter chooses which representation you asked for.
    console.log(has('json') ? JSON.stringify(treeJson(board.nodes, opts), null, 2) : renderTree(board.nodes, opts))
  } catch (e: any) {
    console.error(`spex graph: ${e?.message ?? e}`)
    process.exit(2)
  }
  await flushExit(0)
} else if (cmd === 'spec') {
  // @@@ spec drawer - the governance graph's own verbs: search (topic → node), owner (file → node, the
  // reverse edge), lint (the spec↔code graph check — errors gate commits), ack (the drift stamp).
  const sub = process.argv[3]
  if (sub === undefined) {
    console.log((await import('./help.js')).commandHelp('spec'))
  } else if (sub === 'search') {
    const { searchSpecs, nearestTitles } = await import('./search.js')
    const query = positionals(4).join(' ')
    if (!query.trim()) { console.error('usage: spex spec search <query> [--json] [--limit N]'); process.exit(2) }
    const limit = Number(flag('limit')) || 10
    const results = await searchSpecs(query, { limit, onStats: (s) => console.error(`[spec-search] compute ${s.ms.toFixed(1)}ms · ${s.nodes} nodes · ${s.tokens} tokens (excludes process start)`) })
    // zero-result fail-loud + route-to-next-step: always the corpus-is-English fact (unconditional — no
    // language sniffing, no score threshold), plus the nearest titles when anything is even near (typo
    // recovery) and the browse-all pointer, so no query dead-ends.
    const NO_MATCH = (q: string) => {
      const near = nearestTitles(q, 3)
      return [
        `no spec node matches "${q}" (the corpus is English — if your query isn't, translate and retry)`,
        ...(near.length ? ['nearest titles:', ...near.map((t) => `  ${t.title}  [${t.id}]`)] : []),
        'browse all: spex graph',
      ].join('\n')
    }
    if (has('json')) {
      if (!results.length) console.error(NO_MATCH(query))   // stderr: the stdout JSON contract stays verbatim
      console.log(JSON.stringify(results)); await flushExit(0)
    }
    if (!results.length) { console.log(NO_MATCH(query)); process.exit(0) }
    results.forEach((r, i) => {
      console.log(`${String(i + 1).padStart(2)}. ${r.title}  [${r.id}]  ·  score ${r.score}`)
      console.log(`    ${r.path}`)
      if (r.snippet) console.log(`    ${r.snippet}`)
    })
    process.exit(0)
  } else if (sub === 'owner') {
    // BOTH [[governed-related]] relations, distinctly: governors (code: — the verdict) and referencers
    // (related: — pointers; coverage only, never drift, never eval freshness).
    const { specOwners, specRelated } = await import('./specs.js')
    const { loadConfig } = await import('./lint.js')
    const p0 = positionals(4)[0]
    if (!p0) { console.error('usage: spex spec owner <path> [--actionable]'); process.exit(2) }
    const p = stripRefSigil(p0)
    const rel = p.startsWith(process.cwd()) ? p.slice(process.cwd().length + 1) : p
    const owners = specOwners(p)
    const related = specRelated(p)
    const maxOwners = loadConfig(process.cwd()).maxOwners
    // a selector-SCOPED governor (every claiming code: entry carries `#symbol` — [[code-anchor]]) still
    // DISPLAYS, marked, but does not count toward the too-many-owners bound: it claims named units, not
    // the whole file.
    const whole = owners.filter((o) => !o.scoped)
    const names = (xs: { id: string; scoped?: boolean }[]) => xs.map((o) => `'${o.id}'${o.scoped ? ' (scoped)' : ''}`).join(', ')
    const relLine = related.length ? `\n  also referenced by ${names(related)} (related: coverage only — no drift, no eval freshness)` : ''
    if (owners.length === 0 && related.length === 0) {
      console.log(`${rel} — no spec claims this yet (uncovered). If your change is substantive, give it a home before it drifts.`)
    } else if (owners.length === 0) {
      // related-only: lint's coverage is satisfied, so the per-edit hook stays silent (lint-consistent) —
      // but a human asking gets the honest nuance: nothing tracks this file's drift.
      if (has('actionable')) process.exit(0)
      console.log(`${rel} — not governed (no code: claim), but referenced by ${names(related)} (related: coverage only). Nothing tracks its drift; if your change is substantive, consider giving it a governing home.`)
    } else if (whole.length <= maxOwners) {
      // a sanely-owned file is NOT actionable: --actionable callers (the per-edit spec-of-file hook) stay
      // silent here, so the annotation fires only on an OVER-owned or uncovered file — rare and worth acting on.
      if (has('actionable')) process.exit(0)
      const named = names(owners)
      const lead = owners.length === 1 ? `${rel} is governed by ${named} — ${owners[0].desc}` : `${rel} is governed by ${named} (shared, fine).`
      console.log(`${lead} Read/honor the spec; if your change shifts the intent, update the spec in the SAME commit.${relLine}`)
    } else {
      const ids = names(owners)
      console.log(`${rel} is governed whole-file by ${whole.length} specs (all claims: ${ids}) — more than one file should hold. This file does TOO MUCH: SPLIT it so each governor owns its own module (or merge the nodes if they're one concern, or give it a single foundation owner + relate the rest).${relLine}`)
    }
  } else if (sub === 'lint') {
    const { specLint, DRIFT_GUIDANCE } = await import('./lint.js')
    const findings = await specLint()
    const errors = findings.filter((f) => f.level === 'error')
    for (const f of findings) console.error(`  ${f.level === 'error' ? '✗' : '•'} ${f.rule}: ${f.msg}`)
    console.error(`spex spec lint: ${errors.length} error(s), ${findings.length - errors.length} warning(s)`)
    // drift teaches from the ONE `spex spec lint` (no flag). Unanchored drift stays advisory forever; the
    // blocking tier is anchor-drift ([[code-anchor]]) — an ERROR like any other, so the pre-commit shim
    // (and CI) gates on it with no separate staged-index machinery.
    if (findings.some((f) => f.rule === 'drift' || f.rule === 'anchor-drift')) console.error(`\n${DRIFT_GUIDANCE}`)
    process.exit(errors.length ? 1 : 0)
  } else if (sub === 'ack') {
    // An EMPTY stamp commit on top of HEAD, never an amend: driftFor (git.ts) quiets every drift commit
    // REACHABLE from an ack, so a child stamp covers exactly what amending HEAD would — and it works where
    // amend can't: on a trunk merge commit, re-authoring it after MERGE_HEAD is gone reads to main-guard as
    // a direct trunk commit. The guard passes the stamp through its tree-unchanged gate instead. `--only`
    // with no paths pins the commit to HEAD's tree even when the index is dirty — an ack must never sweep
    // staged files along. git de-dupes adjacent trailers, so re-acking is harmless.
    const { git } = await import('./git.js')
    const nodes = positionals(4)
    const reason = (flag('reason') ?? '').trim()
    if (!nodes.length || !reason) {
      console.error('usage: spex spec ack <node-id>… --reason "<why this change keeps each spec valid>"')
      console.error('  --reason is required (it forces you to check before acking) and is recorded in the ack commit\'s message body — an ack that quiets an anchor hit is a strong claim, so its why must be durable.')
      process.exit(2)
    }
    try {
      git(['commit', '--only', '--allow-empty', '-m', `ack: Spec-OK ${nodes.join(', ')}`, '-m', reason,
        ...nodes.flatMap((n) => ['--trailer', `Spec-OK: ${n}`])])
      console.log(`Spec-OK: ${nodes.join(', ')} → ${git(['rev-parse', '--short', 'HEAD']).trim()}  (empty stamp commit; reason recorded in the commit body)`)
    } catch (e: any) {
      console.error(`ack failed: ${e?.message ?? e}`); process.exit(1)
    }
  } else {
    console.error(`spex spec: unknown verb '${sub}' — search | owner | lint | ack  (spex help spec)`)
    process.exit(2)
  }
} else if (cmd === 'init') {
  // scaffold a repo to adopt SpexCode: copy the shipped DATA templates (seed spec tree + git hooks)
  // into <targetDir> (default cwd). spex init [targetDir] --harness <ids> [--preset <tier>]
  const { specInit } = await import('./init.js')
  await specInit(positionals(3)[0], flag('preset'), flag('harness'))
} else if (cmd === 'uninstall') {
  // the surgical inverse of init: remove every SpexCode-generated artifact (harness shims/contract/trust, the
  // .gitignore block, the global store, any plugin bundle) — NEVER the user's .spec/.plugins data or their own
  // prose. Git hooks preserved unless --hooks. spex uninstall [targetDir] [--hooks]
  const { uninstall } = await import('./uninstall.js')
  uninstall(positionals(3)[0], { hooks: has('hooks') })
} else if (cmd === 'eval') {
  // @@@ eval drawer - the measurement system's verbs: add (file a reading) · ls (read a node's timeline, or
  // — with an explicit --session, never type-sniffed — a session's aggregate) · lint (the measurement-layer
  // lint, pure advisory) · retract · clean. Node-scoped verbs live in spec-eval; the session read lives
  // here (it talks to the backend).
  const sub = process.argv[3]
  if (sub === undefined) {
    console.log((await import('./help.js')).commandHelp('eval'))
  } else if (sub === 'ls' && flag('session') !== undefined) {
    // the session EVAL read ([[session-eval]]'s interactive face as a CLI verb): the dashboard Eval tab's
    // text twin. Renders the session's changed nodes with each DECLARED scenario at its CURRENT score
    // (latest reading per scenario, worktree-rooted) — blind spots lead, the session's OWN measurements
    // ✦-marked ahead of the inherited baseline under its divider. --export writes the self-contained HTML
    // artifact instead.
    const id = await resolveSelectorOrExit(flag('session')!)
    if (has('export')) await evalExport(id)
    const { clientEvals } = await import('./client.js')
    const r = await clientEvals(id)
    if (!r.ok) { console.error(`no evals for ${id} (status ${r.status})`); process.exit(1) }
    if (has('json')) { console.log(JSON.stringify(r.model, null, 2)); await flushExit(0) }
    const m = r.model
    const byNode = new Map<string, any[]>()
    for (const item of m.items) {
      const rows = byNode.get(item.node) ?? []
      rows.push(item)
      byNode.set(item.node, rows)
    }
    const groups = [...byNode].map(([node, rows]) => ({ node, rows }))
    const own = m.items.filter((item) => item.inSession).length
    console.log(`eval session  [${m.id}]`)
    console.log(`  gates  : ${m.gates.map((g) => `${g.ok ? '✓' : '✗'} ${g.label} — ${g.detail}`).join(' · ')}`)
    if (own) console.log(`  ✦      : ${own} scenario(s) measured by THIS session (unmarked rows = inherited baseline)`)
    if (!m.items.length) console.log('\n  no affected scenarios to evaluate yet')
    for (const { node, rows } of groups) {
      console.log(`\n${node}`)
      for (const item of rows.filter((row) => row.filterKind === 'blind')) console.log(`      ∅ unmeasured  ${item.scenario}  — declared, never measured (blind spot)`)
      let divided = false
      for (const e of rows.filter((row) => row.filterKind === 'result')) {
        if (!e.inSession && !divided && rows.some((x) => x.filterKind === 'result' && x.inSession)) { console.log(`      ── inherited baseline (other sessions' latest evals) ──`); divided = true }
        const verdict = e.verdict?.status === 'pass' ? '✓ pass' : e.verdict?.status === 'fail' ? '✗ fail' : '· unscored'
        const stale = e.fresh ? '' : ` (stale: ${(e.staleAxes || []).join(',')})`
        console.log(`    ${e.inSession ? '✦' : ' '} ${verdict}${stale}  ${e.scenario}  — ${e.ts}${e.evaluator ? ` · ${e.evaluator}` : ''}`)
      }
    }
  } else if (['add', 'ls', 'scenario', 'matrix', 'lint', 'ok', 'retract', 'clean'].includes(sub)) {
    // node-scoped verbs — thin route; the logic lives in spec-eval.
    const { runEval } = await import('../../spec-eval/src/cli.js')
    await flushExit(await runEval(process.argv.slice(3)))
  } else {
    console.error(`spex eval: unknown verb '${sub}' — add | ls | scenario ls | matrix | lint | ok | retract | clean  (spex help eval)`)
    if (!sub.startsWith('--')) console.error(`  (the old \`spex eval <SEL>\` session read is now \`spex eval ls --session <SEL>\` [--export])`) // dead-words-ok: signpost — one-version tombstone teaching the renamed spelling (0.4.0 removes it)
    process.exit(2)
  }
} else if (cmd === 'evidence') {
  // @@@ evidence drawer - the bare content-addressed transport pair ([[evidence-put]], [[evidence-get]]): put bytes
  // in the shared evidence cache / read them back by hash, decoupled from filing a reading. Thin route — the
  // cache lives in spec-eval. flushExit matters here: `get` pipes raw blob bytes to stdout.
  if (process.argv[3] === undefined) {
    console.log((await import('./help.js')).commandHelp('evidence'))
  } else {
    const { runEvidence } = await import('../../spec-eval/src/cli.js')
    await flushExit(await runEvidence(process.argv.slice(3)))
  }
} else if (cmd === 'issue') {
  // @@@ issue drawer - the ONE issue surface ([[issues]]): `ls` is THE read — local + forge issues as ONE
  // store-tagged list, the supervisor's/human's drain view; `show <id>` the single-thread detail (the same
  // read GET /api/issues/:id serves); open/reply/close are store-routed (the SAME
  // createIssue/replyIssue/closeIssue the dashboard's API calls); `promote` moves a thread cross-store;
  // `links` traces forge issues/PRs onto spec nodes (read-only, spec-forge).
  if (process.argv[3] === undefined) {
    console.log((await import('./help.js')).commandHelp('issue'))
  } else {
    const { runIssues } = await import('./issues.js')
    await flushExit(await runIssues(process.argv.slice(3)))
  }
} else if (cmd === 'remark') {
  // @@@ remark drawer - the resolvable interaction primitive ([[remark-substrate]]): `add` pins a concern to
  // a HOST (a local issue, or a scenario `<node> --scenario <name>`), a second agent `resolve`s it, the
  // author `retract`s it. CLI-first — the whole loop is these thin store-write wrappers, so the dashboard
  // adds no capability.
  const sub = process.argv[3]
  const m = sub === 'add' || sub === 'resolve' || sub === 'retract' ? await import('./localIssues.js') : null
  if (sub === undefined) {
    console.log((await import('./help.js')).commandHelp('remark'))
  } else if (sub === 'add') {
    await flushExit(await m!.runRemark(process.argv.slice(4)))
  } else if (sub === 'resolve') {
    await flushExit(await m!.runResolve(process.argv.slice(4)))
  } else if (sub === 'retract') {
    await flushExit(await m!.runRetract(process.argv.slice(4)))
  } else {
    console.error(`spex remark: unknown verb '${sub}' — add | resolve | retract  (spex help remark)`)
    if (!sub.startsWith('--')) console.error('  (the old bare `spex remark <host> --body …` write is now `spex remark add <host> --body …`)')
    process.exit(2)
  }
} else if (cmd === 'materialize') {
  // @@@ materialize - surface nodes → manifest + AGENTS.md/CLAUDE.md block + shims + Codex
  // trust, for cwd's project. Anchored on git-native events only ([[commit-surgery]]): this verb, init,
  // session-worktree creation, and the planted pre-commit/post-checkout/post-merge hooks.
  const { materialize } = await import('./materialize.js')
  try {
    console.log(`materialized — content-hash ${materialize().contentHash}`)
  } catch (e) {
    // a policy error (e.g. a missing/illegal `harnesses` set) is a user-facing verdict, not a crash — one
    // line + the repair it already carries, never a stack trace.
    console.error(`spex materialize: ${(e as Error).message}`)
    process.exit(1)
  }
} else if (cmd === 'doctor') {
  // @@@ doctor - the diagnosis surface ([[doctor]], né `self` — renamed: "self" read as the tool itself /
  // the global install, while the report is about THIS agent's wiring): does the materialized workflow
  // actually reach this agent? Bare `doctor` reports per-layer coverage (preconditions · git-hook floor ·
  // contract · hooks+handler-existence · backend) over the same HARNESSES materialize delivers through;
  // `--contract` prints the surface:system text; `--conflicts` just the double-delivery check. Thin route.
  const { runDoctor } = await import('./doctor.js')
  await flushExit(await runDoctor(process.argv.slice(3)))
} else if (cmd === 'session') {
  const sub = process.argv[3]
  if (sub === undefined) {
    console.log((await import('./help.js')).commandHelp('session'))
  } else if (SESSION_SIGNPOSTS[sub]) {
    signpost(`spex session ${sub}`, SESSION_SIGNPOSTS[sub])
  } else if (sub === 'new') {
    // spex session new "<prompt>"  (prompt = first positional or --prompt, or --prompt-file
    // <path>|- so a long multi-paragraph prompt never fights shell quoting — [[prompt-file]]).
    // createSession POSTs to the running backend so the launch runs in the backend's process (auth env + cap);
    // it falls back to an in-process launch only when no backend answers.
    if (has('node')) {
      console.error('spex session new: --node was removed — put a [[<id>]] mention in the prompt — the first mention binds')
      process.exit(2)
    }
    rejectUnknownFlags('spex session new', 4, ['prompt', 'prompt-file', 'launcher', 'api', 'port'])
    const { createSession } = await import('./sessions.js')
    const promptFile = flag('prompt-file')
    const inline = flag('prompt') ?? positionals(4)[0]
    let prompt = inline ?? ''
    if (promptFile !== undefined) {
      // fail-loud exclusive: never silently pick one of two prompt sources.
      if (inline !== undefined) { console.error('spex session new: give the prompt either inline or via --prompt-file, not both'); process.exit(2) }
      const { readFileSync } = await import('node:fs')
      try { prompt = promptFile === '-' ? readFileSync(0, 'utf8') : readFileSync(promptFile, 'utf8') }
      catch (e) { console.error(`spex session new: --prompt-file ${promptFile}: ${e instanceof Error ? e.message : e}`); process.exit(2) }
      if (!prompt.trim()) { console.error(`spex session new: --prompt-file ${promptFile === '-' ? 'stdin' : promptFile} is empty — refusing a promptless launch`); process.exit(2) }
    }
    const created = await createSession(prompt, flag('launcher') ?? undefined)
    console.log(JSON.stringify(created, null, 2))
    await launchMonitorReminder(created.id)
  } else if (sub === 'ls') {
    // pretty list of living sessions + states. `spex session ls [SEL...] [--status a,b] [--json]`
    // the board comes from the backend (so it shows the sessions of whatever SPEXCODE_API_URL points at,
    // incl. a remote machine); selectSessions/formatTable are pure presentation, applied client-side.
    const { selectSessions, formatTable } = await import('./sessions.js')
    const { clientListSessions } = await import('./client.js')
    const picked = selectSessions(await clientListSessions(), positionals(4), flag('status')?.split(','))
    console.log(has('json') ? JSON.stringify(picked, null, 2) : formatTable(picked))
  } else if (sub === 'watch') {
    const { watchSessions } = await import('./sessions.js')
    const { clientListSessions } = await import('./client.js')
    const selectors = positionals(4)
    const intervalMs = (Number(flag('interval')) || 5) * 1000
    await withWatchEdge(selectors, intervalMs, () => watchSessions((line) => console.log(line), {
      source: clientListSessions,   // poll the backend, so watch streams the (possibly remote) backend's board
      selectors,
      statuses: flag('status')?.split(','),
      includeIdle: has('idle'),
      as: flag('as'),
      intervalMs,
    }), true)   // greet=true: a stream watch greets its specific targets once; `wait` (one-shot) does not
  } else if (sub === 'wait') {
    const { watchSessions, ownSessionId } = await import('./sessions.js')
    const { clientListSessions } = await import('./client.js')
    const [id] = positionals(4)
    if (!id) { console.error('usage: spex session wait <id> [--timeout SECONDS] [--interval SECONDS] [--idle]'); process.exit(2) }
    // point-of-use turn-freeze warning ([[session-edges]]): a managed agent that runs this wait in the FOREGROUND
    // freezes its whole turn until the target produces an edge — a warning that used to live only in help
    // prose, now said where it matters. Foreground vs background is invisible from here, so the hint prints
    // for ANY managed-agent shell (harmless in a background transcript), on stderr, and changes nothing else.
    const own = ownSessionId()
    if (own) console.error(`spex session wait: heads-up (managed agent ${own.slice(0, 8)}) — this command BLOCKS until it OBSERVES ${id} transition from non-actionable into an actionable status (edge-triggered: an already-actionable current state does NOT return it — to just read the state now, use \`spex session ls\`/\`review\`); run it in the BACKGROUND or it freezes your whole turn (its exit is your wake-up). Proceeding.`)
    const intervalMs = (Number(flag('interval')) || 2) * 1000
    const timeoutSec = Number(flag('timeout')) || 1200
    const r = await withWatchEdge([id], intervalMs, () => watchSessions(() => {}, {
      source: clientListSessions,
      selectors: [id],
      includeIdle: has('idle'),
      intervalMs,
      until: {
        timeoutMs: timeoutSec * 1000,
        // the arrival state and each observed transition narrate on stderr AS THEY HAPPEN, so a backgrounded
        // wait's transcript is the state sequence itself; stdout stays the one machine verdict (the observed
        // path on an edge, or a transport token).
        onObserved: (st, was) => console.error(was
          ? `spex session wait: observed ${was} → ${st}`
          : `spex session wait: current status ${st} — recorded as the path start; returns on the next non-actionable→actionable transition`),
      },
    }))
    // the observed status path is the stdout verdict: read the LAST token as the status reached. Printing the
    // whole path (not just the final status) is the point — a manager sees what the wait lived through
    // (e.g. review→working→close-pending across a merge dispatch), not a bare word out of context.
    if ('reached' in r) { console.log(r.path.join('→')); process.exit(0) }
    if ('gone' in r) { console.error(`spex session wait: no such (living) session ${id}`); process.exit(2) }
    // a backend failure is a verdict about the TRANSPORT, never the session ([[session-edges]], issue #40): it prints
    // its own outcome token on stdout — a word OUTSIDE the session-status vocabulary, so a supervisor reading
    // the one status line can never mistake "I could not reach the board" for "the session is offline" — and
    // exits 3, distinct from the plain no-edge timeout (1) and the vanished target (2).
    if ('backendDown' in r) {
      console.error(`spex session wait: ${r.backendDown}`)
      console.log(r.kind === 'unreachable' ? 'backend-unreachable' : 'backend-error')
      process.exit(3)
    }
    console.error(`spex session wait: timeout — observed no non-actionable→actionable transition on ${id} within ${timeoutSec}s (status path: ${r.path.join('→') || 'never sighted'})`)
    process.exit(1)
  } else if (sub === 'review') {
    const first = positionals(4)[0]
    if (first === 'proof') signpost('spex review proof', 'spex eval ls --session <SEL> --export') // dead-words-ok: signpost — one-version tombstone teaching the renamed spelling (0.4.0 removes it)
    const { clientReview } = await import('./client.js')
    if (!first) { console.error('usage: spex session review <SEL>  (id | id-prefix | node | branch)'); process.exit(2) }
    const id = await resolveSelectorOrExit(first)
    const r = await clientReview(id)
    if (!r) { console.error(`no such session ${id}`); process.exit(1) }
    if (has('json')) { console.log(JSON.stringify(r, null, 2)) }
    else {
      const g = r.gates
      console.log(`review ${r.label}  [${r.id}]`)
      console.log(`  ahead of main : ${r.ahead} commit(s)`)
      console.log(`  uncommitted   : ${r.dirtyNonRuntime} non-runtime file(s)`)
      console.log(`  proposal      : ${r.proposal.kind ?? '—'}${r.proposal.note ? ` — ${r.proposal.note}` : ''}`)
      console.log('  gates:')
      console.log(`    conflicts w/ main : ${g.conflictsWithMain ? 'YES' : 'no'}`)
      console.log(`    lint              : ${g.lint.errorCount} error(s), ${g.lint.warningCount} warning(s)`)
      console.log(`  diff (merge-base, ${r.diff.length} file(s)):`)
      for (const f of r.diff) console.log(`    ${f.status.padEnd(12)} +${f.additions} -${f.deletions}  ${f.path}`)
    }
  } else if (sub === 'merge') {
    const { clientMerge } = await import('./client.js')
    const sel = positionals(4)[0]
    if (!sel) { console.error('usage: spex session merge <SEL>  (id | id-prefix | node | branch)'); process.exit(2) }
    const id = await resolveSelectorOrExit(sel)
    const r = await clientMerge(id)
    if (r.dispatched) console.log(`merge dispatched to ${id} — its agent is landing the merge`)
    else console.error(`merge dispatch failed: ${r.reason}`)
    process.exit(r.dispatched ? 0 : 1)
  } else {
    // `s` (sessions.ts) backs the state PRODUCERS that stay local (done/park/ask write the global record by
    // session_id) and the stateKit shared with `spex internal session-*`. `c` (client.ts) backs the
    // read/control subs that route through the backend. Lazily imported.
    const c = await import('./client.js')
    const id = process.argv[4]
    if (sub === 'resume') {
      // bring the agent back up (relaunch ONLY if confirmed offline, the backend owns it); demotes a working
      // `active` to idle but leaves a standing declaration/proposal untouched (see sessions.ts resumeSession()).
      // The RESUME GUARD refuses a relaunch on a LIVE/unproven agent (that would kill a live worker) — `--force`
      // overrides for a genuinely wedged process. A following prompt is what actually re-drives it.
      const full = await resolveSelectorOrExit(id)
      const r = await c.clientResume(full, process.argv.includes('--force'))
      if (r.ok) console.log(r.info ? `${full} -> ${r.info}` : `${full} -> resumed`)
      else { console.error(`spex session resume: ${r.error || `no such session ${full}`}`); process.exit(2) }
    } else if (sub === 'done') {
      // sugar for awaiting; --propose merge|nothing|close, optional --note
      const { s, sess, mark, noRecord, noteEcho } = await stateKit()
      const p = (flag('propose') as any) || 'nothing'
      let closeNote = p === 'close' ? CLOSE_CLEANUP : ''
      if (p === 'close') {
        // the DATA half of the close nudge ([[local-issues]] closeoutNudge): the still-open local issues this
        // session touched, listed by id — empty/OFF/no-identity prints nothing. Loud on failure but never
        // gating: the declaration must land whatever the issue store is doing.
        try { closeNote += (await import('./localIssues.js')).closeoutNudge(sess ?? s.ownSessionId()) }
        catch (e) { console.error(`issue closeout check failed (declaration unaffected): ${e instanceof Error ? e.message : e}`) }
      }
      console.log(mark(() => s.markDone(p, sess, flag('note'))) ? `done (${p})${DECLARED}${noteEcho(flag('note'))}${closeNote}` : noRecord())
    } else if (sub === 'park') {
      // sugar: the agent is waiting on a background task; it will self-resume (NOT idle/awaiting)
      const { s, sess, mark, noRecord, noteEcho } = await stateKit()
      console.log(mark(() => s.markState('parked', { note: flag('note'), sessionId: sess })) ? `parked${DECLARED}${noteEcho(flag('note'))}` : noRecord())
    } else if (sub === 'ask') {
      // the agent DELIBERATELY declares it is pausing to ask the human a question (like `done`/`park`, an
      // authored state — NOT guarded active-only). The --note carries the question. Distinct from `park`
      // (waiting on a background task, self-resumes): an asking agent resumes only when the human replies.
      const { s, sess, mark, noRecord, noteEcho } = await stateKit()
      console.log(mark(() => s.markState('asking', { note: flag('note'), sessionId: sess })) ? `asking${DECLARED}${noteEcho(flag('note'))}` : noRecord())
    } else if (sub === 'stop') {
      // the SOFT stop: kill the agent's tmux + socket but KEEP the worktree, so the session goes offline and
      // can be resumed (`session resume`). Distinct from `close`, which removes the worktree.
      const full = await resolveSelectorOrExit(id)
      console.log(await c.clientStop(full) ? `stopped ${full} (worktree kept — resumable)` : `no such session ${full}`)
    } else if (sub === 'interrupt') {
      const full = await resolveSelectorOrExit(id)
      const r = await c.clientInterrupt(full)
      console.log(r.ok ? `interrupted ${full}` : `interrupt failed: ${r.error}`)
      process.exit(r.ok ? 0 : 1)
    } else if (sub === 'close') {
      const full = await resolveSelectorOrExit(id)
      console.log(await c.clientClose(full) ? `closed ${full}` : `no such session ${full}`)
    } else if (sub === 'send') {
      const full = await resolveSelectorOrExit(id)
      if (has('keys')) {
        // the LAST-RESORT face of send: forward raw nav-mode keystrokes (tmux send-keys, NEVER the prompt
        // socket) — how a manager drives a worker wedged in an interactive TUI dialog the prompt channel
        // can't reach (a select menu wanting one Enter/arrow). UNSTABLE, and able to confirm dangerous
        // dialogs — try plain `session send` text FIRST; reach for --keys only when text provably can't
        // land. Tokens = named keys, single chars, C-/M-/S- combos; whitespace-separated, delivered as ONE
        // ordered batch ([[nav-mode-key-ordering]]). Fail-loud: nothing delivered exits non-zero.
        const keys = (flag('keys') ?? '').split(/\s+/).filter(Boolean)
        if (keys.length === 0) { console.error('usage: spex session send <SEL> --keys "<keys>"   (e.g. "Up Up Enter", "C-r", single chars — last resort; try a plain send first)'); process.exit(2) }
        if (await c.clientSendRawKeys(full, keys)) { console.log(`sent ${keys.length} key${keys.length === 1 ? '' : 's'} -> ${full}`); process.exit(0) }
        console.error(`spex session send --keys: nothing delivered to ${full} (offline, unknown session, or no valid key token)`)
        process.exit(1)
      }
      // prompt dispatch is socket-only + fail-loud (the backend enforces it): a non-accepted prompt prints the
      // reason AND exits non-zero, so a manager/script never mistakes a dead dispatch for success.
      // BIDIRECTIONAL: stamp the SENDER (this send process's OWN session — the only process that knows it, via
      // ownSessionId from CLAUDE_CODE_SESSION_ID) + a one-line reply hint into the delivered
      // message, so the recipient can reply over the SAME send. The sender's row (hence its display label) is
      // resolved through the shared resolver; a human in a plain shell has no session id → bare message, no
      // hint (see [[agent-reply-channel]]).
      const s = await import('./sessions.js')
      const senderId = s.ownSessionId()
      let sender = null
      if (senderId) {
        const sr = await c.resolveClientSession(senderId)
        // name the sender by the board HEADLINE (sessionHeadline — the live self-summary the recipient sees on
        // the board), NOT the stable sessionLabel that stops at the bare prompt-truncation title.
        sender = 'ok' in sr ? { id: sr.ok.id, label: s.sessionHeadline(sr.ok) } : { id: senderId, label: null }
      }
      const r = await c.clientSend(full, s.withSenderHint(process.argv[5] ?? '', sender), senderId ?? undefined)
      console.log(r.ok ? 'sent' : `dispatch failed: ${r.error}`)
      process.exit(r.ok ? 0 : 1)
    } else if (sub === 'show') {
      // the session RECORD as one per-id read (status · node · branch · launcher · the full originating
      // prompt); --capture swaps in the LIVE PANE face of the same read. The pane contract is unchanged from
      // the verb it absorbed — fail and empty stay DISTINCT: a real empty pane prints nothing and exits 0;
      // unknown id exits 2, offline / capture-error exit 1, each with a named reason.
      const full = await resolveSelectorOrExit(id)
      if (has('capture')) {
        const r = await c.clientCapture(full)
        if (r.ok) { process.stdout.write(r.pane) }
        else { console.error(`spex session show --capture: ${r.reason}`); process.exit(r.status === 404 ? 2 : 1) }
      } else {
        const r = await c.clientShow(full)
        if (!r.ok) { console.error(`spex session show: no such session ${full}`); process.exit(2) }
        if (has('json')) { console.log(JSON.stringify(r.session, null, 2)) }
        else {
          const x = r.session
          console.log(`${x.label}  [${x.id}]`)
          console.log(`  status   : ${x.status}  (lifecycle ${x.lifecycle} · liveness ${x.liveness})`)
          console.log(`  node     : ${x.node ?? '—'}`)
          console.log(`  branch   : ${x.branch ?? '—'}`)
          console.log(`  launcher : ${x.launcher ?? '—'}  (harness ${x.harness})`)
          console.log(`  worktree : ${x.path}`)
          console.log(`  created  : ${new Date(x.created).toISOString()}`)
          if (x.note) console.log(`  note     : ${x.note}`)
          if (x.proposal) console.log(`  proposal : ${x.proposal}`)
          console.log(x.prompt ? `  prompt   |\n${x.prompt.replace(/\n$/, '').split('\n').map((l) => `    ${l}`).join('\n')}` : '  prompt   : (none recorded)')
        }
      }
    } else if (sub === 'rename') {
      // set the session's display-name override — the right-click rename ([[session-rename]]) as a verb, so an
      // agent manager can fix a label without the GUI. An EXPLICIT "" clears back to the derived label; a
      // MISSING argument is a usage error, never a silent clear. Unknown session → the endpoint's 404, loud.
      const full = await resolveSelectorOrExit(id)
      const name = process.argv[5]
      if (name === undefined) { console.error('usage: spex session rename <SEL> "<name>"   (an explicit "" clears the override)'); process.exit(2) }
      if (await c.clientRename(full, name)) console.log(name.trim() ? `${full} -> renamed "${name.trim()}"` : `${full} -> name cleared (derived label restored)`)
      else { console.error(`spex session rename: no such session ${full}`); process.exit(2) }
    } else if (sub === 'attach') {
      // the HUMAN escape hatch (attach.ts, [[session-attach]]): foreground `tmux attach` into the worker's
      // real session. Guards fail loud BEFORE resolving: local-only (the tmux server is the backend
      // machine's) and terminal-only (an agent must never block its turn on it — capture/send).
      const { assertLocalBackend, attachSession } = await import('./attach.js')
      await assertLocalBackend()
      await attachSession(await resolveSelectorOrExit(id))
    } else {
      console.error(`spex session: unknown verb '${sub}' — new | ls | show | watch | wait | review | merge | send | interrupt | rename | resume | stop | close | attach | done | park | ask  (spex help session)`)
      process.exit(2)
    }
  }
} else if (cmd === 'internal') {
  // @@@ internal - the machine-plumbing namespace: verbs only generated hooks and launch scripts call,
  // kept OUT of the porcelain top level so `spex help`'s vocabulary is exactly what a human/agent types.
  const sub = process.argv[3]
  if (sub === 'trunk') {
    // print the resolved source-of-truth branch (layout.ts mainBranch(): config override → the main
    // checkout's current branch → 'main'). The pre-commit main-guard captures this so it blocks direct
    // commits on whatever the repo's trunk is actually named, never a hardcoded 'main'. One value, one
    // line; GET /api/settings exposes the same resolution (`.layout`).
    const { mainBranch } = await import('./layout.js')
    console.log(mainBranch())
  } else if (sub === 'spec-governors') {
    // Stable machine projection for spec-aware hooks: one real code: governor per row, with the live spec
    // path the block reason can point at. Empty stdout means ungoverned (including related-only).
    const file = process.argv[4]
    if (!file) { console.error('usage: spex internal spec-governors <path>'); process.exit(2) }
    const { specOwners, loadSpecsLite } = await import('./specs.js')
    const paths = new Map(loadSpecsLite().map((node) => [node.id, node.path]))
    for (const owner of specOwners(file)) {
      const path = paths.get(owner.id)
      if (!path) throw new Error(`governor '${owner.id}' has no live spec path`)
      console.log(`${owner.id}\t${path}`)
    }
  } else if (sub === 'codex-launch') {
    // BACKEND-owned codex thread. On the shared per-project app-server: thread/start { cwd = this worktree }
    // (codex loads that worktree's config/hooks/AGENTS.md), store the new id on the governed record (keyed by
    // SPEXCODE_SESSION_ID), fire the launch prompt as the FIRST turn — materializing the rollout — and print the
    // thread id. The launch script then `resume`s it in the visible TUI.
    const { codexStartThread, codexTurn, waitForCodexRollout, codexBinary, codexSupportsBypassHookTrust } = await import('./harness.js')
    const { markHarnessSessionId } = await import('./sessions.js')
    const sock = process.argv[4], cwd = process.argv[5]
    const prompt = process.argv.slice(6).join(' ')
    if (!sock || !cwd) { console.error('usage: spex internal codex-launch <sock> <cwd> [prompt...]'); process.exit(2) }
    // On the bypass-trust path (the codex install supports the flag → materialize skipped writeCodexTrust's hash),
    // the thread the BACKEND owns must carry `bypass_hook_trust` in thread/start's config so the app-server fires
    // the worktree's local hooks — mirror materialize's capability decision so the two stay in lockstep.
    const bypassHookTrust = codexSupportsBypassHookTrust(codexBinary(process.env.SPEXCODE_CODEX_CMD || 'codex'))
    const r = await codexStartThread(sock, cwd, bypassHookTrust)
    if (!r.ok) { console.error(r.error); process.exit(1) }
    if (prompt) {
      const t = await codexTurn(sock, r.threadId, prompt, cwd)
      if (!t.ok) { console.error(t.error); process.exit(1) }
      // The visible TUI resumes this thread from its ON-DISK rollout; a freshly-spawned app-server acks the turn
      // but persists the rollout a few seconds LATE (verified live: the SAME thread's file lands at ~2-4s, not
      // lost). WAIT for it to land BEFORE storing the id / printing it, else FAIL LOUD — never store a
      // non-resumable harness_session_id (that permanently wedges every reopen). The 15s budget exceeds launch.sh's
      // fast-fail threshold, so a real failure exits past it and the retry loop won't spray duplicate-prompt threads.
      if (!await waitForCodexRollout(r.threadId, 20000)) {
        console.error(`codex thread ${r.threadId} started but persisted no rollout within 20s — app-server not ready; not storing a non-resumable id`)
        process.exit(1)
      }
    }
    const sid = process.env.SPEXCODE_SESSION_ID
    if (sid) markHarnessSessionId(sid, r.threadId)
    console.log(r.threadId)
  } else if (sub === 'opencode-capture') {
    // opencode MINTS its own session id (no launch flag pins it), so the generated plugin's FIRST event calls
    // this to store that id as harness_session_id on the governed record (SPEXCODE_SESSION_ID from the launch
    // env, inherited by the opencode process → plugin). That is what lets reopen() resume the SAME
    // conversation (`--session <id>`). A missing record/env is a clean no-op — a plugin loaded outside a
    // governed launch has nothing to mark.
    const { markHarnessSessionId } = await import('./sessions.js')
    const ocid = process.argv[4]
    if (!ocid) { console.error('usage: spex internal opencode-capture <opencode-session-id>'); process.exit(2) }
    const sid = process.env.SPEXCODE_SESSION_ID
    console.log(sid && markHarnessSessionId(sid, ocid) ? `captured ${ocid}` : 'noop (no governed session record)')
  } else if (sub === 'claude-headless-run') {
    const id = process.argv[4], runtimeDir = process.argv[5], claudeCmd = process.argv[6]
    const divider = process.argv[7]
    if (!id || !runtimeDir || !claudeCmd || divider !== '--') {
      console.error('usage: spex internal claude-headless-run <session-id> <runtime-dir> <claude-cmd> -- [--session-id <id> <prompt> | --resume <id>]')
      process.exit(2)
    }
    const { runClaudeHeadlessController } = await import('./claude-headless.js')
    await runClaudeHeadlessController(id, runtimeDir, claudeCmd, process.argv.slice(8))
  } else if (sub === 'pi-headless-run') {
    const id = process.argv[4], runtimeDir = process.argv[5], piCmd = process.argv[6]
    const divider = process.argv[7]
    if (!id || !runtimeDir || !piCmd || divider !== '--') {
      console.error('usage: spex internal pi-headless-run <session-id> <runtime-dir> <pi-cmd> -- [--session-id <id> <prompt> | --session <id>]')
      process.exit(2)
    }
    const { runPiHeadlessController } = await import('./pi-headless.js')
    await runPiHeadlessController(id, runtimeDir, piCmd, process.argv.slice(8))
  } else if (sub === 'commit-surgery') {
    // the pre-commit footprint anchor ([[commit-surgery]]): unconditional materialize + staged-index repair
    // (strip our sentinel block from staged blobs, unstage HEAD-untracked generated artifacts). Called only
    // by the planted pre-commit hook; repairs and proceeds, never rejects. Exit non-zero only on an internal
    // error — the hook treats that as advisory (warn + continue), CI lint remains the real gate.
    const { commitSurgery } = await import('./commit-surgery.js')
    commitSurgery()
  } else if (sub === 'refresh-footprint') {
    // the post-checkout / post-merge freshness anchor ([[commit-surgery]]): a quiet materialize after a git
    // state transition (the only events that can move the materialize's inputs — .spec/.plugins arrive by commit,
    // merge, or checkout). Best-effort and silent on success; hooks call it fire-and-forget.
    const { materialize } = await import('./materialize.js')
    try { materialize() } catch (e) { console.error(`spexcode: footprint refresh failed (${(e as Error).message})`); process.exit(1) }
  } else if (sub === 'codex-turn') {
    // fire a follow-up turn on an OWNED thread over the per-project socket (the delivery channel, exposed for
    // tests / scripts). steer-vs-start is chosen live from the thread read.
    const { codexTurn } = await import('./harness.js')
    const sock = process.argv[4], tid = process.argv[5], text = process.argv.slice(6).join(' ')
    if (!sock || !tid || !text) { console.error('usage: spex internal codex-turn <sock> <threadId> <text...>'); process.exit(2) }
    const r = await codexTurn(sock, tid, text)
    if (r.ok) { console.log('ok') } else { console.error(r.error); process.exit(1) }
  } else if (sub === 'check-staged') {
    // the pre-commit hook's eval backstop: a staged stray evidence blob or malformed eval.md rejects the
    // commit. Logic lives in spec-eval; the hook shims here.
    const { checkStaged } = await import('../../spec-eval/src/cli.js')
    process.exit(checkStaged())
  } else if (sub === 'session-state') {
    // a lifecycle hook authors the session's state: active|awaiting|parked|error|asking
    // [--propose] [--note] [--session] — the machine face of the typeable done/park/ask declarations.
    const { s, sess, mark, noRecord, noteEcho } = await stateKit()
    const st = process.argv[4] as any
    const ok = mark(() => s.markState(st, { proposal: flag('propose') as any, note: flag('note'), sessionId: sess }))
    console.log(ok ? `state -> ${st}${noteEcho(flag('note'))}` : noRecord())
  } else if (sub === 'session-fail') {
    // the StopFailure hook marks its session (--session from the payload) as error (turn died on an API error)
    const { s, sess, mark, noRecord } = await stateKit()
    console.log(mark(() => s.markError(sess)) ? 'marked error' : noRecord())
  } else if (sub === 'session-turn-fail') {
    // Headless adapters report an ephemeral turn's non-zero exit through this one shared CAS. A declaration
    // that landed before teardown wins, so a late child close can never erase an agent-authored state.
    const sessionId = process.argv[4], harness = process.argv[5], exitCode = process.argv[6]
    if (!sessionId || !harness || !exitCode) {
      console.error('usage: spex internal session-turn-fail <session-id> <harness> <exit-code|signal>')
      process.exit(2)
    }
    const { markHeadlessTurnFailure } = await import('./sessions.js')
    console.log(markHeadlessTurnFailure(sessionId, harness, exitCode) ? `marked error (${harness} ${exitCode})` : 'noop (no active session record)')
  } else if (sub === 'session-idle') {
    // the Notification(idle_prompt) hook marks its session (--session from the payload) idle when claude waits
    // at its prompt. INFERRED, so guarded active-only: it no-ops unless the current status is exactly `active`,
    // never clobbering a deliberate awaiting/asking/parked/error declaration. Distinct from `session ask`
    // (the agent deliberately asking the human) — idle is the undeclared stop the Stop gate missed.
    const { s, sess } = await stateKit()
    console.log(s.markIdle(sess) ? 'idle' : 'noop (no session record, or not active)')
  } else if (sub === 'commit-gate') {
    // the Stop gate's deterministic commit check (from cwd = the worktree): exit 0 if the node branch is
    // ready to declare done/merge (work committed + ahead of main), else print the reason and exit 1. Uses
    // git() so the hook's exported GIT_DIR/GIT_INDEX_FILE don't misdirect repo discovery (see git.ts).
    const { s } = await stateKit()
    const r = s.mergeReadiness()
    if (r.ready) { console.log('ready'); process.exit(0) }
    console.log(r.reason)
    process.exit(1)
  } else if (sub === 'nudge') {
    // the post-merge hook prints the (toggle-aware) issue nudge for a merged node — never typed.
    const { nudge } = await import('./localIssues.js')
    const text = nudge(positionals(4)[0] || '')
    if (text) console.log(text)
  } else {
    const { commandHelp } = await import('./help.js')
    console.error(commandHelp('internal'))
    process.exit(2)
  }
} else {
  console.error(`spex: unknown command '${cmd}' (try: spex help)`)
  process.exit(2)
}
