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
const VALUE_FLAGS = new Set(['--status', '--as', '--interval', '--propose', '--note', '--node', '--prompt', '--timeout', '--reason'])
function positionals(from: number): string[] {
  const out: string[] = []
  for (let i = from; i < process.argv.length; i++) {
    const t = process.argv[i]
    if (t.startsWith('--')) { if (VALUE_FLAGS.has(t)) i++; continue }
    out.push(t)
  }
  return out
}

// @@@ help - tidy one-screen command summary for humans AND agents (no args or `spex help`). Grouped
// by purpose; flags shown inline so the surface is self-explanatory without reading the source.
function printHelp(): void {
  console.log(`spex — SpexCode CLI (spec↔code graph + worktree session state machine)

Usage: spex <command> [args]

Specs / graph
  guide                 print the product setup workflow (install the CLI, adopt a repo, run it)
  init [dir]            scaffold a repo to adopt SpexCode (seed .spec + install git hooks; default: cwd)
  lint                  check the spec↔code graph (integrity·living·coverage·drift); when committing, gates on heavy commit-local drift
  ack <node>… --reason  stamp Spec-OK on HEAD for one or more nodes (this change keeps their specs valid); --reason required, not stored
  serve                 run the API server (http://localhost:8787)
  board                 dump the dashboard board state as JSON
  forge <sub>           trace a forge's issues/PRs onto spec nodes (read-only): links | eval-pending [--host github] [--node <id>] [--json]
  yatsu <sub>           the eval/loss engine over the readings sidecar: scan | eval [.|<node>] [--force] [--image P] | clean [--keep-latest|--all]
  review <id>           manager cockpit: review a session (ahead·merge-base diff·gates·proposal)  [--json]
  merge <id>            manager cockpit: gated atomic merge into main (re-checks gates, then closes)  [--keep]

Sessions
  ls [SEL…]             living-sessions table          [--status a,b] [--json]
  watch [SEL…]          stream actionable transitions  [--as NAME] [--status a,b] [--idle] [--interval N]
  new "<prompt>"        start a session (= session new)  [--node X]
  session <sub>         new | list | reopen | review | done | merge | close | send | capture | prompt
  session prompt <id>   print the session's originating prompt (what it was asked to do)

  SEL = session id (or id-prefix), node, or branch; none (or @all) = every session.`)
}

if (cmd === 'serve') {
  // the supervisor owns the public port and runs index.ts as a child for zero-downtime reloads; it
  // (not `tsx watch`) is what watches spec-cli/src, so the package `serve` script must NOT use --watch.
  await import('./supervise.js')
} else if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  printHelp()
} else if (cmd === 'guide') {
  // @@@ guide - the product onboarding surface as a COMMAND, not buried docs. The model is "install the
  // CLI once, then the agent drives the rest": the human's only real manual step is the global install
  // (and pointing at a repo); spec nodes, the dashboard wiring, and the dogfood ritual are an agent's job.
  // Narrative text lives here like printHelp + init's next-steps (help, not a planted contract — so it is
  // not a `.spec` template). Each step names the real seam: cwd picks the repo, PORT/API_URL pick endpoints.
  console.log(`spex guide — run SpexCode on your own repo

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

From here, dispatch an agent — it authors the spec nodes and rides the dogfood ritual for you.`)
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
  // stamp a `Spec-OK: <node>` trailer onto HEAD per node: "this code change keeps <node>'s spec valid —
  // no spec edit needed", so git.ts's drift won't count this implementation-only commit against <node>.
  // Workflow: land the code commit, then `spex ack <node>… --reason "<why>"`. --amend rewrites HEAD adding
  // the trailers (in the same block as Session:); git de-dupes identical adjacent trailers, so re-acking
  // is harmless. One amend carries all nodes — when a commit touches a SHARED file (styles.css, an i18n
  // catalog) it acks every co-owner at once.
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
} else if (cmd === 'review') {
  // @@@ review - the manager cockpit's first verb: print ONE review payload for a session (ahead, the
  // merge-base diff = its REAL changes, the merge/typecheck/lint gates, and its standing proposal) so a
  // manager can decide whether to merge without hand-running git. `--json` for the raw payload. This is
  // the human-facing INSPECT verb; `spex session review` is the distinct agent action "propose merge".
  const { clientReview } = await import('./client.js')
  const id = positionals(3)[0]
  if (!id) { console.error('usage: spex review <session-id>'); process.exit(2) }
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
  const id = positionals(3)[0]
  if (!id) { console.error('usage: spex merge <id>'); process.exit(2) }
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
} else if (cmd === 'board') {
  const { buildBoard } = await import('./board.js')
  console.log(JSON.stringify(await buildBoard(), null, 2))
} else if (cmd === 'ls' || cmd === 'sessions') {
  // pretty list of living sessions + states. `spex ls [SEL...] [--status a,b] [--json]`
  // the board comes from the backend (so `spex ls` shows the sessions of whatever SPEXCODE_API_URL points at,
  // incl. a remote machine); selectSessions/formatTable are pure presentation, applied client-side.
  const { selectSessions, formatTable } = await import('./sessions.js')
  const { clientListSessions } = await import('./client.js')
  const picked = selectSessions(await clientListSessions(), positionals(3), flag('status')?.split(','))
  console.log(has('json') ? JSON.stringify(picked, null, 2) : formatTable(picked))
} else if (cmd === 'watch') {
  // subscribe to session events (one line per actionable transition) — the Monitor event source.
  // `spex watch [SEL...] [--status a,b] [--as NAME] [--idle] [--interval N]`. Each watch = one subscriber.
  // @@@ monitor → graph edge - running this IS what creates a session-graph edge: we report watcher→targets
  // to the backend (register + heartbeat) for as long as this process lives, and deregister on exit, so the
  // edge exists ONLY while the watch runs. watcher = our OWN session id; selectors = the targets (empty/@all
  // = a global watcher → every session). All best-effort: a down backend never breaks the event stream.
  const { watchSessions, ownSessionId, reportWatch, reportUnwatch } = await import('./sessions.js')
  const { clientListSessions } = await import('./client.js')
  const { randomUUID } = await import('node:crypto')
  const selectors = positionals(3)
  const intervalMs = (Number(flag('interval')) || 5) * 1000
  const watcher = ownSessionId()
  if (watcher) {
    const token = randomUUID()
    const ttlMs = intervalMs * 3   // tolerate two missed heartbeats before the edge is dropped
    void reportWatch(token, watcher, selectors, ttlMs)
    const hb = setInterval(() => void reportWatch(token, watcher, selectors, ttlMs), intervalMs)
    const off = async () => { clearInterval(hb); await reportUnwatch(token); process.exit(0) }
    process.once('SIGINT', off); process.once('SIGTERM', off)
  }
  await watchSessions((line) => console.log(line), {
    source: clientListSessions,   // poll the backend, so watch streams the (possibly remote) backend's board
    selectors,
    statuses: flag('status')?.split(','),
    includeIdle: has('idle'),
    as: flag('as'),
    intervalMs,
  })
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
  if (sub === 'new') {
    // route through the backend (auth env + concurrency cap); in-process only if no backend is reachable.
    console.log(JSON.stringify(await s.createSession(flag('node') ?? null, flag('prompt') ?? ''), null, 2))
  } else if (sub === 'list') {
    console.log(JSON.stringify(await c.clientListSessions(), null, 2))
  } else if (sub === 'reopen' || sub === 'resume') {
    // "back to working": clear proposal -> active, relaunch if offline (the backend owns the relaunch)
    console.log(await c.clientReopen(id) ? `${id} -> working` : `no such session ${id}`)
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
    console.log(s.markStateFromCwd('awaiting', { proposal: p, note: flag('note') }) ? `done (${p})` : 'no .session in cwd')
  } else if (sub === 'park') {
    // sugar: the agent is waiting on a background task; it will self-resume (NOT idle/awaiting)
    console.log(s.markStateFromCwd('parked', { note: flag('note') }) ? 'parked' : 'no .session in cwd')
  } else if (sub === 'fail') {
    // the StopFailure hook marks ITS OWN worktree (from cwd) as error (turn died on an API error)
    console.log(s.markStateFromCwd('error') ? 'marked error' : 'no .session in cwd')
  } else if (sub === 'ask') {
    // the agent DELIBERATELY declares it is pausing to ask the human a question (like `done`/`park`, an
    // authored state — NOT guarded active-only). The --note carries the question. Distinct from `park`
    // (waiting on a background task, self-resumes): an asking agent resumes only when the human replies.
    console.log(s.markStateFromCwd('asking', { note: flag('note') }) ? 'asking' : 'no .session in cwd')
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
    const r = await c.clientMerge(id)
    if (r.dispatched) console.log(`merge dispatched to ${id} — its agent is landing the merge`)
    else console.error(`merge dispatch failed: ${r.reason}`)
    process.exit(r.dispatched ? 0 : 1)
  } else if (sub === 'close') {
    console.log(await c.clientClose(id) ? `closed ${id}` : `no such session ${id}`)
  } else if (sub === 'send') {
    // prompt dispatch is socket-only + fail-loud (the backend enforces it): a non-accepted prompt prints the
    // reason AND exits non-zero, so a manager/script never mistakes a dead dispatch for success.
    const r = await c.clientSend(id, process.argv[5] ?? '')
    console.log(r.ok ? 'sent' : `dispatch failed: ${r.error}`)
    process.exit(r.ok ? 0 : 1)
  } else if (sub === 'capture') {
    // the session's live pane (output) over HTTP — fail and empty stay DISTINCT: a real empty pane prints
    // nothing and exits 0; unknown id / offline / capture-error each exit non-zero with a named reason.
    const r = await c.clientCapture(id)
    if (r.ok) { process.stdout.write(r.pane) }
    else { console.error(`spex capture: ${r.reason}`); process.exit(r.status === 404 ? 2 : 1) }
  } else if (sub === 'prompt') {
    // print the session's full ORIGINATING prompt (what it was asked to do), captured at launch.
    const r = await c.clientPrompt(id)
    if (!r.ok) { console.error(`no prompt recorded for ${id}`); process.exit(1) }
    process.stdout.write(r.prompt.endsWith('\n') ? r.prompt : r.prompt + '\n')
  } else {
    console.error('spex session: new|list|reopen|review|done|park|ask|idle|merge|close|send|capture|prompt'); process.exit(2)
  }
} else {
  console.error(`spex: unknown command '${cmd}' (try: spex help)`)
  process.exit(2)
}
