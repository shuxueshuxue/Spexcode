import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { HookPromptCatalog } from './hook-prompts.js'
import { compileManifest } from './hooks.js'
import { openProjectSessionApplication } from '@spexcode/session-application'

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const dispatch = join(repo, 'spec-cli', 'hooks', 'dispatch.sh')

function seedCanonicalSessions(home: string, rows: Array<{ id: string; status: string; proposal?: string | null; note?: string | null }>) {
  const databasePath = join(home, 'sessions.sqlite')
  mkdirSync(home, { recursive: true })
  writeFileSync(`${databasePath}.json-migration.json`, '{"version":1}\n')
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  try {
    for (const row of rows) app.createSession({ sessionId: row.id, status: row.status, proposal: row.proposal ?? null, note: row.note ?? null })
  } finally {
    app.close()
  }
  return databasePath
}

test('compiled hook surface has one dispatcher and two PreToolUse handlers', () => {
  const rows = compileManifest().trim().split('\n').filter(Boolean)
  const pre = rows.filter((row) => row.startsWith('PreToolUse\t'))
  assert.equal(pre.length, 2)
  assert.deepEqual(pre.map((row) => row.split('\t')[3]), [
    '.spec/spexcode/.plugins/core/mark-active/mark-active.sh',
    '.spec/spexcode/.plugins/core/spec-first/spec-first.sh',
  ])
})

test('dispatch exits 2 when a blocking handler emits decision:block JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, '.spec', 'x', '.plugins'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(dir, 'rt'), { recursive: true })
  writeFileSync(join(dir, 'hooks', 'block.sh'), '#!/usr/bin/env bash\nprintf \'{"decision":"block","reason":"no"}\'\n')
  writeFileSync(join(dir, 'rt', 'hooks-manifest'), 'Stop\t10\ttrue\thooks/block.sh\n')
  const r = spawnSync('bash', [dispatch, 'codex', 'Stop'], {
    cwd: dir,
    env: { ...process.env, SPEX_HOOK_MANIFEST: join(dir, 'rt', 'hooks-manifest') },
    input: '{}',
    encoding: 'utf8',
  })
  assert.equal(r.status, 2)
  assert.match(r.stdout, /"decision":"block"/)
})

test('stop-gate is silent for self-launched sessions and renders the catalog prompt for governed sessions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-stop-gate-dispatch-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  const sid = 'stop-gate-dispatch'
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(runtime, 'sessions', sid), { recursive: true })
  const source = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'stop-gate', 'stop-gate.sh')
  writeFileSync(join(dir, 'hooks', 'stop-gate.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(source)}\n`)
  const manifest = join(runtime, 'hooks-manifest')
  writeFileSync(manifest, 'Stop\t10\ttrue\thooks/stop-gate.sh\n')
  const databasePath = seedCanonicalSessions(home, [{ id: sid, status: 'active' }])
  const record = join(runtime, 'sessions', sid, 'runtime.json')
  const fire = () => spawnSync('bash', [dispatch, 'claude', 'Stop'], {
    cwd: dir,
    env: { ...process.env, SPEX: join(repo, 'spec-cli', 'bin', 'spex.mjs'), SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: databasePath, SPEX_HOOK_MANIFEST: manifest },
    input: JSON.stringify({ session_id: sid, hook_event_name: 'Stop', stop_hook_active: false }),
    encoding: 'utf8',
  })

  writeFileSync(record, JSON.stringify({ session_id: sid, governed: false, status: 'active' }, null, 2))
  const selfLaunched = fire()
  assert.equal(selfLaunched.status, 0, selfLaunched.stderr)
  assert.equal(selfLaunched.stdout, '')

  writeFileSync(record, JSON.stringify({ session_id: sid, governed: true, status: 'active' }, null, 2))
  const governed = fire()
  assert.equal(governed.status, 2, governed.stderr)
  const expected = new HookPromptCatalog().render('stop-gate', {
    variant: 'full',
    cli: join(repo, 'spec-cli', 'bin', 'spex.mjs'),
  })
  assert.equal(JSON.parse(governed.stdout).reason, expected)
})

test('stop-gate forced continuation writes asking through the internal lifecycle writer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-stop-gate-forced-writer-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  const sid = 'stop-gate-forced-writer'
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(runtime, 'sessions', sid), { recursive: true })
  writeFileSync(join(runtime, 'sessions', sid, 'runtime.json'), JSON.stringify({
    session_id: sid, governed: true, status: 'active', proposal: '', note: '',
  }, null, 2))
  const source = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'stop-gate', 'stop-gate.sh')
  writeFileSync(join(dir, 'hooks', 'stop-gate.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(source)}\n`)
  const manifest = join(runtime, 'hooks-manifest')
  writeFileSync(manifest, 'Stop\t10\ttrue\thooks/stop-gate.sh\n')
  const calls = join(dir, 'calls')
  const fake = join(dir, 'fake-spex')
  writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\ncase "$*" in\n  "internal session-hook-state --session ${sid}") printf '1\\tactive\\t\\n' ;;\n  internal\\ session-state\\ asking\\ --session\\ ${sid}*) exit 0 ;;\nesac\n`)
  chmodSync(fake, 0o755)
  const result = spawnSync('bash', [dispatch, 'claude', 'Stop'], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SPEX: fake, SPEXCODE_HOME: home, SPEX_HOOK_MANIFEST: manifest },
    input: JSON.stringify({ session_id: sid, hook_event_name: 'Stop', stop_hook_active: true }),
    encoding: 'utf8',
    timeout: 2000,
  })
  assert.equal(result.status, 0, result.error?.message || result.stderr)
  assert.equal(result.stdout, '')
  const entries = readFileSync(calls, 'utf8').trim().split('\n')
  assert.ok(entries.includes(`internal session-state asking --session ${sid} --note auto: stopped without declaring — choose merge, close, ask, or park; done --propose nothing records no state`))
  assert.ok(!entries.some((entry) => entry.startsWith(`session ask --session ${sid}`)), 'the stop hook must not invoke porcelain delivery')
})

test('idle hook delegates governance to the canonical writer instead of reading session.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-idle-hook-canonical-'))
  const sid = 'idle-hook-canonical'
  const calls = join(dir, 'calls')
  const fake = join(dir, 'fake-spex')
  const source = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'idle', 'idle.sh')
  writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n`)
  chmodSync(fake, 0o755)
  const result = spawnSync('bash', [source], {
    cwd: dir,
    env: { ...process.env, SPEX: fake, SPEXCODE_HARNESS: 'claude', SPEXCODE_HARNESS_LIB: join(repo, 'spec-cli', 'hooks', 'harness.sh') },
    input: JSON.stringify({ session_id: sid, notification_type: 'idle_prompt' }),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(calls, 'utf8').trim(), `internal session-idle --session ${sid}`)
})

test('session-fail hook delegates governance to the canonical writer instead of reading session.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-fail-hook-canonical-'))
  const sid = 'fail-hook-canonical'
  const calls = join(dir, 'calls')
  const fake = join(dir, 'fake-spex')
  const source = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'session-fail', 'fail.sh')
  writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n`)
  chmodSync(fake, 0o755)
  const result = spawnSync('bash', [source], {
    cwd: dir,
    env: { ...process.env, SPEX: fake, SPEXCODE_HARNESS: 'claude', SPEXCODE_HARNESS_LIB: join(repo, 'spec-cli', 'hooks', 'harness.sh') },
    input: JSON.stringify({ session_id: sid }),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(calls, 'utf8').trim(), `internal session-fail --session ${sid}`)
})

// An in-process subagent fires the PARENT's hooks with the PARENT's session_id, so without the agent_id
// discriminator a helper's dead turn would mark the session that spawned it `error`. mark-active carries the
// same guard for the same payload shape; this is one defect class with one answer.
test('session-fail ignores an in-process subagent turn failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-fail-hook-subagent-'))
  const sid = 'fail-hook-parent'
  const calls = join(dir, 'calls')
  const fake = join(dir, 'fake-spex')
  const source = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'session-fail', 'fail.sh')
  writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n`)
  chmodSync(fake, 0o755)
  const run = (payload: unknown) => spawnSync('bash', [source], {
    cwd: dir,
    env: { ...process.env, SPEX: fake, SPEXCODE_HARNESS: 'claude', SPEXCODE_HARNESS_LIB: join(repo, 'spec-cli', 'hooks', 'harness.sh') },
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })
  const sub = run({ session_id: sid, agent_id: 'agent_01', hook_event_name: 'StopFailure', error: 'api_error' })
  assert.equal(sub.status, 0, sub.stderr)
  assert.equal(existsSync(calls), false, 'a subagent failure must not reach the lifecycle writer')
  const own = run({ session_id: sid, hook_event_name: 'StopFailure', error: 'api_error' })
  assert.equal(own.status, 0, own.stderr)
  assert.equal(readFileSync(calls, 'utf8').trim(), `internal session-fail --session ${sid}`)
})

// A non-blocking handler that fails used to vanish twice over: its exit code was dropped and its stderr was
// overwritten by the next handler, so a lifecycle hook that could not write left NO trace and the board simply
// held its last state. Reporting must not promote it into a gate, so the verdict stays exit 0.
test('a non-blocking handler failure is reported without becoming a gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-loud-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, '.spec', 'x', '.plugins'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(dir, 'rt'), { recursive: true })
  writeFileSync(join(dir, 'hooks', 'boom.sh'), '#!/usr/bin/env bash\nprintf \'database is locked\\n\' >&2\nexit 5\n')
  writeFileSync(join(dir, 'hooks', 'after.sh'), '#!/usr/bin/env bash\nprintf ok\n')
  writeFileSync(join(dir, 'rt', 'hooks-manifest'), 'Stop\t10\tfalse\thooks/boom.sh\nStop\t20\tfalse\thooks/after.sh\n')
  const r = spawnSync('bash', [dispatch, 'claude', 'Stop'], {
    cwd: dir,
    env: { ...process.env, SPEX_HOOK_MANIFEST: join(dir, 'rt', 'hooks-manifest') },
    input: '{}',
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, 'a non-blocking failure must not change the dispatch verdict')
  assert.match(r.stderr, /handler hooks\/boom\.sh exited 5/)
  assert.match(r.stderr, /database is locked/, "the handler's own stderr survives the next handler")
  assert.equal(r.stdout, 'ok', 'later handlers still run')
})

test('dispatch migrates the historical stop-gate source before it can call porcelain delivery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-stop-gate-legacy-migration-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  const sid = 'stop-gate-legacy-migration'
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const handler = join(dir, '.spec', 'spexcode', '.plugins', 'core', 'stop-gate', 'stop-gate.sh')
  mkdirSync(join(dir, '.spec', 'spexcode', '.plugins', 'core', 'stop-gate'), { recursive: true })
  // Keep exercising the pre-fix source after the repair lands: the first parent is the old tracked hook.
  writeFileSync(handler, execFileSync('git', ['show', 'HEAD^:.spec/spexcode/.plugins/core/stop-gate/stop-gate.sh'], { cwd: repo }))
  mkdirSync(join(runtime, 'sessions', sid), { recursive: true })
  writeFileSync(join(runtime, 'sessions', sid, 'session.json'), JSON.stringify({ session_id: sid, governed: true, status: 'active' }, null, 2))
  const manifest = join(runtime, 'hooks-manifest')
  writeFileSync(manifest, 'Stop\t10\ttrue\t.spec/spexcode/.plugins/core/stop-gate/stop-gate.sh\n')
  const calls = join(dir, 'calls')
  const fake = join(dir, 'fake-spex')
  writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\ncase "$*" in\n  "internal session-hook-state --session ${sid}") printf '1\\tactive\\t\\n' ;;\n  internal\\ session-state\\ asking\\ --session\\ ${sid}*) exit 0 ;;\nesac\n`)
  chmodSync(fake, 0o755)
  const result = spawnSync('bash', [dispatch, 'claude', 'Stop'], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SPEX: fake, SPEXCODE_HOME: home, SPEX_HOOK_MANIFEST: manifest },
    input: JSON.stringify({ session_id: sid, hook_event_name: 'Stop', stop_hook_active: true }),
    encoding: 'utf8',
    timeout: 2000,
  })
  assert.equal(result.status, 0, result.error?.message || result.stderr)
  const entries = readFileSync(calls, 'utf8').trim().split('\n')
  assert.ok(entries.some((entry) => entry.startsWith(`internal session-state asking --session ${sid}`)))
  assert.ok(!entries.some((entry) => entry.startsWith(`session ask --session ${sid}`)))
})

test('the generated zcode Stop command reaches its manifest stop gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-zcode-stop-dispatch-'))
  const home = join(dir, 'home')
  const sid = 'zcode-generated-stop'
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const initialized = spawnSync(process.execPath, [join(repo, 'spec-cli', 'bin', 'spex.mjs'), 'init', '.', '--harness', 'zcode'], {
    cwd: dir,
    env: { ...process.env, SPEXCODE_HOME: home },
    encoding: 'utf8',
  })
  assert.equal(initialized.status, 0, initialized.stderr)

  const settings = JSON.parse(readFileSync(join(dir, '.zcode', 'settings.json'), 'utf8'))
  const command = settings.hooks.Stop[0].hooks[0].command as string
  assert.match(command, /dispatch\.sh zcode Stop$/, 'the materialized zcode shim must bake its adapter id')

  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  const slot = join(runtime, 'trees', dir.replace(/[/.]/g, '-'))
  assert.match(readFileSync(join(slot, 'hooks-manifest'), 'utf8'), /^Stop\t10\ttrue\t\.spec\/project\/\.plugins\/core\/stop-gate\/stop-gate\.sh$/m)
  assert.match(readFileSync(join(slot, 'harnesses'), 'utf8'), /^zcode$/m)
  const recordDir = join(runtime, 'sessions', sid)
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(join(recordDir, 'runtime.json'), JSON.stringify({
    session_id: sid, governed: true, status: 'active', proposal: '', note: '',
  }, null, 2) + '\n')
  const databasePath = seedCanonicalSessions(home, [{ id: sid, status: 'active' }])

  const result = spawnSync('bash', ['-c', command], {
    cwd: dir,
    env: { ...process.env, SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: databasePath },
    input: JSON.stringify({ session_id: sid, hook_event_name: 'Stop', stop_hook_active: false }),
    encoding: 'utf8',
  })
  assert.equal(result.status, 2, result.stderr)
  assert.match(JSON.parse(result.stdout).reason, /Your session state is a CLAIM/)
})

type GateHarness = 'claude' | 'codex'

function specFirstRig(harness: GateHarness, sequence: string) {
  const dir = mkdtempSync(join(tmpdir(), `spex-spec-first-${harness}-${sequence}-`))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  const sid = `sid-${harness}-${sequence}`
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, '.spec', 'project', 'governed-contract'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(dir, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\nProject scope.\n')
  writeFileSync(join(dir, '.spec', 'project', 'governed-contract', 'spec.md'), [
    '---',
    'title: governed-contract',
    'status: active',
    'desc: The contract for the governed fixture.',
    'code:',
    '  - src/governed.ts',
    '---',
    'Governed behavior.',
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'src', 'governed.ts'), 'export const governed = true\n')
  writeFileSync(join(dir, 'src', 'ungoverned.ts'), 'export const ungoverned = true\n')
  const hook = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'spec-first', 'spec-first.sh')
  writeFileSync(join(dir, 'hooks', 'spec-first.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(hook)}\n`)
  const manifest = join(runtime, 'hooks-manifest')
  writeFileSync(manifest, 'PreToolUse\t20\ttrue\thooks/spec-first.sh\n')
  const env = {
    ...process.env,
    SPEX: join(repo, 'spec-cli', 'bin', 'spex.mjs'),
    SPEXCODE_HOME: home,
    SPEX_HOOK_MANIFEST: manifest,
  }
  const payload = (path: string, operation: 'read' | 'mutate' = 'read') => harness === 'claude'
    ? JSON.stringify({
        session_id: sid,
        hook_event_name: 'PreToolUse',
        tool_name: operation === 'read' ? 'Read' : 'Edit',
        tool_input: { file_path: path },
      })
    : JSON.stringify({
        session_id: sid,
        hook_event_name: 'PreToolUse',
        tool_name: operation === 'read' ? 'Bash' : 'apply_patch',
        tool_input: { command: operation === 'read' ? `sed -n '1p' ${path}` : `*** Update File: ${path}\n@@\n` },
      })
  const fire = (path: string, operation: 'read' | 'mutate' = 'read') => spawnSync(
    'bash', [dispatch, harness, 'PreToolUse'], { cwd: dir, env, input: payload(path, operation), encoding: 'utf8' },
  )
  return { fire, sentinel: join(runtime, 'sessions', sid, 'spec-checked') }
}

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness} spec-first: ungoverned then governed keeps the gate armed`, () => {
    const t = specFirstRig(harness, 'ungoverned-governed')
    const uncovered = t.fire('src/ungoverned.ts')
    assert.equal(uncovered.status, 0, uncovered.stderr)
    assert.equal(existsSync(t.sentinel), false, 'an ungoverned read must not consume the session gate')

    const governed = t.fire('src/governed.ts')
    assert.equal(governed.status, 2, governed.stderr)
    assert.match(governed.stdout + governed.stderr, /governed-contract/)
    assert.match(governed.stdout + governed.stderr, /\.spec\/project\/governed-contract\/spec\.md/)
    assert.match(governed.stdout + governed.stderr, /NEIGHBORS/)
    assert.equal(existsSync(t.sentinel), true)
    assert.equal(t.fire('src/governed.ts').status, 0, 'the governed retry proceeds after the one-shot demand')
  })

  test(`${harness} spec-first: repeated ungoverned reads never mute a later governed read`, () => {
    const t = specFirstRig(harness, 'repeated-ungoverned')
    assert.equal(t.fire('src/ungoverned.ts').status, 0)
    assert.equal(t.fire('src/ungoverned.ts').status, 0)
    assert.equal(existsSync(t.sentinel), false, 'repeated ungoverned reads leave the state untouched')
    assert.equal(t.fire('src/governed.ts').status, 2)
  })

  test(`${harness} spec-first: governed-first blocks exactly once`, () => {
    const t = specFirstRig(harness, 'governed-first')
    assert.equal(t.fire('src/governed.ts').status, 2)
    assert.equal(t.fire('src/governed.ts').status, 0)
  })

  test(`${harness} spec-first: a governed WRITE spends the gate, because a blind write is the case the rule is for`, () => {
    const t = specFirstRig(harness, 'mutation-is-access')
    const mutation = t.fire('src/governed.ts', 'mutate')
    assert.equal(mutation.status, 2, mutation.stderr)
    assert.match(mutation.stdout + mutation.stderr, /governed-contract/)
    assert.equal(existsSync(t.sentinel), true, 'a governed mutation is a governed access')
    assert.equal(t.fire('src/governed.ts', 'mutate').status, 0, 'the retry proceeds after the one-shot demand')
    assert.equal(t.fire('src/governed.ts').status, 0, 'and the gate stays spent for reads too')
  })

  test(`${harness} spec-first: an ungoverned write leaves the gate armed for the first governed touch`, () => {
    const t = specFirstRig(harness, 'ungoverned-write')
    assert.equal(t.fire('src/ungoverned.ts', 'mutate').status, 0)
    assert.equal(existsSync(t.sentinel), false, 'an ungoverned mutation must not consume the session gate')
    assert.equal(t.fire('src/governed.ts', 'mutate').status, 2)
  })
}

function specOfFileRig(harness: GateHarness) {
  const dir = mkdtempSync(join(tmpdir(), `spex-spec-of-file-${harness}-`))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  const sid = `sid-${harness}-edit`
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, '.spec', 'project'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  writeFileSync(join(dir, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\nProject scope.\n')
  writeFileSync(join(dir, 'src', 'novel.ts'), 'export const novel = true\n')
  const hook = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'spec-of-file', 'spec-of-file.sh')
  writeFileSync(join(dir, 'hooks', 'spec-of-file.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(hook)}\n`)
  const manifest = join(runtime, 'hooks-manifest')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(manifest, 'PostToolUse\t10\tfalse\thooks/spec-of-file.sh\n')
  const payload = harness === 'claude'
    ? JSON.stringify({ session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'src/novel.ts' } })
    : JSON.stringify({ session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Update File: src/novel.ts\n@@\n' } })
  const fire = () => spawnSync('bash', [dispatch, harness, 'PostToolUse'], {
    cwd: dir,
    env: { ...process.env, SPEX: join(repo, 'spec-cli', 'bin', 'spex.mjs'), SPEXCODE_HOME: home, SPEX_HOOK_MANIFEST: manifest },
    input: payload,
    encoding: 'utf8',
  })
  return { fire }
}

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness} spec-of-file: actionable edit emits the registry prompt once`, () => {
    const t = specOfFileRig(harness)
    const first = t.fire()
    assert.equal(first.status, 0, first.stderr)
    const context = JSON.parse(first.stdout).hookSpecificOutput.additionalContext as string
    assert.match(context, /^Contract context for this edit:/)
    assert.match(context, /src\/novel\.ts — no spec claims this yet \(uncovered\)/)
    const second = t.fire()
    assert.equal(second.status, 0, second.stderr)
    assert.equal(second.stdout, '', 'the same file must not inject a second annotation')
  })
}

test('codex mark-active resolves by payload thread id despite contaminated SPEXCODE_SESSION_ID', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-codex-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, '.spec', 'spexcode', '.plugins'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(runtime, 'sessions', 'id_A'), { recursive: true })
  mkdirSync(join(runtime, 'sessions', 'id_B'), { recursive: true })
  const hook = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'mark-active', 'mark-active.sh')
  writeFileSync(join(dir, 'hooks', 'mark-active.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(hook)}\n`)
  writeFileSync(join(runtime, 'hooks-manifest'), 'PreToolUse\t10\tfalse\thooks/mark-active.sh\n')
  // no content-hash pinning needed: the dispatcher never materializes ([[commit-surgery]] — the old gate is
  // retired), so the handcrafted manifest can never be re-materialized away by a dispatch.
  writeFileSync(join(runtime, 'sessions', 'id_A', 'runtime.json'), JSON.stringify({
    session_id: 'id_A', governed: true, status: 'asking', proposal: 'old', note: 'wrong',
  }, null, 2))
  writeFileSync(join(runtime, 'sessions', 'id_B', 'runtime.json'), JSON.stringify({
    session_id: 'id_B', governed: true, status: 'asking', proposal: 'old', note: 'right',
    harness_session_id: 'thread_B',
  }, null, 2))
  const databasePath = seedCanonicalSessions(home, [
    { id: 'id_A', status: 'asking', proposal: 'old', note: 'wrong' },
    { id: 'id_B', status: 'asking', proposal: 'old', note: 'right' },
  ])
  const r = spawnSync('bash', [dispatch, 'codex', 'PreToolUse'], {
    cwd: dir,
    env: {
      ...process.env,
      SPEX: join(repo, 'spec-cli', 'bin', 'spex.mjs'),
      SPEX_HOOK_MANIFEST: join(runtime, 'hooks-manifest'),
      SPEXCODE_HOME: home,
      SPEX_SESSION_DATABASE_PATH: databasePath,
      SPEXCODE_SESSION_ID: 'id_A',
    },
    input: JSON.stringify({ session_id: 'thread_B', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'sleep 1' } }),
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(readFileSync(join(runtime, 'sessions', 'id_A', 'runtime.json'), 'utf8'), /"status": "asking"/)
  const b = readFileSync(join(runtime, 'sessions', 'id_B', 'runtime.json'), 'utf8')
  assert.match(b, /"status": "asking"/, 'runtime metadata remains a stale envelope, never lifecycle authority')
  const canonical = openProjectSessionApplication({ databasePath, locality: () => {} })
  try {
    assert.equal(canonical.readState('id_B')?.status, 'active')
    assert.equal(canonical.readState('id_B')?.proposal, null)
    assert.equal(canonical.readState('id_B')?.note, null)
  } finally { canonical.close() }
})

test('mark-active never trusts the runtime envelope to skip the canonical writer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-canonical-writer-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  const sid = 'canonical-writer'
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(runtime, 'sessions', sid), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  const hook = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'mark-active', 'mark-active.sh')
  writeFileSync(join(dir, 'hooks', 'mark-active.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(hook)}\n`)
  const manifest = join(runtime, 'hooks-manifest')
  writeFileSync(manifest, 'PreToolUse\t10\tfalse\thooks/mark-active.sh\n')
  const record = join(runtime, 'sessions', sid, 'runtime.json')
  // This is deliberately the stale envelope shape that caused the production drift: it says active while
  // the canonical application may still be asking/close-pending. The hook must still call the one writer.
  writeFileSync(record, JSON.stringify({ session_id: sid, governed: true, status: 'active', proposal: '', note: '' }, null, 2))
  const called = join(dir, 'writer-args')
  const fakeSpex = join(dir, 'fake-spex')
  writeFileSync(fakeSpex, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${JSON.stringify(called)}\n`)
  chmodSync(fakeSpex, 0o755)
  const result = spawnSync('bash', [dispatch, 'claude', 'PreToolUse'], {
    cwd: dir,
    env: {
      ...process.env,
      SPEX: fakeSpex,
      SPEXCODE_HOME: home,
      SPEX_HOOK_MANIFEST: manifest,
    },
    input: JSON.stringify({ session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } }),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(called, 'utf8').trim(), `internal session-state active --session ${sid}`)
})

test('managed watch UserPromptSubmit does not forge receiver activity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-watch-freshness-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  const sid = 'watch-receiver'
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(runtime, 'sessions', sid), { recursive: true })
  const hook = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'mark-active', 'mark-active.sh')
  writeFileSync(join(dir, 'hooks', 'mark-active.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(hook)}\n`)
  const manifest = join(runtime, 'hooks-manifest')
  writeFileSync(manifest, 'UserPromptSubmit\t10\tfalse\thooks/mark-active.sh\n')
  const record = join(runtime, 'sessions', sid, 'runtime.json')
  const databasePath = seedCanonicalSessions(home, [{ id: sid, status: 'asking', note: 'waiting' }])
  const fakeSpex = join(dir, 'fake-spex')
  const calls = join(dir, 'calls')
  writeFileSync(fakeSpex, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n`)
  chmodSync(fakeSpex, 0o755)
  const fire = (status: string, prompt: string) => {
    writeFileSync(record, JSON.stringify({ session_id: sid, governed: true, status, proposal: '', note: 'waiting' }, null, 2))
    return spawnSync('bash', [dispatch, 'claude', 'UserPromptSubmit'], {
      cwd: dir,
      env: { ...process.env, SPEX: fakeSpex, SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: databasePath, SPEX_HOOK_MANIFEST: manifest },
      input: JSON.stringify({ session_id: sid, hook_event_name: 'UserPromptSubmit', prompt }),
      encoding: 'utf8',
    })
  }
  const watch = fire('asking', '[spex watch] child is asking')
  assert.equal(watch.status, 0, watch.stderr)
  assert.equal(existsSync(calls), false, 'a protocol watch notice must not call the active writer')
  const ordinary = fire('asking', 'continue with the requested audit')
  assert.equal(ordinary.status, 0, ordinary.stderr)
  assert.equal(readFileSync(calls, 'utf8').trim(), `internal session-state active --session ${sid}`)
})

// [[hook-dispatch]] per-tree slots — with no SPEX_HOOK_MANIFEST override, the dispatcher reads the manifest
// from ITS OWN tree's slot (trees/<enc(toplevel)>), derived from the dispatch cwd; a pre-slot tree (the
// migration uses a per-tree slot; a missing slot is an installation error.
function slotRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-slot-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  writeFileSync(join(dir, 'hooks', 'echo.sh'), '#!/usr/bin/env bash\necho SLOT-HIT\n')
  const env = { ...process.env, SPEXCODE_HOME: home }
  delete (env as Record<string, unknown>).SPEX_HOOK_MANIFEST
  delete (env as Record<string, unknown>).CLAUDE_PROJECT_DIR   // dispatch must derive proj from cwd here
  return { dir, runtime, env }
}

test('dispatch reads the manifest from the dispatching tree\'s own slot', () => {
  const { dir, runtime, env } = slotRepo()
  const slot = join(runtime, 'trees', dir.replace(/[/.]/g, '-'))
  mkdirSync(slot, { recursive: true })
  writeFileSync(join(slot, 'hooks-manifest'), 'SessionStart\t10\tfalse\thooks/echo.sh\n')
  writeFileSync(join(slot, 'harnesses'), 'claude\n')
  const allowed = spawnSync('bash', [dispatch, 'claude', 'SessionStart'], { cwd: dir, env, input: '{}', encoding: 'utf8' })
  assert.equal(allowed.status, 0, allowed.stderr)
  assert.match(allowed.stdout, /SLOT-HIT/)
  const siblingOnly = spawnSync('bash', [dispatch, 'codex', 'SessionStart'], { cwd: dir, env, input: '{}', encoding: 'utf8' })
  assert.equal(siblingOnly.status, 0, siblingOnly.stderr)
  assert.equal(siblingOnly.stdout, '', 'a shared shim is inert when this tree did not select its harness')
})

test('slot-less dispatch fails loudly instead of using a legacy global manifest', () => {
  const { dir, runtime, env } = slotRepo()
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'hooks-manifest'), 'SessionStart\t10\tfalse\thooks/echo.sh\n')
  const result = spawnSync('bash', [dispatch, 'claude', 'SessionStart'], { cwd: dir, env, input: '{}', encoding: 'utf8' })
  assert.equal(result.status, 78)
  assert.match(result.stderr, /current tree has no hook manifest/)
})

// [[mark-active]] in-process subagents (issue #60) — a Task-subagent tool call fires the PARENT's hooks with
// the PARENT's session_id but a top-level agent_id stamp. mark-active must skip it (a parent's declared
// park/ask survives its subagents' activity, so the stop-gate never races its own declaration), while the
// parent's OWN calls (no agent_id) keep flipping to active. The payloads mirror a live capture (claude
// 2.1.207): agent_id sits before tool_input; an agent_id-named TOOL PARAM sits inside tool_input and must
// NOT be mistaken for the stamp.
test('claude mark-active skips a subagent tool call but still flips on the parent\'s own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-subagent-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(runtime, 'sessions', 'sid_P'), { recursive: true })
  const hook = join(repo, '.spec', 'spexcode', '.plugins', 'core', 'mark-active', 'mark-active.sh')
  writeFileSync(join(dir, 'hooks', 'mark-active.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(hook)}\n`)
  writeFileSync(join(runtime, 'hooks-manifest'), 'PreToolUse\t10\tfalse\thooks/mark-active.sh\n')
  const record = () => JSON.stringify({
    session_id: 'sid_P', governed: true, status: 'parked', proposal: '', note: 'waiting on a background wait',
  }, null, 2)
  const databasePath = seedCanonicalSessions(home, [{ id: 'sid_P', status: 'parked', note: 'waiting on a background wait' }])
  const fire = (payload: string, envSession?: string) => spawnSync('bash', [dispatch, 'claude', 'PreToolUse'], {
    cwd: dir,
    env: {
      ...process.env,
      SPEX: join(repo, 'spec-cli', 'bin', 'spex.mjs'),
      SPEX_HOOK_MANIFEST: join(runtime, 'hooks-manifest'),
      SPEXCODE_HOME: home,
      SPEX_SESSION_DATABASE_PATH: databasePath,
      ...(envSession ? { SPEXCODE_SESSION_ID: envSession } : {}),
    },
    input: payload,
    encoding: 'utf8',
  })
  const rec = join(runtime, 'sessions', 'sid_P', 'runtime.json')

  // subagent-executed call: top-level agent_id (harness stamp, before tool_input) → record untouched
  writeFileSync(rec, record())
  let r = fire('{"session_id":"sid_P","transcript_path":"/x/sid_P.jsonl","cwd":"/x","agent_id":"ab737f25195ee419a","agent_type":"general-purpose","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo CHILD"}}')
  assert.equal(r.status, 0, r.stderr)
  let j = readFileSync(rec, 'utf8')
  assert.match(j, /"status": "parked"/, 'a subagent tool call must not clobber the parent\'s declaration')
  assert.match(j, /"note": "waiting on a background wait"/)

  // the parent's own call (no agent_id) still flips to active and clears the note
  r = fire('{"session_id":"sid_P","transcript_path":"/x/sid_P.jsonl","cwd":"/x","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo PARENT"}}')
  assert.equal(r.status, 0, r.stderr)
  j = readFileSync(rec, 'utf8')
  assert.match(j, /"status": "parked"/, 'runtime metadata remains a stale envelope, never lifecycle authority')
  const canonical = openProjectSessionApplication({ databasePath, locality: () => {} })
  try { assert.equal(canonical.readState('sid_P')?.status, 'active'); assert.equal(canonical.readState('sid_P')?.note, null) } finally { canonical.close() }

  // an agent_id-NAMED tool parameter lives inside tool_input (past the scan prefix) → NOT a subagent stamp
  writeFileSync(rec, record())
  r = fire('{"session_id":"sid_P","hook_event_name":"PreToolUse","tool_name":"mcp__x__y","tool_input":{"agent_id":"a-param-not-a-stamp"}}')
  assert.equal(r.status, 0, r.stderr)
  assert.match(readFileSync(rec, 'utf8'), /"status": "parked"/, 'runtime metadata remains a stale envelope')

  // a child whose payload id names no record — not what claude 2.1.207 sends (it forwards the PARENT's id),
  // but the shape identity resolution must survive: the fallback lands on the env parent, and the agent_id
  // stamp is what refuses the write, read before any id resolution.
  writeFileSync(rec, record())
  r = fire('{"session_id":"sid_CHILD","agent_id":"ab737f25195ee419a","agent_type":"general-purpose","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo CHILD"}}', 'sid_P')
  assert.equal(r.status, 0, r.stderr)
  assert.match(readFileSync(rec, 'utf8'), /"status": "parked"/, 'an unresolvable child id resolving to the env parent must still be refused by the stamp')
})

// [[harness-adapter]] — claude's payload id is preferred only while it RESOLVES to a record. A
// compaction/continuation mints a new conversation id while the record keeps the launched one; a blind
// payload preference then names no record and every record-dependent hook silently no-ops.
function identityRig() {
  const dir = mkdtempSync(join(tmpdir(), 'spex-hook-identity-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const record = (sid: string) => {
    mkdirSync(join(runtime, 'sessions', sid), { recursive: true })
    writeFileSync(join(runtime, 'sessions', sid, 'runtime.json'), JSON.stringify({ session_id: sid, governed: true }))
  }
  const resolve = (payloadId: string, envId: string) => spawnSync('bash', ['-c',
    `. "$1"; hp_session_id "$2"`, 'bash', join(repo, 'spec-cli', 'hooks', 'harness.sh'),
    JSON.stringify({ session_id: payloadId, hook_event_name: 'PreToolUse' })], {
    cwd: dir,
    env: { ...process.env, SPEXCODE_HARNESS: 'claude', SPEXCODE_HOME: home, SPEXCODE_SESSION_ID: envId },
    encoding: 'utf8',
  })
  return { record, resolve }
}

test('hp_session_id: an unresolvable claude payload id falls back to the launched record', () => {
  const t = identityRig()
  t.record('launched-record')
  // the live conversation re-minted its id (compaction); no record answers to it
  assert.equal(t.resolve('reminted-conversation', 'launched-record').stdout, 'launched-record')
})

test('hp_session_id: a resolvable claude payload id still wins over the inherited env', () => {
  const t = identityRig()
  t.record('launched-record')
  t.record('subagent-parent')
  // codex's thread alias and any harness whose payload names a live record: the preference is untouched
  assert.equal(t.resolve('subagent-parent', 'launched-record').stdout, 'subagent-parent')
})

test('hp_session_id: a payload-less event still answers with the inherited env id', () => {
  const t = identityRig()
  t.record('launched-record')
  assert.equal(t.resolve('', 'launched-record').stdout, 'launched-record')
})
