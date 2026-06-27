// @@@ spex - the SpexCode CLI. `spex lint` checks the spec<->code graph; `spex serve` runs the API;
// `spex session …` is the worktree/session state machine (the dashboard is a thin caller of these).
export {} // make this a module so top-level await is allowed
const cmd = process.argv[2]

// @@@ fail-loud client errors - the read/control commands are backend clients (client.ts); when no backend
// is reachable they throw BackendError. Convert that (matched by name, no import) into ONE clean line + a
// non-zero exit, never a stack dump — so a down/wrong SPEXCODE_API_URL is obvious, never a silent miss.
// Registered before any await so a top-level-await rejection lands here, not in Node's default reporter.
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
const VALUE_FLAGS = new Set(['--status', '--as', '--interval', '--propose', '--note', '--node', '--prompt', '--timeout', '--reason', '--out'])
function positionals(from: number): string[] {
  const out: string[] = []
  for (let i = from; i < process.argv.length; i++) {
    const t = process.argv[i]
    if (t.startsWith('--')) { if (VALUE_FLAGS.has(t)) i++; continue }
    out.push(t)
  }
  return out
}

// @@@ watch edge - the watcher→targets session-graph edge, shared by BOTH `watch` (stream) and `wait`
// (one-shot). Running EITHER reports the edge to the backend (register + TTL heartbeat) and clears it on
// exit, so the edge exists for exactly as long as the subscription does — a supervisor blocking on
// `spex wait <worker>` is VISIBLE on the graph for the whole wait, just like a stream watch, and it clears
// the instant the wait resolves (supervision ended). Edge writes are BEST-EFFORT (fire-and-forget): the
// edge is cosmetic and must NEVER fail the underlying watch/wait when the backend is unreachable — the poll
// already needs the backend, and the TTL expires a stale edge if a killed process never deregisters. This
// is the single place edge lifecycle lives, so `watch` and `wait` are just consumption policies over it.
// @@@ watch handshake ([[comms-edge]]) - on a `spex watch` over a SPECIFIC target, tell that target who now
// supervises it, ONCE, so the connection is live in the target's context the moment the watch starts (the
// monitor edge alone tells the target nothing). Skips a global/@all watcher (never greet a whole fleet) and
// any selector that doesn't resolve to exactly one live session. Greeted-once per watch process; the
// greeting rides a plain send (NO sender id → it is the connection notice itself, not logged as agent talk).
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

// @@@ resolveSelectorOrExit - the ONE glue that turns a control verb's user SELECTOR (full id, id-prefix,
// node, or branch — the same grammar `ls`/`watch` take) into the FULL id the backend matches exactly. It
// resolves against the live board (client.ts's resolveClientSession → the shared resolveSession), and on
// anything but a clean single hit prints a precise error and exits non-zero: `none` → no such session;
// `ambiguous` → the candidate sessions. So review/merge/reopen/close/send/capture/prompt all accept selectors
// with ZERO per-command matching — the matcher lives once in [[session-selectors]]; this is present-error glue.
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

// @@@ help - tidy one-screen command summary for humans AND agents (no args or `spex help`). Grouped
// by purpose; flags shown inline so the surface is self-explanatory without reading the source.
function printHelp(): void {
  console.log(`spex — SpexCode CLI (spec↔code graph + worktree session state machine)

Usage: spex <command> [args]

Specs / graph
  guide [spec|yatsu]    no topic: the setup workflow; spec/yatsu: the file-format manual for authoring nodes
  init [dir]            scaffold a repo to adopt SpexCode (seed .spec + install git hooks; default: cwd)
  lint                  check the spec↔code graph (integrity·living·coverage·drift); when committing, gates on heavy commit-local drift
  ack <node>… --reason  stamp Spec-OK on HEAD for one or more nodes (this change keeps their specs valid); --reason required, not stored
  serve                 run the API server (http://localhost:8787)
  board                 dump the dashboard board state as JSON
  forge <sub>           trace a forge's issues/PRs onto spec nodes (read-only): links | eval-pending [--host github] [--node <id>] [--json]
  yatsu <sub>           measure a node's scenarios and keep score: scan | eval [.|<node>] [--scenario N] (--pass|--fail|--note T) [--image P|--result P|-] | show [.|<node>] [--json] | clean [--keep-latest|--all]
  hooks <sub>           harness-agnostic hook system: compile [--out <file>] (flatten surface:hook nodes into the per-session manifest the dispatcher reads)
  review <SEL>          manager cockpit: review a session (ahead·merge-base diff·gates·proposal)  [--json]
  review proof <SEL>    render the session's proof of work — self-contained HTML, fully derived (diff·measured yatsu loss·gates)  [--open|--out P|--json]
  merge <SEL>           manager cockpit: gated atomic merge into main (re-checks gates, then closes)  [--keep]

Sessions
  ls [SEL…]             living-sessions table          [--status a,b] [--json]
  watch [SEL…]          stream actionable transitions — NEVER EXITS; run it in the BACKGROUND, don't block a turn on it (poll one-shot with \`wait\`)  [--as NAME] [--status a,b] [--idle] [--interval N]
  wait <SEL>            block until <SEL> is actionable, print it, exit (one-shot — the non-blocking counterpart to watch; draws the graph edge)  [--timeout S=1200] [--interval S]
  new "<prompt>"        start a session (= session new)  [--node X]
  session <sub>         new | list | reopen | review | done | merge | exit | close | send | capture | prompt
  session prompt <SEL>  print the session's originating prompt (what it was asked to do)

  SEL = session id (or id-prefix), node, or branch — accepted by every read/control verb (ls·watch·wait·
        review·merge·reopen·exit·close·send·capture·prompt); none (or @all) = every session.`)
}

// @@@ help guard - `--help`/`-h` after ANY subcommand prints the summary and EXITS, never running the
// command. Without this the flag was an ignored no-op that fell THROUGH to the side effect: `spex watch
// --help` started a watch that never exits and BLOCKED the caller forever; `spex session new --help`
// CREATED a stray session. A help PROBE must never fire a streaming or mutating verb — the footguns the
// supervisor prompt could only warn about, fixed at the mechanism instead. (`spex help`/`spex` with no
// command keep their own paths below; this guards `cmd` + a trailing help flag.)
if (cmd && cmd !== 'help' && (has('help') || process.argv.includes('-h'))) {
  printHelp()
  process.exit(0)
}

if (cmd === 'serve') {
  // the supervisor owns the public port and runs index.ts as a child for zero-downtime reloads; it
  // (not `tsx watch`) is what watches spec-cli/src, so the package `serve` script must NOT use --watch.
  await import('./supervise.js')
} else if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  printHelp()
} else if (cmd === 'guide') {
  // @@@ guide - SpexCode's reference surface as a COMMAND, not buried docs. No topic → the human SETUP
  // workflow (install once, then an agent drives); `spec` / `yatsu` → the agent-facing file-format manual.
  // The narration lives in guide.ts (kept out of this shared hub), the help-text spirit of printHelp — not
  // a planted `.spec` template. process.argv[3] is the optional topic.
  const { guideText } = await import('./guide.js')
  console.log(guideText(process.argv[3]))
} else if (cmd === 'owner') {
  // @@@ owner - which spec node(s) GOVERN a path: the file→spec map the per-edit annotate hook (spec-of-file)
  // surfaces at the moment of an edit. Light (frontmatter only, no git walk). 0 owners → uncovered; a sanely
  // owned file (1..maxOwners) → name the owners + the contract; OVER-owned (> maxOwners) → flag the file as
  // doing too much and point at the split (see [[governed-related]]). Read-only.
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
  // stamp a `Spec-OK: <node>` trailer onto HEAD per node: "the change up to here keeps <node>'s spec valid
  // — no spec edit needed", so git.ts's drift won't count the acknowledged commits against <node>. The ack
  // is a CHECKPOINT covering ALL of a node's pending drift at or below HEAD (see driftFor), so it need NOT
  // sit on the exact commit that moved a file — land your commit(s), stack freely, then `spex ack <node>…
  // --reason "<why>"` ONCE at the tip. --amend adds the trailers to HEAD (in the same block as Session:);
  // git de-dupes identical adjacent trailers, so re-acking is harmless. One amend carries all nodes — when a
  // commit touches a SHARED file (styles.css, an i18n catalog) it acks every co-owner at once.
  //
  // @@@ forced reason - --reason is REQUIRED but deliberately NOT stored: git records only `Spec-OK:
  // <node>`, never the prose. Its whole job is to make the agent ARTICULATE why each spec still holds
  // before quieting its drift — a blind ack must cost a sentence of thought. The thinking is the gate; the
  // text is discarded (a stored reason would just invite stale boilerplate). Empty/whitespace → rejected.
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
  await specInit(positionals(3)[0])
} else if (cmd === 'review' && positionals(3)[0] === 'proof') {
  // @@@ review proof - render a session's PROOF OF WORK ([[review-proof]]): a self-contained HTML document
  // the backend builds FULLY DERIVED (the merge-base diff + the measured yatsu loss with its evidence + the
  // gates) — no agent input, generated on the fly. This is a thin backend CLIENT — it fetches the rendered
  // bytes and writes or opens them, so it works against a REMOTE backend unchanged.
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
  // @@@ review - the manager cockpit's first verb: print ONE review payload for a session (ahead, the
  // merge-base diff = its REAL changes, the merge/typecheck/lint gates, and its standing proposal) so a
  // manager can decide whether to merge without hand-running git. `--json` for the raw payload. This is
  // the human-facing INSPECT verb; `spex session review` is the distinct agent action "propose merge".
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
    console.log(`    typecheck         : ${g.typecheck.ok ? 'ok' : `${g.typecheck.errorCount} error(s)`}`)
    console.log(`    lint              : ${g.lint.errorCount} error(s), ${g.lint.warningCount} warning(s)`)
    console.log(`  diff (merge-base, ${r.diff.length} file(s)):`)
    for (const f of r.diff) console.log(`    ${f.status.padEnd(12)} +${f.additions} -${f.deletions}  ${f.path}`)
  }
} else if (cmd === 'merge') {
  // @@@ merge - the cockpit's ACT verb (review's sequel), a DISPATCH not a server merge: it reopens the
  // session and hands the session's OWN agent the merge prompt — the agent runs the --no-ff merge, resolves
  // conflicts, verifies main advanced, and proposes close. The server never touches main. Fail-loud: an
  // unreachable agent prints the reason and exits non-zero.
  const { clientMerge } = await import('./client.js')
  const sel = positionals(3)[0]
  if (!sel) { console.error('usage: spex merge <selector>  (id | id-prefix | node | branch)'); process.exit(2) }
  const id = await resolveSelectorOrExit(sel)
  const r = await clientMerge(id)
  if (r.dispatched) console.log(`merge dispatched to ${id} — its agent is landing the merge`)
  else console.error(`merge dispatch failed: ${r.reason}`)
  process.exit(r.dispatched ? 0 : 1)
} else if (cmd === 'forge') {
  // @@@ forge - the spec-forge link tracer on this CLI: read a forge's open issues/PRs and resolve each to
  // the spec node it serves (read-only — a node's status stays git-derived). Logic lives in spec-forge;
  // this is just routing. `spex forge links [--host github] [--node <id>] [--json]`.
  const { runForge } = await import('../../spec-forge/src/cli.js')
  process.exit(await runForge(process.argv.slice(3)))
} else if (cmd === 'yatsu') {
  // @@@ yatsu - the eval/loss engine on this CLI (the same thin-route shape as `forge`): a lazy import of
  // runYatsu, handed the arg slice after `yatsu`. All logic — yatsu.md scenarios, the readings sidecar,
  // git-derived freshness, the blob cache — lives in spec-yatsu; this is just routing.
  const { runYatsu } = await import('../../spec-yatsu/src/cli.js')
  process.exit(await runYatsu(process.argv.slice(3)))
} else if (cmd === 'hooks') {
  // @@@ hooks - compile the surface:hook nodes into the per-session manifest the (pure-shell) dispatcher
  // reads. Thin route, like forge/yatsu. `spex hooks compile [--out <file>]`. Logic in hooks.ts.
  const { runHooks } = await import('./hooks.js')
  process.exit(await runHooks(process.argv.slice(3)))
} else if (cmd === 'board') {
  const { buildBoard } = await import('./board.js')
  console.log(JSON.stringify(await buildBoard(), null, 2))
} else if (cmd === 'search') {
  // @@@ search - the lexical retrieval floor ([[spec-search]]): rank spec NODES by term overlap for a
  // natural-language query and return { id, title, path, score, snippet }. `--json` prints that array
  // verbatim (the surface spec-scout's `--deep` and the spec→code relay reuse); default is a pretty list.
  // Thin router: all scoring lives in search.ts so every consumer shares one implementation.
  const { searchSpecs } = await import('./search.js')
  const query = positionals(3).join(' ')
  if (!query.trim()) { console.error('usage: spex search <query> [--json] [--limit N]'); process.exit(2) }
  const limit = Number(flag('limit')) || 10
  // @@@ compute timing - emit the PURE search-compute time (search.ts only — excludes this process's startup
  // and the lazy import above) to stderr on every call, so --json's stdout stays the clean contract array
  // while we can still track the cost. Tracked baseline lives in [[spec-search]]'s yatsu; alarm near ~1s.
  const results = await searchSpecs(query, { limit, onStats: (s) => console.error(`[spec-search] compute ${s.ms.toFixed(1)}ms · ${s.nodes} nodes · ${s.tokens} tokens (excludes process start)`) })
  if (has('json')) { console.log(JSON.stringify(results)); process.exit(0) }
  if (!results.length) { console.log(`no spec node matches "${query}"`); process.exit(0) }
  results.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.title}  [${r.id}]  ·  score ${r.score}`)
    console.log(`    ${r.path}`)
    if (r.snippet) console.log(`    ${r.snippet}`)
  })
  process.exit(0)
} else if (cmd === 'relay') {
  // @@@ relay - spec→code: the floor's top hits, each with its governed `code:` files, so an agent jumps
  // topic→spec→code in one call ([[relay]]). Reuses search.ts's ranking; --json for machine use, else a list.
  const { relaySearch } = await import('./relay.js')
  const query = positionals(3).join(' ')
  if (!query.trim()) { console.error('usage: spex relay <query> [--json] [--limit N]'); process.exit(2) }
  const limit = Number(flag('limit')) || 3
  const hits = await relaySearch(query, { limit })
  if (has('json')) { console.log(JSON.stringify(hits)); process.exit(0) }
  if (!hits.length) { console.log(`no spec node matches "${query}"`); process.exit(0) }
  hits.forEach((h, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${h.title}  [${h.id}]  ·  score ${h.score}`)
    if (h.code.length) h.code.forEach((c) => console.log(`    ${c}`))
    else console.log(`    (no governed code: files — a pure-prose node)`)
  })
  process.exit(0)
} else if (cmd === 'ls' || cmd === 'sessions') {
  // pretty list of living sessions + states. `spex ls [SEL...] [--status a,b] [--json]`
  // the board comes from the backend (so `spex ls` shows the sessions of whatever SPEXCODE_API_URL points at,
  // incl. a remote machine); selectSessions/formatTable are pure presentation, applied client-side.
  const { selectSessions, formatTable } = await import('./sessions.js')
  const { clientListSessions } = await import('./client.js')
  const picked = selectSessions(await clientListSessions(), positionals(3), flag('status')?.split(','))
  console.log(has('json') ? JSON.stringify(picked, null, 2) : formatTable(picked))
} else if (cmd === 'watch') {
  // @@@ watch = the STREAMING subscription (a human's monitor). `spex watch [SEL...] [--status a,b]
  // [--as NAME] [--idle] [--interval N]` streams one line per actionable transition, FOREVER — it never
  // exits, so don't block a turn on it (that's what `spex wait` is for). withWatchEdge draws the
  // watcher→targets graph edge for as long as it runs (empty/@all selectors = a global watcher → every
  // session). watch and wait are two consumption policies over the SAME poll loop + edge lifecycle.
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
  // @@@ wait = the ONE-SHOT subscription (an agent's event loop). `spex wait <id> [--timeout S] [--interval
  // S] [--idle]` polls the SAME board until <id> reaches an actionable status, prints that status, and
  // EXITS — an agent backgrounds it and the harness re-invokes when the command exits, so the exit IS the
  // wake-up. Like `watch`, it draws the watcher→<id> graph edge via withWatchEdge for as long as it blocks
  // (so supervision is VISIBLE, not an invisible spin) and clears it the instant the wait resolves. The emit
  // is a no-op — a backgrounded wait wants a single clean status line on exit, not the streamed transitions.
  // GUARANTEED to terminate: the `--timeout` (default 1200s) deadline is checked every poll (see
  // watchSessions), so a target stuck in any non-actionable state can never hang the caller.
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
  console.log(JSON.stringify(await createSession(flag('node') ?? null, prompt), null, 2))
} else if (cmd === 'session') {
  const sub = process.argv[3]
  // `s` (sessions.ts) backs the state PRODUCERS that stay local (state/done/park/fail/ask/idle/commit-gate
  // write the cwd .session) and `new` (its own launch path). `c` (client.ts) backs the read/control subs that
  // route through the backend — exactly the split the refactor draws. Both lazily imported here.
  const s = await import('./sessions.js')
  const c = await import('./client.js')
  const id = process.argv[4]
  // @@@ declaredNote - appended to a successful done/ask/block declaration. The agent often wants to
  // self-verify the write, but the mark-active PreToolUse hook rewrites .session back to `active` BEFORE
  // the next tool runs (by design — see [[state]] / mark-active.sh), so any re-read shows `active`, never
  // the state just written. We STATE that fact rather than commanding "stop", so the agent can reason on
  // its own that the dashboard — not a follow-up tool call — is where this declaration is seen.
  const DECLARED = ' — recorded; the human sees it in the dashboard. Your next tool call resets this worktree to active (the mark-active hook, by design), so re-reading .session won\'t reflect it.'
  if (sub === 'new') {
    // route through the backend (auth env + concurrency cap); in-process only if no backend is reachable.
    console.log(JSON.stringify(await s.createSession(flag('node') ?? null, flag('prompt') ?? ''), null, 2))
  } else if (sub === 'list') {
    console.log(JSON.stringify(await c.clientListSessions(), null, 2))
  } else if (sub === 'reopen' || sub === 'resume') {
    // "back to working": clear proposal -> active, relaunch if offline (the backend owns the relaunch)
    const full = await resolveSelectorOrExit(id)
    console.log(await c.clientReopen(full) ? `${full} -> working` : `no such session ${full}`)
  } else if (sub === 'review') {
    console.log(await s.propose(id, 'merge') ? `${id} -> review` : `no such session ${id}`)
  } else if (sub === 'state') {
    // the agent authors ITS OWN state (from cwd): active|awaiting|parked|error  [--propose] [--note]
    const st = process.argv[4] as any
    const ok = s.markStateFromCwd(st, { proposal: flag('propose') as any, note: flag('note') })
    console.log(ok ? `state -> ${st}` : 'no .session in cwd (or bad status)')
  } else if (sub === 'done') {
    // sugar for awaiting; --propose merge|nothing|close, optional --note
    const p = (flag('propose') as any) || 'nothing'
    console.log(s.markStateFromCwd('awaiting', { proposal: p, note: flag('note') }) ? `done (${p})${DECLARED}` : 'no .session in cwd')
  } else if (sub === 'park') {
    // sugar: the agent is waiting on a background task; it will self-resume (NOT idle/awaiting)
    console.log(s.markStateFromCwd('parked', { note: flag('note') }) ? `parked${DECLARED}` : 'no .session in cwd')
  } else if (sub === 'fail') {
    // the StopFailure hook marks ITS OWN worktree (from cwd) as error (turn died on an API error)
    console.log(s.markStateFromCwd('error') ? 'marked error' : 'no .session in cwd')
  } else if (sub === 'ask') {
    // the agent DELIBERATELY declares it is pausing to ask the human a question (like `done`/`park`, an
    // authored state — NOT guarded active-only). The --note carries the question. Distinct from `park`
    // (waiting on a background task, self-resumes): an asking agent resumes only when the human replies.
    console.log(s.markStateFromCwd('asking', { note: flag('note') }) ? `asking${DECLARED}` : 'no .session in cwd')
  } else if (sub === 'commit-gate') {
    // the Stop gate's deterministic commit check (from cwd = the worktree): exit 0 if the node branch is
    // ready to declare done/merge (work committed + ahead of main), else print the reason and exit 1. Uses
    // git() so the hook's exported GIT_DIR/GIT_INDEX_FILE don't misdirect repo discovery (see git.ts).
    const r = s.mergeReadiness()
    if (r.ready) { console.log('ready'); process.exit(0) }
    console.log(r.reason)
    process.exit(1)
  } else if (sub === 'idle') {
    // the Notification(idle_prompt) hook marks ITS OWN worktree (from cwd) idle when claude waits at its
    // prompt. INFERRED, so guarded active-only: it no-ops unless the current status is exactly `active`,
    // never clobbering a deliberate awaiting/asking/parked/error declaration. Distinct from `ask`
    // (the agent deliberately asking the human) — idle is the undeclared stop the Stop gate missed.
    console.log(s.markIdleFromCwd() ? 'idle' : 'noop (no .session in cwd, or not active)')
  } else if (sub === 'merge') {
    // merge dispatch (same as top-level `spex merge`): reopen the session and hand its OWN agent the merge
    // prompt — the agent runs the --no-ff merge, resolves conflicts, verifies main advanced, and proposes
    // close. The SERVER never touches main. Fail-loud: an unreachable agent prints the reason, exits non-zero.
    const full = await resolveSelectorOrExit(id)
    const r = await c.clientMerge(full)
    if (r.dispatched) console.log(`merge dispatched to ${full} — its agent is landing the merge`)
    else console.error(`merge dispatch failed: ${r.reason}`)
    process.exit(r.dispatched ? 0 : 1)
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
    // ownSessionId from CLAUDE_CODE_SESSION_ID / cwd .session) + a one-line reply hint into the delivered
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
    console.error('spex session: new|list|reopen|review|done|park|ask|idle|merge|exit|close|send|capture|prompt'); process.exit(2)
  }
} else {
  console.error(`spex: unknown command '${cmd}' (try: spex help)`)
  process.exit(2)
}
