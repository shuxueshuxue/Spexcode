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

if (cmd === undefined || cmd === 'serve') {
  await import('./index.js')
} else if (cmd === 'lint') {
  const { specLint } = await import('./lint.js')
  const findings = specLint()
  const errors = findings.filter((f) => f.level === 'error')
  for (const f of findings) console.error(`  ${f.level === 'error' ? '✗' : '•'} ${f.rule}: ${f.msg}`)
  console.error(`spex lint: ${errors.length} error(s), ${findings.length - errors.length} warning(s)`)
  process.exit(errors.length ? 1 : 0)
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
  const { watchSessions } = await import('./sessions.js')
  await watchSessions((line) => console.log(line), {
    selectors: positionals(3),
    statuses: flag('status')?.split(','),
    includeIdle: has('idle'),
    as: flag('as'),
    intervalMs: (Number(flag('interval')) || 5) * 1000,
  })
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
  } else if (sub === 'merge') {
    const r = await s.mergeSession(id); console.log(r.ok ? `${id} merged (×${r.merges})` : `merge failed: ${r.error}`)
    process.exit(r.ok ? 0 : 1)
  } else if (sub === 'close') {
    console.log(await s.closeSession(id) ? `closed ${id}` : `no such session ${id}`)
  } else if (sub === 'send') {
    console.log(await s.sendKeys(id, process.argv[5] ?? '', true) ? 'sent' : `not live ${id}`)
  } else if (sub === 'capture') {
    process.stdout.write(await s.captureSession(id))   // the session's live pane (output), for agents
  } else {
    console.error('spex session: new|list|reopen|review|done|merge|close|send|capture'); process.exit(2)
  }
} else {
  console.error(`spex: unknown command '${cmd}' (try: lint, serve, session)`)
  process.exit(2)
}
