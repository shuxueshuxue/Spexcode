export {} // make this a module so top-level await is allowed
const cmd = process.argv[2]

// registered before any await so a top-level-await rejection lands here; BackendError matched by name to avoid importing it.
process.on('unhandledRejection', (e: unknown) => {
  if (e instanceof Error && e.name === 'BackendError') console.error(`spex: ${e.message}`)
  else console.error(e)
  process.exit(1)
})

// tiny flag reader: --key value  (and bare positionals)
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)
// bare positionals after argv index `from`, skipping flags and their values (selectors for ls/watch).
const VALUE_FLAGS = new Set(['--status', '--as', '--interval', '--propose', '--note', '--node', '--prompt', '--timeout', '--reason', '--out', '--password', '--tls-cert', '--tls-key', '--harness', '--launcher', '--harness-session', '--port', '--api-port', '--preset'])
function positionals(from: number): string[] {
  const out: string[] = []
  for (let i = from; i < process.argv.length; i++) {
    const t = process.argv[i]
    if (t.startsWith('--')) { if (VALUE_FLAGS.has(t)) i++; continue }
    out.push(t)
  }
  return out
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

function printHelp(): void {
  console.log(`spex — SpexCode CLI (spec↔code graph + worktree session state machine)

Usage: spex <command> [args]

Specs / graph
  guide [spec|yatsu|config]  no topic: setup workflow; spec/yatsu: file-format manual; config: spexcode.json settings
  init [dir]            scaffold a repo to adopt SpexCode (seed .spec + install git hooks; default: cwd)
    --preset <name>          which .config plugin tier to seed (cumulative: default ⊂ careful; default 'default')
  uninstall [dir]      surgical inverse of init: remove SpexCode's generated artifacts (shims·contract·trust·
                        gitignore block·global store·plugin bundle), keep .spec/.config. [--hooks] also removes the hooks
  lint                  check the spec↔code graph (integrity·living·coverage·drift); when committing, gates on heavy commit-local drift
  ack <node>… --reason  stamp Spec-OK on HEAD for one or more nodes (this change keeps their specs valid); --reason required, not stored
  serve                 run the API server (default :8787). [--port N] sets the listen port (mirrors
                        dashboard --api-port, so many projects coexist on one host — cwd picks the project)
    --public --password <pw>   expose it on a public IP behind a password + self-signed TLS (no domain
                               needed). [--tls-cert F --tls-key F] for your own cert · [--http] to drop TLS
  dashboard             serve the dashboard UI on its own port (default 5173), proxying /api to a running
                        \`spex serve\`. [--port N] [--api-port N=8787]. The installed replacement for \`npm run web\`.
  board                 dump the dashboard board state as JSON
  forge <sub>           trace a forge's issues/PRs onto spec nodes (read-only): links | eval-pending [--host github] [--node <id>] [--json]
  yatsu <sub>           measure a node's scenarios and keep score: scan | eval [.|<node>] [--scenario N] (--pass|--fail) [--note T] [--image P|--result P|-] | show [.|<node>] [--json] | clean [--keep-latest|--all]
  self <sub>            diagnose how the workflow reaches THIS self-launched agent: doctor (default) | contract | conflicts
  issues                THE issue read — local forum threads + forge issues, one merged store-tagged list (the drain view)  [--node <id>] [--store local|github] [--all] [--json]
  issues promote <id>   move an OPEN local issue to the forge (one recorded action: forge issue w/ Spec: marker + evidence, local thread landed w/ permalink)
  propose "<concern>"   open a local issue in the git forum (taste, annotations, off-mainline smells all welcome)  [--node <id>…] [--evidence <hash>…] [--body -|<text>]  | reply|sign|resolve <id> …  | on|off|status
  review <SEL>          manager cockpit: review a session (ahead·merge-base diff·gates·proposal)  [--json]
  review proof <SEL>    render the session's proof of work — self-contained HTML, fully derived (diff·measured yatsu loss·gates)  [--open|--out P|--json]
  merge <SEL>           manager cockpit: gated atomic merge into main (re-checks gates, then closes)

Sessions
  ls [SEL…]             living-sessions table          [--status a,b] [--json]
  watch [SEL…]          stream actionable transitions — NEVER EXITS; run it in the BACKGROUND, don't block a turn on it (poll one-shot with \`wait\`)  [--as NAME] [--status a,b] [--idle] [--interval N]
  wait <SEL>            block until <SEL> is actionable, print it, exit (one-shot — the non-blocking counterpart to watch; draws the graph edge)  [--timeout S=1200] [--interval S]
  new "<prompt>"        start a session (= session new)  [--node X]
  session <sub>         new | reopen | done | park | ask | exit | close | send | capture | prompt
  session prompt <SEL>  print the session's originating prompt (what it was asked to do)

  SEL = session id (or id-prefix), node, or branch — accepted by every read/control verb (ls·watch·wait·
        review·merge·reopen·exit·close·send·capture·prompt); none (or @all) = every session.`)
}

// a trailing --help/-h prints the summary and exits BEFORE any verb runs, so a help probe never fires a streaming/mutating command.
if (cmd && cmd !== 'help' && (has('help') || process.argv.includes('-h'))) {
  printHelp()
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
  // the natural post-install UI: serve the bundled dashboard on its OWN loopback port, proxying /api +
  // the terminal socket to a separately-run `spex serve`. Replaces the dogfood-only `npm run web` (vite).
  const { serveDashboardLocal } = await import('./gateway.js')
  const port = Number(flag('port') ?? process.env.SPEXCODE_DASHBOARD_PORT ?? 5173)
  const apiPort = Number(flag('api-port') ?? process.env.PORT ?? 8787)
  if (!Number.isInteger(port) || !Number.isInteger(apiPort)) { console.error('spex dashboard: --port and --api-port must be integers'); process.exit(2) }
  serveDashboardLocal({ port, apiPort })
} else if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  printHelp()
} else if (cmd === 'guide') {
  const { guideText } = await import('./guide.js')
  console.log(guideText(process.argv[3]))
} else if (cmd === 'owner') {
  const { specOwners } = await import('./specs.js')
  const { loadConfig } = await import('./lint.js')
  const p = positionals(3)[0]
  if (!p) { console.error('usage: spex owner <path>'); process.exit(2) }
  const rel = p.startsWith(process.cwd()) ? p.slice(process.cwd().length + 1) : p
  const owners = specOwners(p)
  const maxOwners = loadConfig(process.cwd()).maxOwners
  if (owners.length === 0) {
    console.log(`${rel} — no spec governs this yet (uncovered). If your change is substantive, give it a home before it drifts.`)
  } else if (owners.length <= maxOwners) {
    // a sanely-owned file is NOT actionable: --actionable callers (the per-edit spec-of-file hook) stay
    // silent here, so the annotation fires only on an OVER-owned or uncovered file — rare and worth acting on.
    if (has('actionable')) process.exit(0)
    const named = owners.map((o) => `'${o.id}'`).join(', ')
    const lead = owners.length === 1 ? `${rel} is governed by ${named} — ${owners[0].desc}` : `${rel} is governed by ${named} (shared, fine).`
    console.log(`${lead} Read/honor the spec; if your change shifts the intent, update the spec in the SAME commit.`)
  } else {
    const ids = owners.map((o) => o.id).join(', ')
    console.log(`${rel} is governed by ${owners.length} specs (${ids}) — more than one file should hold. This file does TOO MUCH: SPLIT it so each governor owns its own module (or merge the nodes if they're one concern, or give it a single foundation owner + relate the rest).`)
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
  if (has('json')) { console.log(r.body); process.exit(0) }
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
  process.exit(await runForge(process.argv.slice(3)))
} else if (cmd === 'yatsu') {
  // thin route — all logic lives in spec-yatsu.
  const { runYatsu } = await import('../../spec-yatsu/src/cli.js')
  process.exit(await runYatsu(process.argv.slice(3)))
} else if (cmd === 'propose') {
  // @@@ propose - open a local issue in the git forum ([[proposals]]): a thing that felt off this session,
  // even off-mainline. Thin route; all logic (write + commit straight to the trunk, reply/sign/resolve,
  // the on|off toggle) lives in proposals.ts. `spex propose "<concern>" [--node id…] [--body -|text]`.
  const { runPropose } = await import('./proposals.js')
  process.exit(await runPropose(process.argv.slice(3)))
} else if (cmd === 'issues') {
  // @@@ issues - THE issue read ([[issues]]): local forum threads + forge issues as ONE store-tagged list,
  // the supervisor's/human's drain view. `spex issues [--node id] [--store local|github] [--all] [--json]`.
  const { runIssues } = await import('./issues.js')
  process.exit(await runIssues(process.argv.slice(3)))
} else if (cmd === 'materialize') {
  // @@@ materialize - the pay-per-change render: surface nodes → manifest + AGENTS.md/CLAUDE.md block +
  // shims + Codex trust, for cwd's project. The cheap shell gate (dispatch.sh) invokes it only on change.
  const { materialize } = await import('./materialize.js')
  console.log(`materialized — content-hash ${materialize()}`)
} else if (cmd === 'self') {
  // @@@ self - the self-diagnosis surface (spec-cli/self): does the materialized workflow actually reach
  // THIS self-launched agent? doctor reports per-layer coverage (preconditions · git-hook floor · contract ·
  // hooks+handler-existence · backend) over the same HARNESSES materialize renders through; contract prints
  // the surface:system text; env dumps raw facts. Thin route, like forge/yatsu/hooks.
  const { runSelf } = await import('./self.js')
  process.exit(await runSelf(process.argv.slice(3)))
} else if (cmd === 'board') {
  const { buildBoard } = await import('./board.js')
  console.log(JSON.stringify(await buildBoard(), null, 2))
} else if (cmd === 'trunk') {
  // @@@ trunk - print the resolved source-of-truth branch (layout.ts mainBranch(): config override →
  // the main checkout's current branch → 'main'). The pre-commit main-guard reads this so it blocks
  // direct commits on whatever the repo's trunk is actually named, never a hardcoded 'main'. One value,
  // one line, for the hook to capture; GET /api/layout exposes the same resolution.
  const { mainBranch } = await import('./layout.js')
  console.log(mainBranch())
} else if (cmd === 'search') {
  const { searchSpecs } = await import('./search.js')
  const query = positionals(3).join(' ')
  if (!query.trim()) { console.error('usage: spex search <query> [--json] [--limit N]'); process.exit(2) }
  const limit = Number(flag('limit')) || 10
  const results = await searchSpecs(query, { limit, onStats: (s) => console.error(`[spec-search] compute ${s.ms.toFixed(1)}ms · ${s.nodes} nodes · ${s.tokens} tokens (excludes process start)`) })
  if (has('json')) { console.log(JSON.stringify(results)); process.exit(0) }
  if (!results.length) { console.log(`no spec node matches "${query}"`); process.exit(0) }
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
  console.log(JSON.stringify(await createSession(flag('node') ?? null, prompt, flag('harness') ?? undefined, flag('launcher') ?? undefined), null, 2))
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
    console.log(JSON.stringify(await s.createSession(flag('node') ?? null, flag('prompt') ?? positionals(4)[0] ?? '', flag('harness') ?? undefined, flag('launcher') ?? undefined), null, 2))
  } else if (sub === 'reopen') {
    // bring the agent back up (relaunch if offline, the backend owns it); demotes a working `active` to idle but
    // leaves a standing declaration/proposal untouched (see sessions.ts reopen()). A following prompt is what works.
    const full = await resolveSelectorOrExit(id)
    console.log(await c.clientReopen(full) ? `${full} -> reopened` : `no such session ${full}`)
  } else if (sub === 'state') {
    // the agent authors ITS OWN state: active|awaiting|parked|error  [--propose] [--note] [--session]
    const st = process.argv[4] as any
    const ok = s.markState(st, { proposal: flag('propose') as any, note: flag('note'), sessionId: sess })
    console.log(ok ? `state -> ${st}` : 'no session record (unknown --session / no CLAUDE_CODE_SESSION_ID, or bad status)')
  } else if (sub === 'done') {
    // sugar for awaiting; --propose merge|nothing|close, optional --note
    const p = (flag('propose') as any) || 'nothing'
    const closeNote = p === 'close' ? CLOSE_CLEANUP : ''
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
  } else if (sub === 'prompt') {
    // print the session's full ORIGINATING prompt (what it was asked to do), captured at launch.
    const full = await resolveSelectorOrExit(id)
    const r = await c.clientPrompt(full)
    if (!r.ok) { console.error(`no prompt recorded for ${full}`); process.exit(1) }
    process.stdout.write(r.prompt.endsWith('\n') ? r.prompt : r.prompt + '\n')
  } else {
    console.error('spex session: new|reopen|done|park|ask|idle|exit|close|send|capture|prompt'); process.exit(2)
  }
} else if (cmd === 'codex-launch') {
  // BACKEND-owned codex thread. On the shared per-project app-server: thread/start { cwd = this worktree }
  // (codex loads that worktree's config/hooks/AGENTS.md), store the new id on the governed record (keyed by
  // SPEXCODE_SESSION_ID), fire the launch prompt as the FIRST turn — materializing the rollout — and print the
  // thread id. The launch script then `resume`s it in the visible TUI.
  const { codexStartThread, codexTurn } = await import('./harness.js')
  const { markHarnessSessionId } = await import('./sessions.js')
  const sock = process.argv[3], cwd = process.argv[4]
  const prompt = process.argv.slice(5).join(' ')
  if (!sock || !cwd) { console.error('usage: spex codex-launch <sock> <cwd> [prompt...]'); process.exit(2) }
  const r = await codexStartThread(sock, cwd)
  if (!r.ok) { console.error(r.error); process.exit(1) }
  const sid = process.env.SPEXCODE_SESSION_ID
  if (sid) markHarnessSessionId(sid, r.threadId)
  if (prompt) {
    const t = await codexTurn(sock, r.threadId, prompt, cwd)
    if (!t.ok) { console.error(t.error); process.exit(1) }
  }
  console.log(r.threadId)
} else if (cmd === 'codex-turn') {
  // fire a follow-up turn on an OWNED thread over the per-project socket (the delivery channel, exposed for
  // tests / scripts). steer-vs-start is chosen live from the thread read.
  const { codexTurn } = await import('./harness.js')
  const sock = process.argv[3], tid = process.argv[4], text = process.argv.slice(5).join(' ')
  if (!sock || !tid || !text) { console.error('usage: spex codex-turn <sock> <threadId> <text...>'); process.exit(2) }
  const r = await codexTurn(sock, tid, text)
  if (r.ok) { console.log('ok') } else { console.error(r.error); process.exit(1) }
} else {
  console.error(`spex: unknown command '${cmd}' (try: spex help)`)
  process.exit(2)
}
