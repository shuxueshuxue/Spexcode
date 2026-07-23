import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { opencodeHeadlessLaunchCommand, opencodeHeadlessWakeCommand } from './opencode-headless.js'
import { HARNESSES, opencodeHarness, opencodeHeadlessHarness, rvSock } from './harness.js'

const waitFor = async (check: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for fixture state')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('opencode-headless is an independent adapter with OpenCode materialization and a replaced runtime half', () => {
  assert.deepEqual(HARNESSES.map((h) => h.id), ['claude', 'codex', 'opencode', 'pi', 'claude-headless', 'opencode-headless'])
  const proj = '/tmp/project'
  assert.equal(opencodeHeadlessHarness.shimFile(proj), opencodeHarness.shimFile(proj))
  assert.deepEqual(opencodeHeadlessHarness.contractFiles(proj), opencodeHarness.contractFiles(proj))
  assert.equal(opencodeHeadlessHarness.skillDir(proj), opencodeHarness.skillDir(proj))
  assert.equal(opencodeHeadlessHarness.agentDir(proj), opencodeHarness.agentDir(proj))
  assert.equal(opencodeHeadlessHarness.shim('/dispatch', '/spex').content, opencodeHarness.shim('/dispatch', '/spex').content)
  assert.equal(opencodeHeadlessHarness.sessionIdArg('abc'), '')
  assert.equal(opencodeHeadlessHarness.resumeArg({ session: 'abc', harnessSessionId: 'oc_1' }), '--resume oc_1')
  assert.equal(opencodeHeadlessHarness.resumeArg({ session: 'abc' }), '--continue')
  assert.equal(opencodeHeadlessHarness.headless, true)
  assert.equal(opencodeHeadlessHarness.messageStream, false)
  assert.equal(opencodeHeadlessHarness.ownsRendezvous, true)
  assert.equal(opencodeHeadlessHarness.liveness({ session: 'abc' }, false), 'online')
  assert.match(opencodeHeadlessHarness.launchCmd('abc', '/runtime', 'opencode-custom --auto'), /__spex_cmd=\(opencode-custom --auto\)/)
})

test('launch and wake commands preserve the native id capture/resume markers and ordinary output format', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-oh-launch-'))
  const log = join(dir, 'calls.ndjson')
  const stub = join(dir, 'opencode')
  writeFileSync(stub, [
    '#!/usr/bin/env node',
    "const { appendFileSync } = require('node:fs')",
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), rid: process.env.SPEXCODE_OPENCODE_RESUME_ID || '', cont: process.env.SPEXCODE_OPENCODE_CONTINUE || '' }) + '\\n')`,
  ].join('\n'))
  chmodSync(stub, 0o755)
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, SHELL: '/bin/true' }
  const run = (command: string, tail = '') => execFileSync('bash', ['-c', `${command} ${tail}`], { env })

  run(opencodeHeadlessLaunchCommand('opencode --auto'), "'first prompt'")
  run(opencodeHeadlessLaunchCommand('opencode --auto'), '--resume oc_abc')
  run(opencodeHeadlessLaunchCommand('opencode --auto'), '--continue')
  run(opencodeHeadlessWakeCommand('opencode --auto', 'oc_abc', 'wake with spaces'))
  run(opencodeHeadlessWakeCommand('opencode --auto', null, 'wake by continue'))

  const calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(calls, [
    { argv: ['run', '--auto', 'first prompt'], rid: '', cont: '' },
    { argv: ['run', '--auto', '--session', 'oc_abc'], rid: 'oc_abc', cont: '' },
    { argv: ['run', '--auto', '--continue'], rid: '', cont: '1' },
    { argv: ['run', '--auto', '--session', 'oc_abc', 'wake with spaces'], rid: 'oc_abc', cont: '' },
    { argv: ['run', '--auto', '--continue', 'wake by continue'], rid: '', cont: '1' },
  ])
  assert.ok(calls.every((call) => !call.argv.includes('--format')), 'default output format stays untouched')
  rmSync(dir, { recursive: true, force: true })
})

test('a live turn uses the existing parse-confirmed rendezvous delivery', async (t) => {
  const id = `oh-live-${process.pid}`
  const sock = rvSock(id)
  rmSync(sock, { force: true })
  const replies: string[] = []
  const server = createServer((connection) => {
    let buffer = ''
    connection.setEncoding('utf8')
    connection.on('data', (chunk) => {
      buffer += chunk
      for (;;) {
        const nl = buffer.indexOf('\n')
        if (nl < 0) break
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        const event = JSON.parse(line)
        if (event.type === 'reply') replies.push(event.text)
        if (event.type === 'repaint') connection.write('{"type":"repaint-done"}\n')
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(sock, resolve)
  })
  t.after(() => {
    server.close()
    rmSync(sock, { force: true })
  })
  const result = await opencodeHeadlessHarness.deliver({ session: id }, 'steer the live turn')
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(replies, ['steer the live turn'])
})

test('an idle turn respawns opencode run in the session tmux home and a missing home fails loud', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-oh-wake-'))
  const fake = join(dir, 'fake-opencode')
  const log = join(dir, 'wake.json')
  writeFileSync(fake, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), sid: process.env.SPEXCODE_SESSION_ID, sock: process.env.CLAUDE_BG_RENDEZVOUS_SOCK }))
`)
  chmodSync(fake, 0o755)
  const id = `oh-wake-${process.pid}`
  const tmuxSock = `spex-oh-${process.pid}`
  const oldTmux = process.env.SPEXCODE_TMUX
  process.env.SPEXCODE_TMUX = tmuxSock
  execFileSync('tmux', ['-L', tmuxSock, 'new-session', '-d', '-s', id, '-c', dir])
  t.after(() => {
    try { execFileSync('tmux', ['-L', tmuxSock, 'kill-server']) } catch { /* already gone */ }
    if (oldTmux === undefined) delete process.env.SPEXCODE_TMUX
    else process.env.SPEXCODE_TMUX = oldTmux
    rmSync(dir, { recursive: true, force: true })
    rmSync(rvSock(id), { force: true })
  })

  const result = await opencodeHeadlessHarness.deliver({
    session: id,
    worktreePath: dir,
    harnessSessionId: 'oc_native',
    launchCmd: `${JSON.stringify(fake)} --auto`,
  }, 'wake the model')
  assert.deepEqual(result, { ok: true })
  await waitFor(() => existsSync(log))
  assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), {
    argv: ['run', '--auto', '--session', 'oc_native', 'wake the model'],
    sid: id,
    sock: rvSock(id),
  })

  const missing = await opencodeHeadlessHarness.deliver({
    session: 'no-such-tmux-home',
    worktreePath: dir,
    harnessSessionId: 'oc_native',
    launchCmd: JSON.stringify(fake),
  }, 'must fail')
  assert.equal(missing.ok, false)
  assert.match(missing.error || '', /could not start a turn.*no-such-tmux-home/)
})
