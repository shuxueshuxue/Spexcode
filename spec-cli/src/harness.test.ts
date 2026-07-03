import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { activeTurnIdFromThread, codexAppServerSock, codexBinary, codexHandshakeMessages, codexInjectMessage, codexHarness, claudeHarness, codexLaunchCommand, paneRunsCodex, codexRolloutExists, writeManagedBlock, removeManagedBlock, launcherList, resolveLauncher } from './harness.js'

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
  // the app-server socket lives on a SHORT sun_path-safe path (spexcode-cx-<hash>.sock off tmpdir), NOT the old
  // `<runtimeDir>/codex-app-server.sock` that blew past macOS's ~104-byte sun_path cap on a deep project path.
  assert.match(cmd, /spexcode-cx-[0-9a-f]+\.sock/)
  assert.doesNotMatch(cmd, /codex-app-server\.sock/)
  // pid/log/lock (no sun_path limit) still live under the runtime dir; self-heal drops the orphaned pre-fix lock FILE.
  assert.match(cmd, /codex-app-server\.lock/)
  assert.match(cmd, /rm -f "\$lock"/)
  assert.match(cmd, /\/tmp\/spex-project/)
  // resume mode: a `--resume <tid>` tail (reopen's resumeArg) takes the OWNED thread id DIRECTLY — it must NOT
  // run codex-launch (which would mint a NEW thread and fire the tail as a first-turn prompt — the resume bug).
  assert.match(cmd, /if \[ "\$1" = "--resume" \]; then/)
  assert.match(cmd, /tid=\$2/)
  // codex-launch only prints an id once its rollout is resume-ready; a fail-loud (non-zero / empty) must ABORT,
  // never `resume ""` — so the codex-launch call propagates failure and an empty tid is guarded before resume.
  assert.match(cmd, /codex-launch "\$sock" "\$PWD" "\$@"\) \|\| exit 1/)
  assert.match(cmd, /\[ -n "\$tid" \] \|\| \{ echo .* exit 1; \}/)
})

test('codexRolloutExists finds a thread by id only once its rollout file lands on disk', () => {
  const home = mkdtempSync(join(tmpdir(), 'cx-home-'))
  const day = join(home, '2026', '07', '03')
  mkdirSync(day, { recursive: true })
  const tid = '019f2784-0794-78e0-91e9-785b6719c4a6'
  // thread/start alone writes NO rollout (verified live) → resume-not-ready until the first turn materializes it
  assert.equal(codexRolloutExists(tid, join(home, 'sessions')), false)   // sessions dir empty
  mkdirSync(join(home, 'sessions', '2026', '07', '03'), { recursive: true })
  writeFileSync(join(home, 'sessions', '2026', '07', '03', `rollout-2026-07-03T03-26-32-${tid}.jsonl`), '{}\n')
  assert.equal(codexRolloutExists(tid, join(home, 'sessions')), true)
  assert.equal(codexRolloutExists('nonexistent-thread', join(home, 'sessions')), false)
})

test('codex app-server runs the SAME install as the launcher/resume (version parity across the one socket)', () => {
  // The app-server binary is DERIVED from codexCmd's binary (its first shell token), not a bare `codex` off
  // PATH: on a multi-install host a bare `codex` app-server can be a DIFFERENT version than the launcher's
  // `--remote … resume`, and that skew breaks the thread/start→resume handoff. codexBinary strips args.
  assert.equal(codexBinary('codex --yolo'), 'codex')
  assert.equal(codexBinary('/opt/foo/codex --yolo'), '/opt/foo/codex')
  assert.equal(codexBinary('  /abs/codex  '), '/abs/codex')
  // With no explicit serverCmd, the app-server line uses the launcher's OWN binary — never bare `codex`.
  const derived = codexLaunchCommand('s', '/opt/foo/codex --yolo', undefined, '/tmp/spex-project')
  assert.match(derived, /\/opt\/foo\/codex app-server --listen unix:\/\/"\$sock"/)
  assert.match(derived, /exec \/opt\/foo\/codex --yolo --remote unix:\/\/"\$sock" resume "\$tid"/)
  // the app-server token and the resume token are the SAME install — no bare `codex app-server`.
  assert.doesNotMatch(derived, /(?:^|\s)codex app-server/m)
  // SPEXCODE_CODEX_SERVER_CMD remains the explicit escape hatch (highest precedence, overrides the derivation).
  const prevEnv = process.env.SPEXCODE_CODEX_SERVER_CMD
  try {
    process.env.SPEXCODE_CODEX_SERVER_CMD = '/custom/codex-server'
    const overridden = codexLaunchCommand('s', '/opt/foo/codex --yolo', undefined, '/tmp/spex-project')
    assert.match(overridden, /\/custom\/codex-server app-server --listen unix:\/\/"\$sock"/)
    // resume still tracks the launcher binary — the override targets ONLY the app-server.
    assert.match(overridden, /exec \/opt\/foo\/codex --yolo --remote/)
  } finally {
    if (prevEnv === undefined) delete process.env.SPEXCODE_CODEX_SERVER_CMD
    else process.env.SPEXCODE_CODEX_SERVER_CMD = prevEnv
  }
})

test('codex app-server socket path is short (sun_path-safe), stable per project, and identical across seams', () => {
  // A realistically DEEP macOS project path — its encodeProject flattening is exactly what blew past the cap.
  const deep = '/Users/lexicalmathical/Codebase/gugu-bloome-acp/some/nested/worktree/checkout'
  const sock = codexAppServerSock(deep)
  // well under macOS's ~104-byte sun_path ceiling (leave real headroom for a long per-user $TMPDIR).
  assert.ok(sock.length < 104, `sock path ${sock.length} chars must stay under 104 (got ${sock})`)
  assert.match(sock, /spexcode-cx-[0-9a-f]{16}\.sock$/)
  // STABLE per project: same identity → same sock (so launch, liveness, and delivery agree without coordination).
  assert.equal(codexAppServerSock(deep), sock)
  // DISTINCT per project: a different identity → a different sock (one app-server per project, no cross-talk).
  assert.notEqual(codexAppServerSock(deep + '/other'), sock)
  // the launch script embeds EXACTLY the sock that liveness/delivery compute for the same project identity.
  assert.ok(codexLaunchCommand('s', 'codex --yolo', 'codex', deep).includes(sock))
  // SPEXCODE_CODEX_SOCKET_DIR relocates the socket base while keeping the per-project hashed filename.
  const prev = process.env.SPEXCODE_CODEX_SOCKET_DIR
  try {
    process.env.SPEXCODE_CODEX_SOCKET_DIR = '/tmp/cx'
    assert.equal(codexAppServerSock(deep), join('/tmp/cx', `spexcode-cx-${sock.match(/spexcode-cx-([0-9a-f]{16})/)![1]}.sock`))
  } finally {
    if (prev === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = prev
  }
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

test('managed-block write→remove is a BYTE-FAITHFUL round-trip (preserves the user\'s own whitespace) — the private⇄default cancel-out invariant', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-mb-rt-'))
  const f = join(proj, '.gitignore')
  // user content carrying an INTERNAL blank-line run — the exact shape a global `\n{3,}→\n\n` collapse mangled
  const G = 'node_modules/\nartifacts/\n\n\n# section two\ndist/\n'
  writeFileSync(f, G)
  writeManagedBlock(f, 'a.sock\nb.json', ['# ', ''])
  assert.ok(readFileSync(f, 'utf8').includes('# spexcode:start'), 'block was written')
  removeManagedBlock(f, ['# ', ''], false)
  assert.equal(readFileSync(f, 'utf8'), G, 'remove must restore the user file BYTE-for-byte (incl the \\n\\n\\n run)')
  // idempotent: writing the same block twice yields one block, identical bytes
  writeManagedBlock(f, 'a.sock\nb.json', ['# ', ''])
  const once = readFileSync(f, 'utf8')
  writeManagedBlock(f, 'a.sock\nb.json', ['# ', ''])
  assert.equal(readFileSync(f, 'utf8'), once, 'writeManagedBlock is idempotent')
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

test('codex liveness reads the pane foreground command, NOT the shared app-server socket', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-codex-live-'))
  const rec = { session: 'spex-1', harnessSessionId: 'codex-thread-1' }
  // FIELD-CONFIRMED FALSE-POSITIVE (macmini): a launch whose `--remote resume` TUI failed leaves the SHARED
  // per-project app-server socket bound while the pane drops back to the shell. Sock present must NOT read online.
  writeFileSync(codexAppServerSock(dir), '')
  assert.equal(codexHarness.liveness(rec, true, dir, 'bash'), 'offline')   // pane at the shell → offline despite the sock
  assert.equal(codexHarness.liveness(rec, true, dir, '-zsh'), 'offline')   // login shell (tmux may drop the '-') → offline
  // HAPPY STATE: the visible codex TUI is the pane's foreground command → online.
  assert.equal(codexHarness.liveness(rec, true, dir, 'codex'), 'online')
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: null }, true, dir, 'codex'), 'online')
  assert.equal(codexHarness.liveness(rec, true, dir, 'codex-glm'), 'online')   // a renamed binary / launcher wrapper still reads live
  // tmux down → offline even when a codex command lingers in a stale snapshot
  assert.equal(codexHarness.liveness(rec, false, dir, 'codex'), 'offline')
  // pane command unavailable (tmux couldn't report it) → not-live
  assert.equal(codexHarness.liveness(rec, true, dir, undefined), 'offline')
})

test('paneRunsCodex: a codex/wrapper command is live; a bare shell (booting or failed launch) is not', () => {
  for (const shell of ['sh', 'bash', '-bash', 'zsh', 'dash', 'fish', 'ksh']) assert.equal(paneRunsCodex(shell), false, shell)
  for (const cmd of ['codex', 'codex-glm', 'reclaude', 'node']) assert.equal(paneRunsCodex(cmd), true, cmd)
  assert.equal(paneRunsCodex(undefined), false)
  assert.equal(paneRunsCodex(''), false)
})
