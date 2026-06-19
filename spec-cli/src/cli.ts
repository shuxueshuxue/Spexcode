// @@@ spex - the SpexCode CLI. `spex lint` checks the spec<->code graph; `spex serve` runs the API;
// `spex session …` is the worktree/session state machine (the dashboard is a thin caller of these).
export {} // make this a module so top-level await is allowed
const cmd = process.argv[2]

// tiny flag reader: --key value  (and bare positionals)
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
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
  } else if (sub === 'done') {
    // an agent marks ITS OWN worktree (from cwd) as awaiting; --propose merge|nothing|close
    const p = (flag('propose') as any) || 'nothing'
    console.log(s.markDoneFromCwd(p) ? `marked done (${p})` : 'no .session in cwd')
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
