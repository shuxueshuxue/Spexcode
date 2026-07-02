import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const dispatch = join(repo, 'spec-cli', 'hooks', 'dispatch.sh')

test('dispatch exits 2 when a blocking handler emits decision:block JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, '.spec', 'x', '.config'), { recursive: true })
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

test('codex mark-active resolves by payload thread id despite contaminated SPEXCODE_SESSION_ID', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-codex-'))
  const home = join(dir, 'home')
  const runtime = join(home, 'projects', dir.replace(/[/.]/g, '-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, '.spec', 'spexcode', '.config'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(runtime, 'sessions', 'id_A'), { recursive: true })
  mkdirSync(join(runtime, 'sessions', 'id_B'), { recursive: true })
  const hook = join(repo, '.spec', 'spexcode', '.config', 'core', 'mark-active', 'mark-active.sh')
  writeFileSync(join(dir, 'hooks', 'mark-active.sh'), `#!/usr/bin/env bash\nbash ${JSON.stringify(hook)}\n`)
  writeFileSync(join(runtime, 'hooks-manifest'), 'PreToolUse\t10\tfalse\thooks/mark-active.sh\n')
  writeFileSync(join(runtime, 'content-hash'), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n')
  writeFileSync(join(runtime, 'sessions', 'id_A', 'session.json'), JSON.stringify({
    session_id: 'id_A', governed: true, status: 'asking', proposal: 'old', note: 'wrong',
  }, null, 2))
  writeFileSync(join(runtime, 'sessions', 'id_B', 'session.json'), JSON.stringify({
    session_id: 'id_B', governed: true, status: 'asking', proposal: 'old', note: 'right',
    harness_session_id: 'thread_B',
  }, null, 2))
  const r = spawnSync('bash', [dispatch, 'codex', 'PreToolUse'], {
    cwd: dir,
    env: {
      ...process.env,
      SPEX_HOOK_MANIFEST: join(runtime, 'hooks-manifest'),
      SPEXCODE_HOME: home,
      SPEXCODE_SESSION_ID: 'id_A',
    },
    input: JSON.stringify({ session_id: 'thread_B', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'sleep 1' } }),
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(readFileSync(join(runtime, 'sessions', 'id_A', 'session.json'), 'utf8'), /"status": "asking"/)
  const b = readFileSync(join(runtime, 'sessions', 'id_B', 'session.json'), 'utf8')
  assert.match(b, /"status": "active"/)
  assert.match(b, /"proposal": ""/)
  assert.match(b, /"note": ""/)
})
