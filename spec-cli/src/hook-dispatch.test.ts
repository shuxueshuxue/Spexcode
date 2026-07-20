import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const dispatch = join(repo, 'spec-cli', 'hooks', 'dispatch.sh')

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

  test(`${harness} spec-first: event-wide non-read delivery leaves the read gate untouched`, () => {
    const t = specFirstRig(harness, 'mutation-is-irrelevant')
    assert.equal(t.fire('src/governed.ts', 'mutate').status, 0)
    assert.equal(existsSync(t.sentinel), false, 'a governed mutation is not a governed read')
    assert.equal(t.fire('src/governed.ts').status, 2)
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

// [[hook-dispatch]] per-tree slots — with no SPEX_HOOK_MANIFEST override, the dispatcher reads the manifest
// from ITS OWN tree's slot (trees/<enc(toplevel)>), derived from the dispatch cwd; a pre-slot tree (the
// migration window) falls back to the legacy global file so its hooks never silently no-op.
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
  const r = spawnSync('bash', [dispatch, 'claude', 'SessionStart'], { cwd: dir, env, input: '{}', encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /SLOT-HIT/)
})

test('a slot-less tree falls back to the legacy global manifest (migration window), and the slot wins once present', () => {
  const { dir, runtime, env } = slotRepo()
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'hooks-manifest'), 'SessionStart\t10\tfalse\thooks/echo.sh\n')
  const legacy = spawnSync('bash', [dispatch, 'claude', 'SessionStart'], { cwd: dir, env, input: '{}', encoding: 'utf8' })
  assert.equal(legacy.status, 0, legacy.stderr)
  assert.match(legacy.stdout, /SLOT-HIT/, 'pre-slot tree: hooks still fire off the legacy global manifest')
  // the tree gains its slot (what the next git-native anchor plants) — the slot now shadows the legacy file
  const slot = join(runtime, 'trees', dir.replace(/[/.]/g, '-'))
  mkdirSync(slot, { recursive: true })
  writeFileSync(join(slot, 'hooks-manifest'), '')   // this tree compiles to NO SessionStart hooks
  const slotted = spawnSync('bash', [dispatch, 'claude', 'SessionStart'], { cwd: dir, env, input: '{}', encoding: 'utf8' })
  assert.equal(slotted.status, 0, slotted.stderr)
  assert.ok(!/SLOT-HIT/.test(slotted.stdout), 'the slot shadows the legacy file even when it dispatches nothing')
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
  const fire = (payload: string) => spawnSync('bash', [dispatch, 'claude', 'PreToolUse'], {
    cwd: dir,
    env: { ...process.env, SPEX_HOOK_MANIFEST: join(runtime, 'hooks-manifest'), SPEXCODE_HOME: home },
    input: payload,
    encoding: 'utf8',
  })
  const rec = join(runtime, 'sessions', 'sid_P', 'session.json')

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
  assert.match(j, /"status": "active"/, 'the freshness signal itself must survive the fix')
  assert.match(j, /"note": ""/)

  // an agent_id-NAMED tool parameter lives inside tool_input (past the scan prefix) → NOT a subagent stamp
  writeFileSync(rec, record())
  r = fire('{"session_id":"sid_P","hook_event_name":"PreToolUse","tool_name":"mcp__x__y","tool_input":{"agent_id":"a-param-not-a-stamp"}}')
  assert.equal(r.status, 0, r.stderr)
  assert.match(readFileSync(rec, 'utf8'), /"status": "active"/, 'a tool param named agent_id must still flip (deterministic prefix scan)')
})
