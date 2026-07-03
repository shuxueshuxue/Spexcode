import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { activeTurnIdFromThread, codexAppServerSock, codexHandshakeMessages, codexInjectMessage, codexHarness, claudeHarness, codexLaunchCommand, removeManagedBlock, launcherList, resolveLauncher } from './harness.js'

test('codex handshake initializes, confirms the loaded thread, then reads it to decide steer-vs-start', () => {
  const msgs = codexHandshakeMessages('thr_1')
  assert.equal(msgs[0].method, 'initialize')
  assert.deepEqual(msgs[1], { method: 'initialized', params: {} })
  assert.deepEqual(msgs[2], { id: 2, method: 'thread/loaded/list', params: {} })
  assert.deepEqual(msgs[3], { id: 3, method: 'thread/read', params: { threadId: 'thr_1', includeTurns: true } })
})

test('codex inject STARTS a fresh turn when the thread is idle (no active turn id)', () => {
  assert.deepEqual(codexInjectMessage('thr_1', 'hello', '/repo', null), {
    id: 4,
    method: 'turn/start',
    params: { threadId: 'thr_1', input: [{ type: 'text', text: 'hello', text_elements: [] }], cwd: '/repo' },
  })
})

test('codex inject STEERS the live turn mid-turn when one is in progress', () => {
  assert.deepEqual(codexInjectMessage('thr_1', 'hello', '/repo', 'turn_9'), {
    id: 4,
    method: 'turn/steer',
    params: { threadId: 'thr_1', input: [{ type: 'text', text: 'hello', text_elements: [] }], expectedTurnId: 'turn_9' },
  })
})

test('codex inject can retry a lost steer as a turn/start with id 5', () => {
  assert.equal(codexInjectMessage('thr_1', 'hi', undefined, null, 5).id, 5)
  assert.equal(codexInjectMessage('thr_1', 'hi', undefined, null, 5).method, 'turn/start')
})

test('activeTurnIdFromThread finds the inProgress turn, else null', () => {
  assert.equal(activeTurnIdFromThread({ thread: { turns: [{ id: 't1', status: 'completed' }, { id: 't2', status: 'inProgress' }] } }), 't2')
  assert.equal(activeTurnIdFromThread({ thread: { turns: [{ id: 't1', status: 'completed' }] } }), null)
  assert.equal(activeTurnIdFromThread({ thread: { turns: [] } }), null)
  assert.equal(activeTurnIdFromThread({}), null)
})

test('codex launch command starts app-server then resumes the backend-owned thread on the same socket', () => {
  const cmd = codexLaunchCommand('sess-1', 'codex --yolo', 'codex', '/tmp/spex-project')
  // POSIX-portable mkdir mutex, NOT flock (absent on macOS): the check-and-start is serialized on `mkdir "$lock.d"`
  // and there is no flock / fd-9 gymnastics left on the daemon spawn.
  assert.match(cmd, /mkdir "\$lockd"/)
  assert.doesNotMatch(cmd, /flock/)
  assert.doesNotMatch(cmd, /9>&-/)
  assert.match(cmd, /codex app-server --listen unix:\/\/"\$sock"/)
  // design C: the BACKEND owns the thread — codex-launch does thread/start { cwd } + first turn, prints the id,
  // and the visible TUI resumes THAT thread on the same project socket.
  assert.match(cmd, /codex-launch "\$sock" "\$PWD" "\$@"/)
  assert.match(cmd, /exec codex --yolo --remote unix:\/\/"\$sock" resume "\$tid"/)
  assert.match(cmd, /codex-app-server\.sock/)
  assert.match(cmd, /codex-app-server\.lock/)
  assert.match(cmd, /\/tmp\/spex-project/)
  // resume mode: a `--resume <tid>` tail (reopen's resumeArg) takes the OWNED thread id DIRECTLY — it must NOT
  // run codex-launch (which would mint a NEW thread and fire the tail as a first-turn prompt — the resume bug).
  assert.match(cmd, /if \[ "\$1" = "--resume" \]; then/)
  assert.match(cmd, /tid=\$2/)
})

test('codex resumeArg is a --resume marker for the owned thread, empty when none captured', () => {
  // the tail reopen() hands launch(): a captured thread id → `--resume <id>` (the launch script resumes that
  // thread directly, the SAME conversation); none → empty (relaunch a fresh thread). It is NOT `resume <id>`,
  // which the launch script would feed to codex-launch as a literal first-turn prompt.
  assert.equal(codexHarness.resumeArg({ session: 's1', harnessSessionId: 'th_abc' }), '--resume th_abc')
  assert.equal(codexHarness.resumeArg({ session: 's1', harnessSessionId: null }), '')
})

test('launchCmd cmd override wins over the ambient default (claude + codex) — the launcher-select seam', () => {
  // a session's persisted launcher command overrides the env→config→default resolution, so resume keeps the
  // same auth. claude returns the base command verbatim; codex embeds it as the TUI command in its launch script.
  assert.equal(claudeHarness.launchCmd('id', undefined, '/opt/reclaude --dangerously-skip-permissions'), '/opt/reclaude --dangerously-skip-permissions')
  const codexCmd = codexHarness.launchCmd('id', '/tmp/spex-proj', 'codex-glm --yolo')
  assert.match(codexCmd, /exec codex-glm --yolo --remote/)
})

test('launcherList + resolveLauncher read the named profiles from spexcode.json, fail loud on an unknown name', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-launchers-'))
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({
    sessions: { launchers: { reclaude: { cmd: 'reclaude --dangerously-skip-permissions' }, 'claude-glm': { harness: 'claude', cmd: 'claude-glm --dangerously-skip-permissions' } } },
  }))
  // name-sorted, harness defaults to claude when omitted, cmd carried through.
  assert.deepEqual(launcherList(root), [
    { name: 'claude-glm', harness: 'claude', cmd: 'claude-glm --dangerously-skip-permissions' },
    { name: 'reclaude', harness: 'claude', cmd: 'reclaude --dangerously-skip-permissions' },
  ])
  assert.equal(resolveLauncher('claude-glm', root).cmd, 'claude-glm --dangerously-skip-permissions')
  assert.throws(() => resolveLauncher('nope', root), /unknown launcher 'nope'/)
})

test('launcherList is empty for a zero-config project (no launchers) → the harness picker fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-nolaunchers-'))
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ sessions: { maxActive: 4 } }))
  assert.deepEqual(launcherList(root), [])
})

test('removeManagedBlock strips ONLY the sentinel block, preserving the user bytes', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-mb-'))
  const f = join(proj, 'CLAUDE.md')
  writeFileSync(f, 'my own notes\n\n<!-- spexcode:start -->\nGENERATED CONTRACT\n<!-- spexcode:end -->\n\nmore of my notes\n')
  removeManagedBlock(f, ['<!-- ', ' -->'], true)
  const out = readFileSync(f, 'utf8')
  assert.ok(out.includes('my own notes') && out.includes('more of my notes'))
  assert.ok(!out.includes('spexcode:start') && !out.includes('GENERATED CONTRACT'))
  // a file that carried ONLY the block is deleted when deleteIfEmpty (it was wholly ours).
  const g = join(proj, 'AGENTS.md')
  writeFileSync(g, '<!-- spexcode:start -->\nx\n<!-- spexcode:end -->\n')
  removeManagedBlock(g, ['<!-- ', ' -->'], true)
  assert.ok(!existsSync(g))
})

test('claude clean SURGICALLY removes only spexcode artifacts, sparing user prose + sibling files', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-clean-'))
  // contract file: user prose + our managed block
  const claudeMd = join(proj, 'CLAUDE.md')
  writeFileSync(claudeMd, 'USER PROSE\n\n<!-- spexcode:start -->\ncontract\n<!-- spexcode:end -->\n')
  // our generated shim (carries the dispatch.sh marker) and a user's UNRELATED settings file elsewhere
  mkdirSync(join(proj, '.claude'), { recursive: true })
  const shim = join(proj, '.claude', 'settings.json')
  writeFileSync(shim, JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'bash /pkg/hooks/dispatch.sh claude Stop' }] }] } }))
  // a spexcode skill + a USER skill in the same dir; a spexcode agent + a USER agent
  mkdirSync(join(proj, '.claude', 'skills', 'spec-scout'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'skills', 'spec-scout', 'SKILL.md'), 'generated')
  mkdirSync(join(proj, '.claude', 'skills', 'my-skill'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'mine')
  mkdirSync(join(proj, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'agents', 'spec-scout.md'), 'generated')
  writeFileSync(join(proj, '.claude', 'agents', 'mine.md'), 'mine')

  claudeHarness.clean(proj, { skills: ['spec-scout'], agents: ['spec-scout'] })

  const md = readFileSync(claudeMd, 'utf8')
  assert.ok(md.includes('USER PROSE') && !md.includes('spexcode:start'))         // prose kept, block gone
  assert.ok(!existsSync(shim))                                                   // our shim deleted
  assert.ok(!existsSync(join(proj, '.claude', 'skills', 'spec-scout')))          // our skill pruned
  assert.ok(existsSync(join(proj, '.claude', 'skills', 'my-skill')))             // user skill spared
  assert.ok(!existsSync(join(proj, '.claude', 'agents', 'spec-scout.md')))       // our agent pruned
  assert.ok(existsSync(join(proj, '.claude', 'agents', 'mine.md')))              // user agent spared
})

test('clean leaves a foreign (non-spexcode) shim file untouched', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-clean2-'))
  mkdirSync(join(proj, '.claude'), { recursive: true })
  const shim = join(proj, '.claude', 'settings.json')
  writeFileSync(shim, JSON.stringify({ permissions: { allow: ['Bash'] } }))     // user's own, no dispatch marker
  claudeHarness.clean(proj, { skills: [], agents: [] })
  assert.ok(existsSync(shim))
})

test('codex liveness tracks the per-project app-server socket + tmux, not the thread id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-codex-live-'))
  // no socket yet → offline regardless of the stored thread id
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: 'codex-thread-1' }, true, dir), 'offline')
  writeFileSync(codexAppServerSock(dir), '')
  // socket present + tmux up → online (the thread id is owned by the backend, not the liveness signal)
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: null }, true, dir), 'online')
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: 'codex-thread-1' }, true, dir), 'online')
  // tmux down → offline even with the socket present
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: 'codex-thread-1' }, false, dir), 'offline')
})
