export {} // make this a module so top-level await is allowed
const cmd = process.argv[2]

// Registered before any await so a fatal top-level error lands here. Errors we OWN (BackendError, the
// loud malformed-config ConfigError) are matched BY NAME — to avoid importing them — and rendered as a
// one-line `spex: <message>` (a user's config typo must read as their typo, not a SpexCode stack dump);
// anything else prints in full so a real bug keeps its trace. A synchronous throw inside an awaited call
// (loadConfig on a malformed spexcode.json) surfaces as uncaughtException, not unhandledRejection, so BOTH
// paths route through the same printer.
function fatal(e: unknown): never {
  if (e instanceof Error && (e.name === 'BackendError' || e.name === 'ConfigError')) console.error(`spex: ${e.message}`)
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
// large piped dump (`spex issues --json | …`, board, review --json) is silently cut off at the pipe
// buffer (~64KB). The empty write's callback fires once every prior queued chunk has drained; the returned
// promise never resolves (process.exit ends the process inside the callback), so `await flushExit(code)`
// halts execution here exactly like process.exit did — safe to drop in on any unbounded-output verb.
// EPIPE (a reader that closed early — `| head`, `| jq` exiting) can never drain, so we ALSO exit on the
// stream error rather than hang: the truncation is the reader's choice then, not ours.
function flushExit(code = 0): Promise<never> {
  return new Promise<never>(() => {
    const done = () => process.exit(code)
    process.stdout.on('error', done)
    process.stdout.write('', done)
  })
}
const has = (name: string) => process.argv.includes(`--${name}`)
// bare positionals after argv index `from`, skipping flags and their values (selectors for ls/watch).
const VALUE_FLAGS = new Set(['--status', '--as', '--interval', '--propose', '--note', '--node', '--prompt', '--timeout', '--reason', '--out', '--password', '--tls-cert', '--tls-key', '--harness', '--launcher', '--harness-session', '--port', '--api-port', '--host', '--preset', '--limit', '--session', '--depth'])
function positionals(from: number): string[] {
  const out: string[] = []
  for (let i = from; i < process.argv.length; i++) {
    const t = process.argv[i]
    if (t.startsWith('--')) { if (VALUE_FLAGS.has(t)) i++; continue }
    out.push(t)
  }
  return out
}

// After a successful launch, nudge the caller to actually MONITOR the session — launch-then-forget is a real
// gap (a supervisor or human launches and then never watches, so a review/failure goes unnoticed). Goes to
// STDERR so the JSON on stdout (which callers parse) stays clean; keyed to whoever's calling — a supervising
// agent has an own-session id, a human at a terminal does not.
async function launchMonitorReminder(id: string): Promise<void> {
  const { ownSessionId } = await import('./sessions.js')
  const agent = ownSessionId()
  console.error(`\nspex: launched session ${id} — now MONITOR it, or its review/failure goes unnoticed:`)
  if (agent) {
    // a supervising agent: the per-worker monitor is a backgrounded `spex wait`, which exits on an actionable status.
    console.error(`  supervising agent → background \`spex wait ${id}\` (blocks until it hits an actionable status, then exits)`)
    console.error(`  or watch the whole stream: \`spex watch\``)
  } else {
    console.error(`  \`spex watch\` — the live stream of actionable session transitions (or \`spex wait ${id}\` to block on this one)`)
  }
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
      const text = `🔭 ${meWho} is now supervising you — they started \`spex watch\` over this session. To reach them directly, run: spex session send ${watcher} "<your message>". (One-time heads-up; reply only if you need to.)`
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
  if (!selector) { console.error('spex: missing session selector (id | id-prefix | node | branch)'); process.exit(2) }
  const { resolveClientSession } = await import('./client.js')
  const r = await resolveClientSession(selector)
  if ('ok' in r) return r.ok.id
  if ('none' in r) { console.error(`spex: no such session: ${selector}`); process.exit(2) }
  console.error(`spex: ambiguous selector "${selector}" matches ${r.ambiguous.length} sessions — be more specific:`)
  for (const s of r.ambiguous) console.error(`  ${s.id.slice(0, 8)}  ${s.node || s.branch || s.id}`)
  process.exit(2)
}

// a trailing --help/-h prints help and exits BEFORE any verb runs, so a help probe never fires a
// streaming/mutating command. It prints THAT command's usage when an entry exists (the second layer
// of the help journey — see help.ts), falling back to the map for an unknown token.
if (cmd && cmd !== 'help' && (has('help') || process.argv.includes('-h'))) {
  const { commandHelp, overviewHelp } = await import('./help.js')
  console.log(commandHelp(cmd) ?? overviewHelp())
  process.exit(0)
}

if (cmd === 'serve') {
  // the supervisor owns the public port and runs index.ts as a child for zero-downtime reloads; it
  // (not `tsx watch`) is what watches spec-cli/src, so the package `serve` script must NOT use --watch.
  // --port is sugar over the PORT env supervise.ts reads — set BEFORE importing so it takes effect. This
  // mirrors `spex dashboard --api-port`, so one host runs many projects (each `serve --port N` paired with
  // a `dashboard --api-port N`), cwd picking which project's .spec is served — no shared default collides.
  const portArg = flag('port')
  if (portArg !== undefined) {
    if (!Number.isInteger(Number(portArg))) { console.error('spex serve: --port must be an integer'); process.exit(2) }
    process.env.PORT = portArg
  }
  await import('./supervise.js')
} else if (cmd === 'dashboard') {
  // the natural post-install UI: serve the bundled dashboard on its OWN port (loopback by default;
  // --host widens the bind for LAN/tailnet viewing), proxying /api + the terminal socket to a
  // separately-run `spex serve`. Replaces the dogfood-only `npm run web` (vite).
  const { serveDashboardLocal } = await import('./gateway.js')
  const port = Number(flag('port') ?? process.env.SPEXCODE_DASHBOARD_PORT ?? 5173)
  const apiPort = Number(flag('api-port') ?? process.env.PORT ?? 8787)
  const host = flag('host') ?? '127.0.0.1'
  if (!Number.isInteger(port) || !Number.isInteger(apiPort)) { console.error('spex dashboard: --port and --api-port must be integers'); process.exit(2) }
  serveDashboardLocal({ port, apiPort, host })
} else if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  // `spex help <cmd>` drills into one command; bare help is the map. Both name the next layer down.
  const { commandHelp, overviewHelp } = await import('./help.js')
  const topic = positionals(3)[0]
  if (cmd === 'help' && topic) {
    const h = commandHelp(topic)
    if (!h) { console.error(`spex help: no command '${topic}' — run \`spex help\` for the map`); process.exit(2) }
    console.log(h)
  } else console.log(overviewHelp())
} else if (cmd === 'guide') {
  const { guideText } = await import('./guide.js')
  const text = guideText(process.argv[3])
  if (text === null) {
    console.error(`spex guide: no topic '${process.argv[3]}'. Topics: spec, yatsu, config. Run \`spex guide\` (no topic) for the setup workflow, \`spex help\` for the command map.`)
    process.exit(2)
  }
  console.log(text)
} else if (cmd === 'owner') {
  // BOTH [[governed-related]] relations, distinctly: governors (code: — the verdict) and referencers
  // (related: — pointers; coverage only, never drift/yatsu).
  const { specOwners, specRelated } = await import('./specs.js')
  const { loadConfig } = await import('./lint.js')
  const p = positionals(3)[0]
  if (!p) { console.error('usage: spex owner <path> [--actionable]'); process.exit(2) }
  const rel = p.startsWith(process.cwd()) ? p.slice(process.cwd().length + 1) : p
  const owners = specOwners(p)
  const related = specRelated(p)
  const maxOwners = loadConfig(process.cwd()).maxOwners
  const names = (xs: { id: string }[]) => xs.map((o) => `'${o.id}'`).join(', ')
  const relLine = related.length ? `\n  also referenced by ${names(related)} (related: coverage only — no drift, no yatsu)` : ''
  if (owners.length === 0 && related.length === 0) {
    console.log(`${rel} — no spec claims this yet (uncovered). If your change is substantive, give it a home before it drifts.`)
  } else if (owners.length === 0) {
    // related-only: lint's coverage is satisfied, so the per-edit hook stays silent (lint-consistent) —
    // but a human asking gets the honest nuance: nothing tracks this file's drift.
    if (has('actionable')) process.exit(0)
    console.log(`${rel} — not governed (no code: claim), but referenced by ${names(related)} (related: coverage only). Nothing tracks its drift; if your change is substantive, consider giving it a governing home.`)
  } else if (owners.length <= maxOwners) {
    // a sanely-owned file is NOT actionable: --actionable callers (the per-edit spec-of-file hook) stay
    // silent here, so the annotation fires only on an OVER-owned or uncovered file — rare and worth acting on.
    if (has('actionable')) process.exit(0)
    const named = owners.map((o) => `'${o.id}'`).join(', ')
    const lead = owners.length === 1 ? `${rel} is governed by ${named} — ${owners[0].desc}` : `${rel} is governed by ${named} (shared, fine).`
    console.log(`${lead} Read/honor the spec; if your change shifts the intent, update the spec in the SAME commit.${relLine}`)
  } else {
    const ids = owners.map((o) => o.id).join(', ')
    console.log(`${rel} is governed by ${owners.length} specs (${ids}) — more than one file should hold. This file does TOO MUCH: SPLIT it so each governor owns its own module (or merge the nodes if they're one concern, or give it a single foundation owner + relate the rest).${relLine}`)
  }
} else if (cmd === 'lint') {
  const { specLint, driftGate, DRIFT_GUIDANCE } = await import('./lint.js')
  const findings = await specLint()
  const errors = findings.filter((f) => f.level === 'error')
  for (const f of findings) console.error(`  ${f.level === 'error' ? '✗' : '•'} ${f.rule}: ${f.msg}`)
  console.error(`spex lint: ${errors.length} error(s), ${findings.length - errors.length} warning(s)`)
  // drift teaches + gates from the ONE `spex lint` (no flag): print the remediation guidance wherever
  // drift exists, then apply the commit-local gate — which reads the staged index itself, so it only
  // blocks an in-flight commit that touches an already heavily-drifted node. CI/manual (nothing staged)
  // stays advisory, per the ci-gate contract.
  const { blocked, touched, threshold } = await driftGate()
  if (findings.some((f) => f.rule === 'drift') || touched.length) console.error(`\n${DRIFT_GUIDANCE}`)
  for (const t of touched) console.error(`  ${t.drift >= threshold ? '✗' : '•'} drift-gate: '${t.id}' is ${t.drift} behind${t.drift >= threshold ? ' — BLOCKS this commit' : ' (advisory)'}`)
  if (blocked.length) console.error(`\n✗ SpexCode: ${blocked.join(', ')} ${blocked.length === 1 ? 'is' : 'are'} ≥ ${threshold} commit(s) behind. Reconcile (above) or bypass with SPEXCODE_SKIP_LINT=1.`)
  process.exit(errors.length || blocked.length ? 1 : 0)
} else if (cmd === 'ack') {
  // --amend stamps the Spec-OK trailers in the same block as Session:; git de-dupes adjacent trailers, so re-acking is harmless.
  const { git } = await import('./git.js')
  const nodes = positionals(3)
  const reason = (flag('reason') ?? '').trim()
  if (!nodes.length || !reason) {
    console.error('usage: spex ack <node-id>… --reason "<why this change keeps each spec valid>"')
    console.error('  --reason is required (it forces you to check before acking) and is NOT stored — git keeps only the Spec-OK trailer.')
    process.exit(2)
  }
  try {
    git(['commit', '--amend', '--no-edit', ...nodes.flatMap((n) => ['--trailer', `Spec-OK: ${n}`])])
    console.log(`Spec-OK: ${nodes.join(', ')} → ${git(['rev-parse', '--short', 'HEAD']).trim()}  (reason required, not stored)`)
  } catch (e: any) {
    console.error(`ack failed: ${e?.message ?? e}`); process.exit(1)
  }
} else if (cmd === 'init') {
  // scaffold a repo to adopt SpexCode: copy the shipped DATA templates (seed spec tree + git hooks)
  // into <targetDir> (default cwd). spex init [targetDir]
  const { specInit } = await import('./init.js')
  await specInit(positionals(3)[0], flag('preset'))
} else if (cmd === 'uninstall') {
  // the surgical inverse of init: remove every SpexCode-generated artifact (harness shims/contract/trust, the
  // .gitignore block, the global store, any plugin bundle) — NEVER the user's .spec/.config data or their own
  // prose. Git hooks preserved unless --hooks. spex uninstall [targetDir] [--hooks]
  const { uninstall } = await import('./uninstall.js')
  uninstall(positionals(3)[0], { hooks: has('hooks') })
} else if (cmd === 'review' && positionals(3)[0] === 'proof') {
  const sel = positionals(3)[1]
  if (!sel) { console.error('usage: spex review proof <selector> [--open | --out <path> | --json]'); process.exit(2) }
  const id = await resolveSelectorOrExit(sel)
  const { clientProof } = await import('./client.js')
  const r = await clientProof(id, has('json'))
  if (!r.ok) { console.error(`no proof for ${id} (status ${r.status})`); process.exit(1) }
  if (has('json')) { console.log(r.body); await flushExit(0) }
  const { writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const out = flag('out') ?? join(tmpdir(), `spexcode-proof-${id.slice(0, 8)}.html`)
  writeFileSync(out, r.body)
  if (has('open')) {
    const { spawn } = await import('node:child_process')
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    try { spawn(opener, [out], { detached: true, stdio: 'ignore' }).unref(); console.log(`opened ${out}`) }
    catch { console.log(`wrote ${out} — couldn't auto-open, open it in a browser`) }
  } else console.log(out)
  process.exit(0)
} else if (cmd === 'review') {
  const { clientReview } = await import('./client.js')
  const sel = positionals(3)[0]
  if (!sel) { console.error('usage: spex review <session-selector>  (id | id-prefix | node | branch)'); process.exit(2) }
  const id = await resolveSelectorOrExit(sel)
  const r = await clientReview(id)
  if (!r) { console.error(`no such session ${id}`); process.exit(1) }
  if (has('json')) { console.log(JSON.stringify(r, null, 2)) }
  else {
    const g = r.gates
    console.log(`review ${r.node || r.branch || r.id}  [${r.id}]`)
    console.log(`  ahead of main : ${r.ahead} commit(s)`)
    console.log(`  uncommitted   : ${r.dirtyNonRuntime} non-runtime file(s)`)
    console.log(`  proposal      : ${r.proposal.kind ?? '—'}${r.proposal.note ? ` — ${r.proposal.note}` : ''}`)
    console.log('  gates:')
    console.log(`    conflicts w/ main : ${g.conflictsWithMain ? 'YES' : 'no'}`)
    console.log(`    lint              : ${g.lint.errorCount} error(s), ${g.lint.warningCount} warning(s)`)
    console.log(`  diff (merge-base, ${r.diff.length} file(s)):`)
    for (const f of r.diff) console.log(`    ${f.status.padEnd(12)} +${f.additions} -${f.deletions}  ${f.path}`)
  }
} else if (cmd === 'merge') {
  const { clientMerge } = await import('./client.js')
  const sel = positionals(3)[0]
  if (!sel) { console.error('usage: spex merge <selector>  (id | id-prefix | node | branch)'); process.exit(2) }
  const id = await resolveSelectorOrExit(sel)
  const r = await clientMerge(id)
  if (r.dispatched) console.log(`merge dispatched to ${id} — its agent is landing the merge`)
  else console.error(`merge dispatch failed: ${r.reason}`)
  process.exit(r.dispatched ? 0 : 1)
} else if (cmd === 'forge') {
  // thin route — all logic lives in spec-forge.
  const { runForge } = await import('../../spec-forge/src/cli.js')
  await flushExit(await runForge(process.argv.slice(3)))
} else if (cmd === 'yatsu') {
  // thin route — all logic lives in spec-yatsu.
  const { runYatsu } = await import('../../spec-yatsu/src/cli.js')
  await flushExit(await runYatsu(process.argv.slice(3)))
} else if (cmd === 'blob') {
  // @@@ blob - the bare evidence-transport verb ([[blob-put]]): put bytes in the shared content-addressed
  // cache and print the hash, decoupled from filing a reading. Thin route — the cache lives in spec-yatsu.
  const { runBlob } = await import('../../spec-yatsu/src/cli.js')
  await flushExit(runBlob(process.argv.slice(3)))
} else if (cmd === 'issues') {
  // @@@ issues - the ONE issues surface ([[issues]]): bare it is THE read — local + forge issues as ONE
  // store-tagged list, the supervisor's/human's drain view; a write first-positional (open|reply|sign|
  // resolve|on|off|status, [[local-issues]]) routes to the write verbs (open/reply/close are store-routed —
  // the SAME createIssue/replyIssue/closeIssue the dashboard's API calls), `promote` moves a
  // thread cross-store. (The pre-rename `spex propose` alias is gone — a deployed post-merge hook still
  // calling it prints an unknown-command line, advisory-only, until `npm run hooks` reinstalls it.)
  const { runIssues } = await import('./issues.js')
  await flushExit(await runIssues(process.argv.slice(3)))
} else if (cmd === 'remark' || cmd === 'resolve' || cmd === 'retract') {
  // @@@ remark - the resolvable interaction primitive ([[remark-substrate]]): pin a concern to a HOST (a
  // local issue, or a scenario `<node> --scenario <name>`) that a second agent can `resolve` and the author
  // can `retract`. CLI-first — the whole author→resolve→retract loop is these thin store-write wrappers, so
  // the dashboard adds no capability. `spex remark <host> --body -|<text> [--code-sha <sha>]`.
  const m = await import('./localIssues.js')
  const run = cmd === 'remark' ? m.runRemark : cmd === 'resolve' ? m.runResolve : m.runRetract
  await flushExit(await run(process.argv.slice(3)))
} else if (cmd === 'materialize') {
  // @@@ materialize - the pay-per-change render: surface nodes → manifest + AGENTS.md/CLAUDE.md block +
  // shims + Codex trust, for cwd's project. The cheap shell gate (dispatch.sh) invokes it only on change.
  const { materialize } = await import('./materialize.js')
  console.log(`materialized — content-hash ${materialize()}`)
} else if (cmd === 'doctor') {
  // @@@ doctor - the diagnosis surface ([[doctor]], né `self` — renamed: "self" read as the tool itself /
  // the global install, while the report is about THIS agent's wiring): does the materialized workflow
  // actually reach this agent? Bare `doctor` reports per-layer coverage (preconditions · git-hook floor ·
  // contract · hooks+handler-existence · backend) over the same HARNESSES materialize renders through;
  // `contract` prints the surface:system text; `conflicts` just the double-delivery check. Thin route.
  const { runDoctor } = await import('./doctor.js')
  await flushExit(await runDoctor(process.argv.slice(3)))
} else if (cmd === 'board') {
  const { buildBoard } = await import('./board.js')
  console.log(JSON.stringify(await buildBoard(), null, 2))
  await flushExit(0)
} else if (cmd === 'tree') {
  // @@@ tree - the human-readable graph ([[spex-tree]]): the same buildBoard() the dashboard renders,
  // as an indented status-coloured terminal tree. Colour degrades cleanly: off unless stdout is a tty,
  // and NO_COLOR always wins.
  const { buildBoard } = await import('./board.js')
  const { renderTree, treeJson } = await import('./tree.js')
  const depthRaw = flag('depth')
  const depth = depthRaw === undefined ? undefined : Number(depthRaw)
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0)) { console.error('spex tree: --depth must be a non-negative integer'); process.exit(2) }
  const opts = { node: flag('node'), depth, color: process.stdout.isTTY && !process.env.NO_COLOR }
  const { nodes } = await buildBoard()
  try {
    console.log(has('json') ? JSON.stringify(treeJson(nodes, opts), null, 2) : renderTree(nodes, opts))
  } catch (e: any) {
    console.error(`spex tree: ${e?.message ?? e}`)
    process.exit(2)
  }
  await flushExit(0)
} else if (cmd === 'search') {
  const { searchSpecs } = await import('./search.js')
  const query = positionals(3).join(' ')
  if (!query.trim()) { console.error('usage: spex search <query> [--json] [--limit N]'); process.exit(2) }
  const limit = Number(flag('limit')) || 10
  const results = await searchSpecs(query, { limit, onStats: (s) => console.error(`[spec-search] compute ${s.ms.toFixed(1)}ms · ${s.nodes} nodes · ${s.tokens} tokens (excludes process start)`) })
  // zero-result fail-loud: the message always carries the corpus-is-English fact (unconditional — no
  // language sniffing, no score threshold), so a non-English query self-explains instead of dead-ending.
  const NO_MATCH = (q: string) => `no spec node matches "${q}" (the corpus is English — if your query isn't, translate and retry)`
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
} else if (cmd === 'ls') {
  // pretty list of living sessions + states. `spex ls [SEL...] [--status a,b] [--json]`
  // the board comes from the backend (so `spex ls` shows the sessions of whatever SPEXCODE_API_URL points at,
  // incl. a remote machine); selectSessions/formatTable are pure presentation, applied client-side.
  const { selectSessions, formatTable } = await import('./sessions.js')
  const { clientListSessions } = await import('./client.js')
  const picked = selectSessions(await clientListSessions(), positionals(3), flag('status')?.split(','))
  console.log(has('json') ? JSON.stringify(picked, null, 2) : formatTable(picked))
} else if (cmd === 'watch') {
  const { watchSessions } = await import('./sessions.js')
  const { clientListSessions } = await import('./client.js')
  const selectors = positionals(3)
  const intervalMs = (Number(flag('interval')) || 5) * 1000
  await withWatchEdge(selectors, intervalMs, () => watchSessions((line) => console.log(line), {
    source: clientListSessions,   // poll the backend, so watch streams the (possibly remote) backend's board
    selectors,
    statuses: flag('status')?.split(','),
    includeIdle: has('idle'),
    as: flag('as'),
    intervalMs,
  }), true)   // greet=true: a stream watch greets its specific targets once; `wait` (one-shot) does not
} else if (cmd === 'wait') {
  const { watchSessions } = await import('./sessions.js')
  const { clientListSessions } = await import('./client.js')
  const [id] = positionals(3)
  if (!id) { console.error('usage: spex wait <id> [--timeout SECONDS] [--interval SECONDS] [--idle]'); process.exit(2) }
  const intervalMs = (Number(flag('interval')) || 2) * 1000
  const timeoutSec = Number(flag('timeout')) || 1200
  const r = await withWatchEdge([id], intervalMs, () => watchSessions(() => {}, {
    source: clientListSessions,
    selectors: [id],
    includeIdle: has('idle'),
    intervalMs,
    until: { timeoutMs: timeoutSec * 1000 },
  }))
  if ('reached' in r) { console.log(r.reached); process.exit(0) }
  if ('gone' in r) { console.error(`spex wait: no such (living) session ${id}`); process.exit(2) }
  if ('backendDown' in r) { console.error(`spex wait: ${r.backendDown}`); process.exit(1) }   // fail loud, not a false timeout
  console.error(`spex wait: timeout — ${id} did not reach an actionable status within ${timeoutSec}s`)
  process.exit(1)
} else if (cmd === 'new') {
  // shorthand for `spex session new`: spex new "<prompt>" [--node X]  (prompt = first positional or --prompt)
  // createSession POSTs to the running backend so the launch runs in the backend's process (auth env + cap);
  // it falls back to an in-process launch only when no backend answers.
  const { createSession } = await import('./sessions.js')
  const prompt = flag('prompt') ?? positionals(3)[0] ?? ''
  const created = await createSession(flag('node') ?? null, prompt, flag('harness') ?? undefined, flag('launcher') ?? undefined)
  console.log(JSON.stringify(created, null, 2))
  await launchMonitorReminder(created.id)
} else if (cmd === 'session') {
  const sub = process.argv[3]
  // `s` (sessions.ts) backs the state PRODUCERS that stay local (state/done/park/fail/ask/idle write the
  // global record by session_id; commit-gate is a pure git check of the cwd worktree) and `new` (its own
  // launch path). `c` (client.ts) backs the read/control subs that route through the backend. Lazily imported.
  const s = await import('./sessions.js')
  const c = await import('./client.js')
  const id = process.argv[4]
  // the agent-authored state writers resolve WHICH session by id: a `--session <id>` flag (the lifecycle
  // hooks pass it, parsed from the payload, since they no longer have a cwd `.session`) wins, else the
  // harness env var (ownSessionId — the agent's own `spex session …` carries the harness session id).
  const sess = flag('session')
  // appended to a done/ask/block declaration: states (not commands) that the next tool call's mark-active hook re-flips the global record to active, so a re-read won't show this.
  const DECLARED = ' — recorded; the human sees it in the dashboard. This state lives in your session\'s global record; your next tool call flips that record back to active (the mark-active hook, by design), so it is normal for this declaration not to persist.'
  // appended ONLY to a propose-close declaration: a worktree about to be discarded may still own ephemeral things the agent started to test this change; nudge (not gate) it to reclaim them before the worktree goes, keyed on whether the thing should outlive the task — never on who started it (a deliberately long-running service / a production build is started-by-you yet must be left alone). Project-agnostic on purpose.
  const CLOSE_CLEANUP = '\n\nBefore this worktree closes, check whether you left anything running that you started to test this change — a background process, a dev or preview server, a bound port, a scratch session. If nothing depends on it anymore, shut it down, or it keeps running as an orphan. Leave anything meant to keep running: a service you deliberately stood up, a production build, anything other work relies on. What matters is whether it still needs to exist after this task, not whether you started it. If unsure, leave it. This is a reminder to check, not a required step.'
  if (sub === 'new') {
    // route through the backend (auth env + concurrency cap); in-process only if no backend is reachable.
    // prompt = --prompt OR the first positional (after `session new`), so `session new "<prompt>"` works the
    // SAME as the `spex new "<prompt>"` shorthand — one prompt-resolution rule, not two.
    const created = await s.createSession(flag('node') ?? null, flag('prompt') ?? positionals(4)[0] ?? '', flag('harness') ?? undefined, flag('launcher') ?? undefined)
    console.log(JSON.stringify(created, null, 2))
    await launchMonitorReminder(created.id)
  } else if (sub === 'reopen') {
    // bring the agent back up (relaunch ONLY if confirmed offline, the backend owns it); demotes a working
    // `active` to idle but leaves a standing declaration/proposal untouched (see sessions.ts reopen()). The
    // RESUME GUARD refuses a relaunch on a LIVE/unproven agent (that would kill a live worker) — `--force`
    // overrides for a genuinely wedged process. A following prompt is what actually re-drives it.
    const full = await resolveSelectorOrExit(id)
    const r = await c.clientReopen(full, process.argv.includes('--force'))
    if (r.ok) console.log(`${full} -> reopened`)
    else { console.error(`spex session reopen: ${r.error || `no such session ${full}`}`); process.exit(2) }
  } else if (sub === 'state') {
    // the agent authors ITS OWN state: active|awaiting|parked|error  [--propose] [--note] [--session]
    const st = process.argv[4] as any
    const ok = s.markState(st, { proposal: flag('propose') as any, note: flag('note'), sessionId: sess })
    console.log(ok ? `state -> ${st}` : 'no session record (unknown --session / no CLAUDE_CODE_SESSION_ID, or bad status)')
  } else if (sub === 'done') {
    // sugar for awaiting; --propose merge|nothing|close, optional --note
    const p = (flag('propose') as any) || 'nothing'
    let closeNote = p === 'close' ? CLOSE_CLEANUP : ''
    if (p === 'close') {
      // the DATA half of the close nudge ([[local-issues]] closeoutNudge): the still-open local issues this
      // session touched, listed by id — empty/OFF/no-identity prints nothing. Loud on failure but never
      // gating: the declaration must land whatever the issue store is doing.
      try { closeNote += (await import('./localIssues.js')).closeoutNudge(sess ?? s.ownSessionId()) }
      catch (e) { console.error(`issue closeout check failed (declaration unaffected): ${e instanceof Error ? e.message : e}`) }
    }
    console.log(s.markDone(p, sess) ? `done (${p})${DECLARED}${closeNote}` : 'no session record')
  } else if (sub === 'park') {
    // sugar: the agent is waiting on a background task; it will self-resume (NOT idle/awaiting)
    console.log(s.markState('parked', { note: flag('note'), sessionId: sess }) ? `parked${DECLARED}` : 'no session record')
  } else if (sub === 'fail') {
    // the StopFailure hook marks its session (--session from the payload) as error (turn died on an API error)
    console.log(s.markError(sess) ? 'marked error' : 'no session record')
  } else if (sub === 'ask') {
    // the agent DELIBERATELY declares it is pausing to ask the human a question (like `done`/`park`, an
    // authored state — NOT guarded active-only). The --note carries the question. Distinct from `park`
    // (waiting on a background task, self-resumes): an asking agent resumes only when the human replies.
    console.log(s.markState('asking', { note: flag('note'), sessionId: sess }) ? `asking${DECLARED}` : 'no session record')
  } else if (sub === 'commit-gate') {
    // the Stop gate's deterministic commit check (from cwd = the worktree): exit 0 if the node branch is
    // ready to declare done/merge (work committed + ahead of main), else print the reason and exit 1. Uses
    // git() so the hook's exported GIT_DIR/GIT_INDEX_FILE don't misdirect repo discovery (see git.ts).
    const r = s.mergeReadiness()
    if (r.ready) { console.log('ready'); process.exit(0) }
    console.log(r.reason)
    process.exit(1)
  } else if (sub === 'idle') {
    // the Notification(idle_prompt) hook marks its session (--session from the payload) idle when claude waits
    // at its prompt. INFERRED, so guarded active-only: it no-ops unless the current status is exactly `active`,
    // never clobbering a deliberate awaiting/asking/parked/error declaration. Distinct from `ask`
    // (the agent deliberately asking the human) — idle is the undeclared stop the Stop gate missed.
    console.log(s.markIdle(sess) ? 'idle' : 'noop (no session record, or not active)')
  } else if (sub === 'exit') {
    // the SOFT stop: kill the agent's tmux + socket but KEEP the worktree, so the session goes offline and
    // can be resumed (reopen/relaunch). Distinct from `close`, which removes the worktree.
    const full = await resolveSelectorOrExit(id)
    console.log(await c.clientExit(full) ? `exited ${full} (worktree kept — resumable)` : `no such session ${full}`)
  } else if (sub === 'close') {
    const full = await resolveSelectorOrExit(id)
    console.log(await c.clientClose(full) ? `closed ${full}` : `no such session ${full}`)
  } else if (sub === 'send') {
    // prompt dispatch is socket-only + fail-loud (the backend enforces it): a non-accepted prompt prints the
    // reason AND exits non-zero, so a manager/script never mistakes a dead dispatch for success.
    const full = await resolveSelectorOrExit(id)
    // BIDIRECTIONAL: stamp the SENDER (this send process's OWN session — the only process that knows it, via
    // ownSessionId from CLAUDE_CODE_SESSION_ID) + a one-line reply hint into the delivered
    // message, so the recipient can reply over the SAME send. The sender's row (hence its display label) is
    // resolved through the shared resolver; a human in a plain shell has no session id → bare message, no
    // hint (see [[agent-reply-channel]]).
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
  } else if (sub === 'capture') {
    // the session's live pane (output) over HTTP — fail and empty stay DISTINCT: a real empty pane prints
    // nothing and exits 0; unknown id / offline / capture-error each exit non-zero with a named reason.
    const full = await resolveSelectorOrExit(id)
    const r = await c.clientCapture(full)
    if (r.ok) { process.stdout.write(r.pane) }
    else { console.error(`spex capture: ${r.reason}`); process.exit(r.status === 404 ? 2 : 1) }
  } else if (sub === 'rename') {
    // set the session's display-name override — the right-click rename ([[session-rename]]) as a verb, so an
    // agent manager can fix a label without the GUI. An EXPLICIT "" clears back to the derived label; a
    // MISSING argument is a usage error, never a silent clear. Unknown session → the endpoint's 404, loud.
    const full = await resolveSelectorOrExit(id)
    const name = process.argv[5]
    if (name === undefined) { console.error('usage: spex session rename <SEL> "<name>"   (an explicit "" clears the override)'); process.exit(2) }
    if (await c.clientRename(full, name)) console.log(name.trim() ? `${full} -> renamed "${name.trim()}"` : `${full} -> name cleared (derived label restored)`)
    else { console.error(`spex session rename: no such session ${full}`); process.exit(2) }
  } else if (sub === 'rawkey') {
    // forward raw nav-mode keystrokes (tmux send-keys, NEVER the prompt socket) — how a manager drives a
    // worker wedged in an interactive TUI dialog the prompt channel can't reach (a select menu wanting one
    // Enter/arrow). Tokens = named keys, single chars, C-/M-/S- combos; whitespace-separated, delivered as
    // ONE ordered batch ([[nav-mode-key-ordering]]). Fail-loud: nothing delivered exits non-zero.
    const full = await resolveSelectorOrExit(id)
    const keys = process.argv.slice(5).flatMap((s) => s.split(/\s+/)).filter(Boolean)
    if (keys.length === 0) { console.error('usage: spex session rawkey <SEL> "<keys>"   (e.g. "Up Up Enter", "C-r", single chars)'); process.exit(2) }
    if (await c.clientRawkey(full, keys)) console.log(`sent ${keys.length} key${keys.length === 1 ? '' : 's'} -> ${full}`)
    else { console.error(`spex session rawkey: nothing delivered to ${full} (offline, unknown session, or no valid key token)`); process.exit(1) }
  } else if (sub === 'prompt') {
    // print the session's full ORIGINATING prompt (what it was asked to do), captured at launch.
    const full = await resolveSelectorOrExit(id)
    const r = await c.clientPrompt(full)
    if (!r.ok) { console.error(`no prompt recorded for ${full}`); process.exit(1) }
    process.stdout.write(r.prompt.endsWith('\n') ? r.prompt : r.prompt + '\n')
  } else {
    console.error('spex session: new|reopen|done|park|ask|idle|exit|close|send|capture|rename|rawkey|prompt'); process.exit(2)
  }
} else if (cmd === 'internal') {
  // @@@ internal - the machine-plumbing namespace: verbs only generated hooks and launch scripts call,
  // kept OUT of the porcelain top level so `spex help`'s vocabulary is exactly what a human/agent types.
  const sub = process.argv[3]
  if (sub === 'trunk') {
    // print the resolved source-of-truth branch (layout.ts mainBranch(): config override → the main
    // checkout's current branch → 'main'). The pre-commit main-guard captures this so it blocks direct
    // commits on whatever the repo's trunk is actually named, never a hardcoded 'main'. One value, one
    // line; GET /api/layout exposes the same resolution.
    const { mainBranch } = await import('./layout.js')
    console.log(mainBranch())
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
    const bypassHookTrust = codexSupportsBypassHookTrust(codexBinary(process.env.SPEXCODE_CODEX_CMD || 'codex --yolo'))
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
  } else if (sub === 'codex-turn') {
    // fire a follow-up turn on an OWNED thread over the per-project socket (the delivery channel, exposed for
    // tests / scripts). steer-vs-start is chosen live from the thread read.
    const { codexTurn } = await import('./harness.js')
    const sock = process.argv[4], tid = process.argv[5], text = process.argv.slice(6).join(' ')
    if (!sock || !tid || !text) { console.error('usage: spex internal codex-turn <sock> <threadId> <text...>'); process.exit(2) }
    const r = await codexTurn(sock, tid, text)
    if (r.ok) { console.log('ok') } else { console.error(r.error); process.exit(1) }
  } else {
    const { commandHelp } = await import('./help.js')
    console.error(commandHelp('internal'))
    process.exit(2)
  }
} else {
  console.error(`spex: unknown command '${cmd}' (try: spex help)`)
  process.exit(2)
}
