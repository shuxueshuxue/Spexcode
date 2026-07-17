import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { opencodePluginSource, OPENCODE_TOOL_NAMES } from './opencode.js'
import { HARNESSES, harnessById, opencodeHarness, opencodeLaunchCommand, deliverViaRendezvous, rvSock } from './harness.js'

// [[opencode-harness]] — the MECHANICAL layer: the adapter surface, the tail-branching launch script, and the
// generated plugin's two roles (hook bridge → dispatch.sh with claude-SHAPED payloads; rendezvous daemon the
// claude deliver talks to VERBATIM). A real `opencode` launch needs model credentials and stays an e2e item;
// everything here runs the generated artifacts with stubs, no opencode binary involved.

test('adapter surface: third native harness, claude-family runtime facts', () => {
  assert.deepEqual(HARNESSES.map((h) => h.id), ['claude', 'codex', 'opencode'])
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
  writeFileSync(stub, '#!/usr/bin/env bash\necho "STUB:$*"\n')
  chmodSync(stub, 0o755)
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }
  const run = (tail: string) =>
    execFileSync('bash', ['-c', `${opencodeLaunchCommand('opencode --auto')} ${tail}`], { encoding: 'utf8', env })
      .split('\n').find((l) => l.startsWith('STUB:'))
  assert.equal(run(`'fix the login bug'`), 'STUB:--auto --prompt fix the login bug')
  assert.equal(run('--resume oc_abc'), 'STUB:--auto --session oc_abc')
  assert.equal(run('--continue'), 'STUB:--auto --continue')
  assert.equal(run(''), 'STUB:--auto')
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------------------------------------
// the generated plugin, driven for real: a stub dispatch.sh records every payload (and can block per event),
// a fake SDK client records injected prompts, and the REAL deliverViaRendezvous talks to the plugin's socket.

type Dispatched = { code: number }
async function loadPlugin(opts: { session: string; block?: string[]; blockReason?: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'spex-oc-plugin-'))
  const dispatch = join(dir, 'dispatch.sh')
  // records `<event>.json` (argv check included: $1 must be the baked harness id); blocks listed events.
  writeFileSync(dispatch, [
    '#!/usr/bin/env bash',
    `d="${dir}"`,
    '[ "$1" = "opencode" ] || { echo "wrong harness id: $1" >&2; exit 3; }',
    'cat > "$d/$2.json"',
    'if [ -f "$d/block-$2" ]; then echo "gate says no: $2" >&2; exit 2; fi',
    'exit 0',
  ].join('\n'))
  chmodSync(dispatch, 0o755)
  for (const e of opts.block ?? []) writeFileSync(join(dir, `block-${e}`), '')
  const pluginFile = join(dir, 'spexcode-plugin.mjs')
  writeFileSync(pluginFile, opencodePluginSource(dispatch, '/bin/true'))   // SPEX stubbed: capture becomes a no-op spawn
  process.env.SPEXCODE_SESSION_ID = opts.session
  process.env.CLAUDE_BG_RENDEZVOUS_SOCK = rvSock(opts.session)
  const mod = await import(pathToFileURL(pluginFile).href)
  const prompts: unknown[] = []
  const client = { session: { prompt: async (x: unknown) => { prompts.push(x) } } }
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
  rmSync(t.dir, { recursive: true, force: true })
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
