import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createConnection } from 'node:net'
import { opencodePluginSource, OPENCODE_TOOL_NAMES } from './opencode.js'
import { HARNESSES, harnessById, opencodeHarness, opencodeLaunchCommand, deliverViaRendezvous, rvSock } from './harness.js'

// [[opencode-harness]] — the MECHANICAL layer: the adapter surface, the tail-branching launch script, and the
// generated plugin's two roles (hook bridge → dispatch.sh with claude-SHAPED payloads; rendezvous daemon the
// claude deliver talks to VERBATIM). A real `opencode` launch needs model credentials and stays an e2e item;
// everything here runs the generated artifacts with stubs, no opencode binary involved.

test('adapter surface: third native harness, claude-family runtime facts', () => {
  assert.deepEqual(HARNESSES.map((h) => h.id), ['claude', 'codex', 'opencode', 'pi'])
  const h = harnessById('opencode')
  assert.equal(h, opencodeHarness)
  assert.equal(h.ownsRendezvous, true)                       // the generated plugin binds the rendezvous socket
  assert.equal(h.sessionIdArg('x'), '')                      // opencode mints its own id (capture, not pin)
  assert.equal(h.worktreeHookAnchor('/any/worktree'), null)  // project plugins self-anchor like claude's shim
  assert.equal(h.shimFile('/p'), join('/p', '.opencode', 'plugins', 'spexcode.ts'))
  assert.deepEqual(h.contractFiles('/p'), [join('/p', 'AGENTS.md')])
  assert.equal(h.skillDir('/p'), join('/p', '.opencode', 'skills'))
  assert.equal(h.agentDir('/p'), join('/p', '.opencode', 'agents'))
  assert.equal(h.resumeArg({ session: 's', harnessSessionId: 'oc_1' }), '--resume oc_1')
  assert.equal(h.resumeArg({ session: 's' }), '--continue')  // never captured → opencode's own last-session resume
})

test('liveness: socket listener preferred, agent.pid fallback (a plugin that failed to load still reads honestly)', () => {
  const rec = { session: 'x' }
  assert.equal(opencodeHarness.liveness(rec, true, undefined, { pidAlive: false }, true), 'online')    // socket wins
  assert.equal(opencodeHarness.liveness(rec, true, undefined, { pidAlive: true }, false), 'online')    // pid rescues a socketless plugin
  assert.equal(opencodeHarness.liveness(rec, true, undefined, { pidAlive: false }, false), 'offline')
  assert.equal(opencodeHarness.liveness(rec, true, undefined, {}, false), 'offline')                   // no probe data is not-live
  assert.equal(opencodeHarness.liveness(rec, false, undefined, { pidAlive: true }, true), 'offline')   // no window is dead
})

test('launch script: prompt tail → --prompt; --resume marker → --session; --continue marker; empty → bare TUI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-oc-launch-'))
  const stub = join(dir, 'opencode')
  // the stub also prints the resume env markers so the seeding contract is pinned here: a --resume
  // relaunch must hand the plugin the owned id (SPEXCODE_OPENCODE_RESUME_ID), a --continue relaunch the
  // continue flag — a resumed session fires no bus event, so the env is the plugin's only adoption seed.
  writeFileSync(stub, '#!/usr/bin/env bash\necho "STUB:$* rid=${SPEXCODE_OPENCODE_RESUME_ID:-} cont=${SPEXCODE_OPENCODE_CONTINUE:-}"\n')
  chmodSync(stub, 0o755)
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }
  delete (env as Record<string, string | undefined>).SPEXCODE_OPENCODE_RESUME_ID
  delete (env as Record<string, string | undefined>).SPEXCODE_OPENCODE_CONTINUE
  const run = (tail: string) =>
    execFileSync('bash', ['-c', `${opencodeLaunchCommand('opencode --auto')} ${tail}`], { encoding: 'utf8', env })
      .split('\n').find((l) => l.startsWith('STUB:'))
  assert.equal(run(`'fix the login bug'`), 'STUB:--auto --prompt fix the login bug rid= cont=')
  assert.equal(run('--resume oc_abc'), 'STUB:--auto --session oc_abc rid=oc_abc cont=')
  assert.equal(run('--continue'), 'STUB:--auto --continue rid= cont=1')
  assert.equal(run(''), 'STUB:--auto rid= cont=')
  rmSync(dir, { recursive: true, force: true })
})

test('the REAL dispatch.sh consumes the `opencode` harness id and routes the claude-family parse (mark-active flips a record)', () => {
  // exactly the shape the generated plugin emits: `dispatch.sh opencode <Event>` + a claude-shaped payload.
  // If the dispatcher's id case ever drops `opencode`, $1 would be consumed as the EVENT and every hook goes
  // silently inert — this pins the detector with the real dispatcher and the real mark-active hook.
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const dispatch = join(repo, 'spec-cli', 'hooks', 'dispatch.sh')
  const dir = mkdtempSync(join(tmpdir(), 'spex-oc-dispatch-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(runtime, 'sessions', 'sid_OC'), { recursive: true })
  const hook = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'mark-active', 'mark-active.sh')
  writeFileSync(join(dir, 'hooks', 'mark-active.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(hook)}\n`)
  writeFileSync(join(runtime, 'hooks-manifest'), 'PreToolUse\t10\tfalse\thooks/mark-active.sh\n')
  const rec = join(runtime, 'sessions', 'sid_OC', 'session.json')
  writeFileSync(rec, JSON.stringify({ session_id: 'sid_OC', governed: true, status: 'idle', proposal: '', note: '' }, null, 2))
  const r = spawnSync('bash', [dispatch, 'opencode', 'PreToolUse'], {
    cwd: dir,
    env: { ...process.env, SPEX_HOOK_MANIFEST: join(runtime, 'hooks-manifest'), SPEXCODE_HOME: home },
    input: '{"session_id":"sid_OC","cwd":"/x","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}',
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(readFileSync(rec, 'utf8'), /"status": "active"/, 'the claude-family default branch parsed the payload and flipped the record')
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------------------------------------
// the generated plugin, driven for real: a stub dispatch.sh records every payload (and can block per event),
// a fake SDK client records injected prompts, and the REAL deliverViaRendezvous talks to the plugin's socket.

type Dispatched = { code: number }
async function loadPlugin(opts: { session: string; block?: string[]; blockJson?: string[]; blockReason?: string; promptMs?: number; resumeId?: string; continueList?: unknown[] }) {
  const dir = mkdtempSync(join(tmpdir(), 'spex-oc-plugin-'))
  const dispatch = join(dir, 'dispatch.sh')
  // records `<event>.json` (argv check included: $1 must be the baked harness id); blocks listed events.
  writeFileSync(dispatch, [
    '#!/usr/bin/env bash',
    `d="${dir}"`,
    '[ "$1" = "opencode" ] || { echo "wrong harness id: $1" >&2; exit 3; }',
    'cat > "$d/$2.json"',
    'if [ -f "$d/block-$2" ]; then echo "gate says no: $2" >&2; exit 2; fi',
    // the stop-gate's REAL shape: decision:block JSON on STDOUT (escaped \n inside reason), stderr empty, exit 2
    'if [ -f "$d/blockjson-$2" ]; then printf \'%s\\n\' \'{"decision":"block","reason":"declare first — pick ONE state:\\n  • done\\n  • ask"}\'; exit 2; fi',
    'exit 0',
  ].join('\n'))
  chmodSync(dispatch, 0o755)
  for (const e of opts.block ?? []) writeFileSync(join(dir, `block-${e}`), '')
  for (const e of opts.blockJson ?? []) writeFileSync(join(dir, `blockjson-${e}`), '')
  const pluginFile = join(dir, 'spexcode-plugin.mjs')
  writeFileSync(pluginFile, opencodePluginSource(dispatch, '/bin/true'))   // SPEX stubbed: capture becomes a no-op spawn
  process.env.SPEXCODE_SESSION_ID = opts.session
  process.env.CLAUDE_BG_RENDEZVOUS_SOCK = rvSock(opts.session)
  // the resume seeds are read at plugin LOAD — set (or clear, to stop cross-test leakage) before import
  if (opts.resumeId) process.env.SPEXCODE_OPENCODE_RESUME_ID = opts.resumeId
  else delete process.env.SPEXCODE_OPENCODE_RESUME_ID
  if (opts.continueList) process.env.SPEXCODE_OPENCODE_CONTINUE = '1'
  else delete process.env.SPEXCODE_OPENCODE_CONTINUE
  const mod = await import(pathToFileURL(pluginFile).href)
  const prompts: unknown[] = []
  // promptMs simulates the REAL SDK contract: session.prompt resolves only when the injected TURN completes
  const client = {
    session: {
      prompt: async (x: unknown) => { prompts.push(x); if (opts.promptMs) await new Promise((r) => setTimeout(r, opts.promptMs)) },
      list: async () => ({ data: opts.continueList ?? [] }),
    },
  }
  const hooks = await mod.SpexcodePlugin({ client, directory: dir })
  const payload = (e: string) => JSON.parse(readFileSync(join(dir, `${e}.json`), 'utf8'))
  const raw = (e: string) => readFileSync(join(dir, `${e}.json`), 'utf8')
  return { dir, hooks, prompts, payload, raw, session: opts.session }
}

test('hook bridge: claude-SHAPED payloads reach dispatch.sh (session_id = record id, Claude tool names, file_path)', async () => {
  const t = await loadPlugin({ session: `oc-t1-${process.pid}` })
  await t.hooks.event({ event: { type: 'session.created', properties: { info: { id: 'oc_root' } } } })
  const start = t.payload('SessionStart')
  assert.equal(start.session_id, t.session)                  // the GOVERNED record id, not opencode's own
  assert.equal(start.hook_event_name, 'SessionStart')

  await t.hooks['chat.message']({ sessionID: 'oc_root' }, { message: { sessionID: 'oc_root' }, parts: [{ type: 'text', text: 'do the thing' }] })
  assert.equal(t.payload('UserPromptSubmit').prompt, 'do the thing')

  await t.hooks['tool.execute.before']({ tool: 'edit', sessionID: 'oc_root' }, { args: { filePath: '/w/a.ts', oldString: 'x', newString: 'y' } })
  const pre = t.payload('PreToolUse')
  assert.equal(pre.tool_name, 'Edit')                        // opencode 'edit' → Claude 'Edit' (OPENCODE_TOOL_NAMES)
  assert.equal(pre.tool_input.file_path, '/w/a.ts')          // filePath → file_path, the claude accessor shape
  assert.equal(pre.tool_input.filePath, undefined)
  assert.equal(pre.agent_id, undefined)                      // root session tools carry NO subagent stamp

  await t.hooks['tool.execute.after']({ tool: 'bash', sessionID: 'oc_root' }, { args: { command: 'ls' } })
  assert.equal(t.payload('PostToolUse').tool_name, 'Bash')
  assert.equal(OPENCODE_TOOL_NAMES.bash, 'Bash')
  rmSync(t.dir, { recursive: true, force: true })
})

test('subagent discriminator: a child session\'s events carry agent_id BEFORE tool_input (the harness.sh prefix scan)', async () => {
  const t = await loadPlugin({ session: `oc-t2-${process.pid}` })
  await t.hooks.event({ event: { type: 'session.created', properties: { info: { id: 'oc_root' } } } })
  await t.hooks.event({ event: { type: 'session.created', properties: { info: { id: 'oc_child', parentID: 'oc_root' } } } })
  await t.hooks['tool.execute.before']({ tool: 'bash', sessionID: 'oc_child' }, { args: { command: 'ls' } })
  const pre = t.payload('PreToolUse')
  assert.equal(pre.agent_id, 'oc_child')
  assert.ok(t.raw('PreToolUse').indexOf('"agent_id"') < t.raw('PreToolUse').indexOf('"tool_input"'))
  // a subagent going idle is NOT the worker's Stop
  await t.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'oc_child' } } })
  assert.ok(!existsSync(join(t.dir, 'Stop.json')))
  rmSync(t.dir, { recursive: true, force: true })
})

test('block semantics: a PreToolUse block THROWS (aborts the tool call); a Stop block re-injects the gate reason as a prompt', async () => {
  const t = await loadPlugin({ session: `oc-t3-${process.pid}`, block: ['PreToolUse', 'Stop'] })
  await t.hooks.event({ event: { type: 'session.created', properties: { info: { id: 'oc_root' } } } })
  await assert.rejects(
    () => t.hooks['tool.execute.before']({ tool: 'write', sessionID: 'oc_root' }, { args: { filePath: '/w/x' } }),
    /gate says no: PreToolUse/,
  )
  await t.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'oc_root' } } })
  assert.equal(t.prompts.length, 1)                          // the stop-gate loop closes in-process
  const p = t.prompts[0] as { path: { id: string }; body: { parts: { text: string }[] } }
  assert.equal(p.path.id, 'oc_root')
  assert.match(p.body.parts[0].text, /gate says no: Stop/)
  // the loop-termination bit ([[shim-runtime]] dispatchStop): the idle AFTER a blocked one is the gate's own
  // continuation settling, so its Stop payload carries stop_hook_active=true — the gate's escape paths key
  // on it, which is what guarantees the block loop ends instead of re-blocking until the host dies.
  assert.equal(t.payload('Stop').stop_hook_active, false, 'natural stop → bit false')
  await t.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'oc_root' } } })
  assert.equal(t.payload('Stop').stop_hook_active, true, 'post-block settle → bit true')
  rmSync(t.dir, { recursive: true, force: true })
})

test('stop-gate wire shape: a stdout decision:block JSON (stderr empty) injects the parsed REASON with real newlines, never the raw wire JSON', async () => {
  // the live A-side field bug (undeclared-stop-gate-rejection): the stop-gate blocks by printing its
  // decision JSON to STDOUT; reason() was err||out, so the agent was prompted with the escaped wire blob.
  const t = await loadPlugin({ session: `oc-t3b-${process.pid}`, blockJson: ['Stop', 'PreToolUse'] })
  await t.hooks.event({ event: { type: 'session.created', properties: { info: { id: 'oc_root' } } } })
  await t.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'oc_root' } } })
  assert.equal(t.prompts.length, 1)
  const text = (t.prompts[0] as { body: { parts: { text: string }[] } }).body.parts[0].text
  assert.equal(text, 'declare first — pick ONE state:\n  • done\n  • ask')   // parsed reason, \n now REAL newlines
  assert.ok(!text.includes('"decision"'), 'no wire JSON reaches the agent')
  // the PreToolUse abort message gets the same treatment
  await assert.rejects(
    () => t.hooks['tool.execute.before']({ tool: 'write', sessionID: 'oc_root' }, { args: { filePath: '/w/x' } }),
    (e: Error) => e.message.startsWith('declare first — pick ONE state:') && !e.message.includes('"decision"'),
  )
  rmSync(t.dir, { recursive: true, force: true })
})

test('resumed session (--session route): the env-seeded rootSession makes the daemon deliverable with NO bus event', async () => {
  // the resume-continuity A-side field bug: a resumed session fires no session.created/idle/chat until a
  // human pokes the TUI, so event-driven adoption left the daemon reply-rejecting every delivery.
  const session = `oc-t6-${process.pid}`
  const t = await loadPlugin({ session, resumeId: 'oc_resumed' })
  for (let i = 0; i < 100 && !existsSync(rvSock(session)); i++) await new Promise((r) => setTimeout(r, 20))
  const r = await deliverViaRendezvous(session, 'steer straight after resume')   // no event fired at all
  assert.equal(r.ok, true)
  const p = t.prompts[0] as { path: { id: string }; body: { parts: { text: string }[] } }
  assert.equal(p.path.id, 'oc_resumed')                       // injected into the RESUMED conversation
  assert.equal(p.body.parts[0].text, 'steer straight after resume')
  rmSync(t.dir, { recursive: true, force: true })
  rmSync(rvSock(session), { force: true })
})

test('resumed session (--continue route): the SDK session.list fallback adopts the newest ROOT session', async () => {
  const session = `oc-t7-${process.pid}`
  const t = await loadPlugin({ session, continueList: [
    { id: 'oc_old', time: { updated: 100 } },
    { id: 'oc_newest', time: { updated: 300 } },
    { id: 'oc_child', parentID: 'oc_newest', time: { updated: 400 } },   // children never adopted
  ] })
  for (let i = 0; i < 100 && !existsSync(rvSock(session)); i++) await new Promise((r) => setTimeout(r, 20))
  let ok = false
  for (let i = 0; i < 100 && !ok; i++) {                      // the fallback is async — poll the deliver
    const r = await deliverViaRendezvous(session, 'steer after --continue')
    ok = r.ok
    if (!ok) await new Promise((r2) => setTimeout(r2, 50))
  }
  assert.equal(ok, true, 'the fallback adopted a session and the daemon accepted the delivery')
  const p = t.prompts[0] as { path: { id: string } }
  assert.equal(p.path.id, 'oc_newest')
  rmSync(t.dir, { recursive: true, force: true })
  rmSync(rvSock(session), { force: true })
})

test('rendezvous daemon: the REAL claude deliver (atomic reply+repaint, parse-confirmed) lands a prompt in the session', async () => {
  const session = `oc-t4-${process.pid}`
  const t = await loadPlugin({ session })
  await t.hooks.event({ event: { type: 'session.created', properties: { info: { id: 'oc_root' } } } })
  for (let i = 0; i < 100 && !existsSync(rvSock(session)); i++) await new Promise((r) => setTimeout(r, 20))
  assert.ok(existsSync(rvSock(session)), 'the plugin bound the rendezvous socket from the launch env')
  const r = await deliverViaRendezvous(session, 'manager says: also update the docs')
  assert.equal(r.ok, true)                                    // repaint-done arrived → parse-confirmed, not optimistic
  assert.equal((t.prompts[0] as { body: { parts: { text: string }[] } }).body.parts[0].text, 'manager says: also update the docs')
  rmSync(t.dir, { recursive: true, force: true })
  rmSync(rvSock(session), { force: true })
})

test('rendezvous daemon under probe pressure: kicking connects + a turn-length prompt call still parse-confirm — ONE injection, no false negative', async () => {
  // the field bug (deliver-second-message A-side): session.prompt resolves only when the injected TURN ends,
  // and the board liveness probe connects to the socket on every snapshot. The daemon awaiting the injection
  // INSIDE its parse loop left repaint-done unsent for the whole turn, so every probe connect kicked the
  // pending confirm — sender reported "NOT delivered" (false) and its retries re-injected the same prompt.
  // The daemon must confirm at PARSE time, synchronously, before any concurrent connect can run.
  const session = `oc-t5-${process.pid}`
  const t = await loadPlugin({ session, promptMs: 1500 })     // a realistic slow turn, longer than the whole deliver
  await t.hooks.event({ event: { type: 'session.created', properties: { info: { id: 'oc_root' } } } })
  for (let i = 0; i < 100 && !existsSync(rvSock(session)); i++) await new Promise((r) => setTimeout(r, 20))
  assert.ok(existsSync(rvSock(session)), 'the plugin bound the rendezvous socket from the launch env')
  const storm = setInterval(() => {                           // the probe: connect (which kicks) then drop, every 20ms
    const p = createConnection({ path: rvSock(session) })
    p.on('error', () => { /* daemon may kick us right back */ })
    setTimeout(() => p.destroy(), 10)
  }, 20)
  const r = await deliverViaRendezvous(session, 'second message under fire')
  clearInterval(storm)
  assert.equal(r.ok, true, `deliver must parse-confirm despite the probe storm (got: ${JSON.stringify(r)})`)
  assert.equal(t.prompts.length, 1)                           // exactly one injection — a confirmed prompt is never resent
  assert.equal((t.prompts[0] as { body: { parts: { text: string }[] } }).body.parts[0].text, 'second message under fire')
  rmSync(t.dir, { recursive: true, force: true })
  rmSync(rvSock(session), { force: true })
})
