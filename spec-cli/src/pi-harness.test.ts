import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { pathToFileURL } from 'node:url'
import { piExtensionSource, writePiTrust, removePiTrust } from './pi-harness.js'
import { piHarness } from './harness.js'

// the mechanical layer of [[pi-harness]]: the generated extension's dispatch bridge + rendezvous server are
// exercised by IMPORTING the generated .ts (the same way pi's jiti runs it) and driving its handlers with a
// stub ExtensionAPI — no real pi, no model credentials. A real dispatched launch is the e2e scenario.

type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<unknown>
function stubPi() {
  const handlers = new Map<string, Handler>()
  const sent: Array<{ text: string; opts: unknown }> = []
  return {
    api: {
      on: (e: string, h: Handler) => handlers.set(e, h),
      sendUserMessage: (text: string, opts: unknown) => sent.push({ text, opts }),
    },
    handlers, sent,
    ctx: { sessionManager: { getSessionId: () => 'rec-pi-1' } },
  }
}

// write a dispatch stub + the generated extension against it, and import the extension like pi would.
async function loadExtension(dir: string, dispatchBody: string) {
  const dispatch = join(dir, 'dispatch.sh')
  writeFileSync(dispatch, `#!/usr/bin/env bash\n${dispatchBody}\n`)
  chmodSync(dispatch, 0o755)
  const ext = join(dir, 'spexcode.ts')
  writeFileSync(ext, piExtensionSource(dispatch, '/abs/spex.mjs'))
  const mod = await import(pathToFileURL(ext).href)
  return { factory: mod.default as (pi: unknown) => void, dispatch }
}

test('pi extension: synthesizes a claude-shaped payload and passes a clean dispatch through', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ext-'))
  const seen = join(dir, 'payload.json')
  const { factory } = await loadExtension(dir, `[ "$1 $2" = "pi PreToolUse" ] || exit 9\ncat > ${seen}\nexit 0`)
  const { api, handlers, ctx } = stubPi()
  factory(api)
  await handlers.get('session_start')!({ reason: 'startup' }, ctx)
  const verdict = await handlers.get('tool_call')!({ toolName: 'edit', toolCallId: 't1', input: { path: '/w/f.ts', newText: 'x' } }, ctx)
  assert.equal(verdict, undefined, 'exit 0 → no block')
  const payload = JSON.parse(readFileSync(seen, 'utf8'))
  assert.equal(payload.session_id, 'rec-pi-1', 'session id from pi, pinned = the record id')
  assert.equal(payload.hook_event_name, 'PreToolUse')
  assert.equal(payload.tool_name, 'Edit', 'pi tool name mapped to Claude vocabulary')
  assert.equal(payload.tool_input.file_path, '/w/f.ts', 'pi `path` mirrored to claude `file_path`')
  assert.equal(process.env.PI_SESSION_ID, 'rec-pi-1', 'session_start exports the sessionEnvVar')
})

test('pi extension: dispatch exit 2 bridges to { block, reason } on tool_call and to a user message on Stop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ext-'))
  const { factory } = await loadExtension(dir, `echo "not yet — commit first" >&2\nexit 2`)
  const { api, handlers, sent, ctx } = stubPi()
  factory(api)
  const verdict = await handlers.get('tool_call')!({ toolName: 'bash', input: { command: 'ls' } }, ctx) as { block: boolean; reason: string }
  assert.deepEqual(verdict, { block: true, reason: 'not yet — commit first' }, 'exit 2 + stderr → pi block contract')
  await handlers.get('agent_settled')!({}, ctx)
  assert.equal(sent.length, 1, 'the stop gate speaks back as a user message')
  assert.equal(sent[0].text, 'not yet — commit first')
})

test('pi extension: a stdout decision:block JSON (the stop-gate shape — exit 2, stderr EMPTY) carries its reason through', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ext-'))
  // the real dispatch shape: handlers' stdout is concatenated WITHOUT separators (an additionalContext
  // object may arrive glued before the block decision), the reason carries JSON escapes, stderr is empty.
  const glued = `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"heads-up"}}` +
    `{"decision":"block","reason":"undeclared stop — declare it: run \`spex session <choice>\`.\\nSee \\"help session\\"."}`
  const { factory } = await loadExtension(dir, `printf '%s' '${glued}'\nexit 2`)
  const { api, handlers, sent, ctx } = stubPi()
  factory(api)
  const expected = 'undeclared stop — declare it: run `spex session <choice>`.\nSee "help session".'
  const verdict = await handlers.get('tool_call')!({ toolName: 'bash', input: { command: 'ls' } }, ctx) as { block: boolean; reason: string }
  assert.deepEqual(verdict, { block: true, reason: expected }, 'PreToolUse block reads the stdout JSON reason, unescaped')
  await handlers.get('agent_settled')!({}, ctx)
  assert.equal(sent.length, 1, 'the Stop rejection is injected, never silently dropped')
  assert.equal(sent[0].text, expected)
})

test('pi extension: binds the rendezvous socket and speaks the reclaude protocol (reply → sendUserMessage, repaint → repaint-done)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ext-'))
  const sock = join(dir, 'rv.sock')
  const { factory } = await loadExtension(dir, 'exit 0')
  const { api, handlers, sent } = stubPi()
  const prev = process.env.CLAUDE_BG_RENDEZVOUS_SOCK
  process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
  try {
    factory(api)
    // the server binds asynchronously; wait for the listener like liveness does
    for (let i = 0; i < 100 && !existsSync(sock); i++) await new Promise((r) => setTimeout(r, 10))
    const answered = await new Promise<string>((resolve, reject) => {
      const c = createConnection({ path: sock })
      c.on('error', reject)
      c.on('connect', () => c.write(JSON.stringify({ type: 'reply', text: 'hello worker' }) + '\n' + JSON.stringify({ type: 'repaint' }) + '\n'))
      let buf = ''
      c.on('data', (d) => { buf += d.toString(); if (buf.includes('\n')) { c.destroy(); resolve(buf.trim()) } })
    })
    assert.equal(JSON.parse(answered).type, 'repaint-done', 'the repaint barrier answers — deliverViaRendezvous confirms parse')
    assert.deepEqual(sent.map((s) => s.text), ['hello worker'], 'the reply landed as a user message')
    await handlers.get('session_shutdown')!({}, { })
    assert.ok(!existsSync(sock), 'shutdown unlinks the socket')
  } finally {
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = prev
  }
})

test('pi trust: idempotent surgical stamp on trust.json; remove touches only a `true` of ours; corrupt store fails loud', () => {
  const agent = mkdtempSync(join(tmpdir(), 'pi-agent-'))
  const prev = process.env.SPEXCODE_PI_AGENT_DIR
  process.env.SPEXCODE_PI_AGENT_DIR = agent
  try {
    const file = join(agent, 'trust.json')
    writeFileSync(file, JSON.stringify({ '/their/project': false, '/other': true }, null, 2))
    const proj = mkdtempSync(join(tmpdir(), 'pi-proj-'))
    writePiTrust(proj)
    writePiTrust(proj)   // idempotent — no duplicate churn
    let data = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(Object.values(data).filter((v) => v === true).length, 2)
    assert.equal(data['/their/project'], false, 'a user decision survives')
    removePiTrust(proj)
    data = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(data, { '/their/project': false, '/other': true }, 'remove strips exactly our stamp')
    removePiTrust('/their/project')
    assert.equal(JSON.parse(readFileSync(file, 'utf8'))['/their/project'], false, 'a saved "do not trust" is never deleted')
    writeFileSync(file, '{ not json')
    assert.throws(() => writePiTrust(proj), /not valid JSON/, 'never clobber a corrupt store')
  } finally {
    process.env.SPEXCODE_PI_AGENT_DIR = prev
  }
})

test('piHarness adapter surface: launch/resume/shim/liveness one-liners', () => {
  assert.equal(piHarness.launchCmd('x', undefined, undefined), 'pi --approve', 'default base + one-run trust')
  assert.equal(piHarness.launchCmd('x', undefined, '/opt/pi-wrapper'), '/opt/pi-wrapper --approve', 'pinned launcher cmd wins, flag still rides')
  assert.equal(piHarness.sessionIdArg('abc'), '--session-id abc', 'caller pins the id, claude-style')
  assert.equal(piHarness.resumeArg({ session: 'abc' }), '--session abc', 'resume names the exact session, fails loud if gone')
  const shim = piHarness.shim('/d/dispatch.sh', '/s/spex.mjs')
  assert.ok(shim.content.includes('"/d/dispatch.sh"') && shim.content.includes('dispatch.sh'), 'the generated extension carries the clean() identity stamp')
  assert.equal(shim.cmd('Stop'), `SPEX='/s/spex.mjs' bash /d/dispatch.sh pi Stop`)
  assert.equal(piHarness.liveness({ session: 'x' }, true, undefined, undefined, true), 'online')
  assert.equal(piHarness.liveness({ session: 'x' }, true, undefined, undefined, false), 'offline', 'no listener = offline (claude truth)')
  assert.equal(piHarness.liveness({ session: 'x' }, false, undefined, undefined, true), 'offline')
  assert.equal(piHarness.worktreeHookAnchor('/p'), null)
  assert.equal(piHarness.agentDir('/p'), null)
})
