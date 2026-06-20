// @@@ spex - the SpexCode CLI. `spex lint` checks the spec<->code graph; `spex serve` runs the API;
// `spex session …` is the worktree/session state machine (the dashboard is a thin caller of these).
export {} // make this a module so top-level await is allowed
const cmd = process.argv[2]

// tiny flag reader: --key value  (and bare positionals)
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)
// bare positionals after argv index `from`, skipping flags and their values (selectors for ls/watch).
const VALUE_FLAGS = new Set(['--status', '--as', '--interval', '--propose', '--note', '--node', '--prompt'])
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
  lint                  check the spec↔code graph (integrity·living·coverage·drift)
  ack <node>            stamp Spec-OK:<node> trailer on HEAD (this code change keeps <node>'s spec valid)
  serve                 run the API server (http://localhost:8787)
  board                 dump the dashboard board state as JSON

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
} else if (cmd === 'lint') {
  const { specLint } = await import('./lint.js')
  const findings = await specLint()
  const errors = findings.filter((f) => f.level === 'error')
  for (const f of findings) console.error(`  ${f.level === 'error' ? '✗' : '•'} ${f.rule}: ${f.msg}`)
  console.error(`spex lint: ${errors.length} error(s), ${findings.length - errors.length} warning(s)`)
  process.exit(errors.length ? 1 : 0)
} else if (cmd === 'ack') {
  // stamp a `Spec-OK: <node>` trailer onto HEAD: "this code change keeps <node>'s spec valid — no spec
  // edit needed", so git.ts's drift won't count this implementation-only commit against <node>. Workflow:
  // land the code commit, then `spex ack <node>`. --amend rewrites HEAD adding the trailer (it sits in
  // the same block as Session:); git de-dupes an identical adjacent trailer, so re-acking is harmless.
  const { git } = await import('./git.js')
  const node = positionals(3)[0]
  if (!node) { console.error('usage: spex ack <node-id>'); process.exit(2) }
  try {
    git(['commit', '--amend', '--no-edit', '--trailer', `Spec-OK: ${node}`])
    console.log(`Spec-OK: ${node} → ${git(['rev-parse', '--short', 'HEAD']).trim()}`)
  } catch (e: any) {
    console.error(`ack failed: ${e?.message ?? e}`); process.exit(1)
  }
} else if (cmd === 'board') {
  const { buildBoard } = await import('./board.js')
  console.log(JSON.stringify(await buildBoard(), null, 2))
} else if (cmd === 'ls' || cmd === 'sessions') {
  // pretty list of living sessions + states. `spex ls [SEL...] [--status a,b] [--json]`
  const { listSessions, selectSessions, formatTable } = await import('./sessions.js')
  const picked = selectSessions(await listSessions(), positionals(3), flag('status')?.split(','))
  console.log(has('json') ? JSON.stringify(picked, null, 2) : formatTable(picked))
} else if (cmd === 'watch') {
  // subscribe to session events (one line per actionable transition) — the Monitor event source.
  // `spex watch [SEL...] [--status a,b] [--as NAME] [--idle] [--interval N]`. Each watch = one subscriber.
  // @@@ monitor → graph edge - running this IS what creates a session-graph edge: we report watcher→targets
  // to the backend (register + heartbeat) for as long as this process lives, and deregister on exit, so the
  // edge exists ONLY while the watch runs. watcher = our OWN session id; selectors = the targets (empty/@all
  // = a global watcher → every session). All best-effort: a down backend never breaks the event stream.
  const { watchSessions, ownSessionId, reportWatch, reportUnwatch } = await import('./sessions.js')
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
    selectors,
    statuses: flag('status')?.split(','),
    includeIdle: has('idle'),
    as: flag('as'),
    intervalMs,
  })
} else if (cmd === 'new') {
  // shorthand for `spex session new`: spex new "<prompt>" [--node X]  (prompt = first positional or --prompt)
  const { newSession } = await import('./sessions.js')
  const prompt = flag('prompt') ?? positionals(3)[0] ?? ''
  console.log(JSON.stringify(await newSession(flag('node') ?? null, prompt), null, 2))
} else if (cmd === 'session') {
  const sub = process.argv[3]
  const s = await import('./sessions.js')
  const id = process.argv[4]
  if (sub === 'new') {
    console.log(JSON.stringify(await s.newSession(flag('node') ?? null, flag('prompt') ?? ''), null, 2))
  } else if (sub === 'list') {
    console.log(JSON.stringify(await s.listSessions(), null, 2))
  } else if (sub === 'reopen' || sub === 'resume') {
    // "back to working": clear proposal -> active, relaunch if offline
    console.log(await s.reopen(id) ? `${id} -> working` : `no such session ${id}`)
  } else if (sub === 'review') {
    console.log(await s.propose(id, 'merge') ? `${id} -> review` : `no such session ${id}`)
  } else if (sub === 'state') {
    // the agent authors ITS OWN state (from cwd): active|awaiting|blocked|error  [--propose] [--note]
    const st = process.argv[4] as any
    const ok = s.markStateFromCwd(st, { proposal: flag('propose') as any, note: flag('note') })
    console.log(ok ? `state -> ${st}` : 'no .session in cwd (or bad status)')
  } else if (sub === 'done') {
    // sugar for awaiting; --propose merge|nothing|close, optional --note
    const p = (flag('propose') as any) || 'nothing'
    console.log(s.markStateFromCwd('awaiting', { proposal: p, note: flag('note') }) ? `done (${p})` : 'no .session in cwd')
  } else if (sub === 'block') {
    // sugar: the agent is waiting on a background task; it will self-resume (NOT idle/awaiting)
    console.log(s.markStateFromCwd('blocked', { note: flag('note') }) ? 'blocked' : 'no .session in cwd')
  } else if (sub === 'fail') {
    // the StopFailure hook marks ITS OWN worktree (from cwd) as error (turn died on an API error)
    console.log(s.markStateFromCwd('error') ? 'marked error' : 'no .session in cwd')
  } else if (sub === 'ask') {
    // the agent DELIBERATELY declares it is pausing to ask the human a question (like `done`/`block`, an
    // authored state — NOT guarded active-only). The --note carries the question. Distinct from `block`
    // (waiting on a background task, self-resumes): a needs-input agent resumes only when the human replies.
    console.log(s.markStateFromCwd('needs-input', { note: flag('note') }) ? 'needs-input' : 'no .session in cwd')
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
    // never clobbering a deliberate awaiting/needs-input/blocked/error declaration. Distinct from `ask`
    // (the agent deliberately asking the human) — idle is the undeclared stop the Stop gate missed.
    console.log(s.markIdleFromCwd() ? 'idle' : 'noop (no .session in cwd, or not active)')
  } else if (sub === 'merge') {
    // merge is now a DISPATCH: the session's own agent runs git, resolves conflicts, and verifies the
    // merge — the server never touches main's tree. Success here means the merge prompt reached the agent.
    const r = await s.mergeSession(id)
    console.log(r.ok ? `${id}: merge dispatched to the session's agent (it performs & verifies the merge)` : `merge failed: ${r.error}`)
    process.exit(r.ok ? 0 : 1)
  } else if (sub === 'close') {
    console.log(await s.closeSession(id) ? `closed ${id}` : `no such session ${id}`)
  } else if (sub === 'send') {
    // prompt dispatch is socket-only + fail-loud: a non-accepted prompt prints the reason AND exits
    // non-zero, so a manager/script never mistakes a dead dispatch for success.
    const r = await s.sendKeys(id, process.argv[5] ?? '')
    console.log(r.ok ? 'sent' : `dispatch failed: ${r.error}`)
    process.exit(r.ok ? 0 : 1)
  } else if (sub === 'capture') {
    process.stdout.write(await s.captureSession(id))   // the session's live pane (output), for agents
  } else if (sub === 'prompt') {
    // print the session's full ORIGINATING prompt (what it was asked to do), captured at launch.
    const p = await s.sessionPrompt(id)
    if (p == null) { console.error(`no prompt recorded for ${id}`); process.exit(1) }
    process.stdout.write(p.endsWith('\n') ? p : p + '\n')
  } else {
    console.error('spex session: new|list|reopen|review|done|block|ask|idle|merge|close|send|capture|prompt'); process.exit(2)
  }
} else {
  console.error(`spex: unknown command '${cmd}' (try: spex help)`)
  process.exit(2)
}
