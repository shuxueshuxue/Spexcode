import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, statSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { activeTurnIdFromThread, codexAppServerSock, codexBinary, codexHandshakeMessages, codexInjectMessage, codexHarness, claudeHarness, opencodeHarness, piHarness, codexLaunchCommand, paneTreeRunsCodex, codexRolloutExists, writeManagedBlock, removeManagedBlock, launcherList, dashboardLauncherList, resolveLauncher, defaultLauncher, launcherDefault, writeCodexTrust, rendezvousListening, rvSock, deliverViaRendezvous } from './harness.js'

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
  process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST = '0'   // pin the no-flag baseline (the real --help probe is machine-dependent)
  try {
  const cmd = codexLaunchCommand('sess-1', 'codex --yolo', 'codex', '/tmp/spex-project')
  // POSIX-portable mkdir mutex, NOT flock (absent on macOS): the check-and-start is serialized on `mkdir "$lock.d"`
  // and there is no flock / fd-9 gymnastics left on the daemon spawn.
  assert.match(cmd, /mkdir "\$lockd"/)
  assert.doesNotMatch(cmd, /flock/)
  assert.doesNotMatch(cmd, /9>&-/)
  assert.match(cmd, /codex app-server --listen unix:\/\/"\$sock"/)
  // the shared per-project daemon runs in the STABLE runtime dir "$dir", NOT the transient worktree — else a
  // later worktree deletion dead-cwds the daemon and every future thread's config load fails with ENOENT.
  assert.match(cmd, /\(\s*cd "\$dir" && exec [^\n]*app-server --listen unix:\/\/"\$sock"/)
  // design C: the BACKEND owns the thread — codex-launch does thread/start { cwd } + first turn, prints the id,
  // and the visible TUI resumes THAT thread on the same project socket.
  assert.match(cmd, /internal codex-launch "\$sock" "\$PWD" "\$@"/)
  assert.match(cmd, /exec codex --yolo --remote unix:\/\/"\$sock" resume "\$tid"/)
  // the app-server socket lives on a SHORT sun_path-safe path (spexcode-cx-<hash>.sock off tmpdir), NOT the old
  // `<runtimeDir>/codex-app-server.sock` that blew past macOS's ~104-byte sun_path cap on a deep project path.
  assert.match(cmd, /spexcode-cx-[0-9a-f]+\.sock/)
  assert.doesNotMatch(cmd, /codex-app-server\.sock/)
  // pid/log/lock (no sun_path limit) still live under the runtime dir; self-heal drops the orphaned pre-fix lock FILE.
  assert.match(cmd, /codex-app-server\.lock/)
  assert.match(cmd, /rm -f "\$lock"/)
  assert.match(cmd, /\/tmp\/spex-project/)
  // resume mode: a `--resume <tid>` tail (resumeSession's resumeArg) takes the OWNED thread id DIRECTLY — it must NOT
  // run codex-launch (which would mint a NEW thread and fire the tail as a first-turn prompt — the resume bug).
  assert.match(cmd, /if \[ "\$1" = "--resume" \]; then/)
  assert.match(cmd, /tid=\$2/)
  // codex-launch only prints an id once its rollout is resume-ready; a fail-loud (non-zero / empty) must ABORT,
  // never `resume ""` — so the codex-launch call propagates failure and an empty tid is guarded before resume.
  assert.match(cmd, /internal codex-launch "\$sock" "\$PWD" "\$@"\) \|\| exit 1/)
  assert.match(cmd, /\[ -n "\$tid" \] \|\| \{ echo .* exit 1; \}/)
  } finally { delete process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST }
})

test('codex launch puts --dangerously-bypass-hook-trust on the RESUME TUI, not on the (inert) app-server invocation', () => {
  // codex >=0.142 requires per-thread hook trust to run hooks; the bypass flag runs our own vetted hooks WITHOUT
  // the fragile pinned hash. But the flag only reaches a thread's trust as a per-request `config` override — codex's
  // `--remote resume` client forwards it into thread/start+thread/resume config, so it belongs on the resume TUI.
  // On the `codex app-server` invocation the app-server NEVER reads it for a thread (it was inert there — the bug),
  // so the launch does NOT put it on the app-server; the backend-owned thread carries bypass via codexStartThread.
  process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST = '1'
  try {
    const cmd = codexLaunchCommand('s', 'codex --yolo', 'codex', '/tmp/spex-project')
    assert.match(cmd, /exec codex --yolo --dangerously-bypass-hook-trust --remote/)  // on the resume TUI (forwarded to thread config)
    assert.match(cmd, /(?:^|\s)codex app-server --listen/m)                          // app-server carries NO bypass flag
    assert.doesNotMatch(cmd, /--dangerously-bypass-hook-trust app-server/)           // never on the inert app-server invocation
  } finally { delete process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST }
})

test('codex launch EXPORTS the launcher cmd so codex-launch probes the SAME codex (not a fallback bare `codex`)', () => {
  // Regression: on a multi-codex box (old Homebrew `codex` on PATH beside the launcher's newer one), codex-launch's
  // bypass-trust gate resolved `SPEXCODE_CODEX_CMD || 'codex'` — which the launch never set — so it probed the WRONG
  // (old, flag-less) binary, decided "no bypass support", dropped the thread/start bypass, and NO hooks fired. The
  // launch already holds the real launcher cmd; it must pin it into the env the codex-launch child inherits.
  const cmd = codexLaunchCommand('s', '/opt/nvm/v22/bin/codex --yolo', undefined, '/tmp/spex-project')
  // (the export sits inside the outer `bash -lc '…'`, so its own quotes are shell-escaped as '\'' — match loosely)
  assert.match(cmd, /export SPEXCODE_CODEX_CMD=\S*\/opt\/nvm\/v22\/bin\/codex --yolo/)
  // and the export precedes the codex-launch call in the same script, so the child inherits it
  assert.ok(cmd.indexOf('export SPEXCODE_CODEX_CMD') < cmd.indexOf('internal codex-launch "$sock"'))
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

test('codexRolloutExists is immune to future-dated junk day-dirs above the real rollout', () => {
  // live failure shape: a test planted 2099/12/{29,30,31} in the real CODEX_HOME; those sort above every real
  // day-dir, and a newest-3 cap made the scan miss ALL real rollouts — every codex launch died "no rollout".
  const home = mkdtempSync(join(tmpdir(), 'cx-home-'))
  const tid = '019f70f2-6182-7a32-ac76-c85910c90fe2'
  for (const d of ['29', '30', '31']) mkdirSync(join(home, 'sessions', '2099', '12', d), { recursive: true })
  writeFileSync(join(home, 'sessions', '2099', '12', '29', 'rollout-2099-12-29-junk-e2e-1.jsonl'), '{}\n')
  mkdirSync(join(home, 'sessions', '2026', '07', '18'), { recursive: true })
  writeFileSync(join(home, 'sessions', '2026', '07', '18', `rollout-2026-07-18T00-39-20-${tid}.jsonl`), '{}\n')
  assert.equal(codexRolloutExists(tid, join(home, 'sessions')), true)
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
  // the default base is an OWNED per-uid subdir of tmpdir, NEVER bare tmpdir — codex EPERMs binding a unix
  // socket directly in the shared sticky /tmp on a hardened host (fs.protected_regular=2), so the bare-tmpdir
  // default failed every codex launch out of the box (github#30). The derivation guarantees the dir exists.
  const base = dirname(sock)
  assert.notEqual(base, tmpdir(), 'sock must not sit directly in bare tmpdir')
  assert.equal(base, join(tmpdir(), `spexcode-cx-${process.getuid?.() ?? 0}`))
  assert.ok(statSync(base).isDirectory())
  if (process.getuid) assert.equal(statSync(base).mode & 0o777, 0o700)
  // STABLE per project: same identity → same sock (so launch, liveness, and delivery agree without coordination).
  assert.equal(codexAppServerSock(deep), sock)
  // DISTINCT per project: a different identity → a different sock (one app-server per project, no cross-talk).
  assert.notEqual(codexAppServerSock(deep + '/other'), sock)
  // the launch script embeds EXACTLY the sock that liveness/delivery compute for the same project identity.
  assert.ok(codexLaunchCommand('s', 'codex --yolo', 'codex', deep).includes(sock))
  // SPEXCODE_CODEX_SOCKET_DIR relocates the socket base while keeping the per-project hashed filename.
  const prev = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const override = mkdtempSync(join(tmpdir(), 'cx-base-'))
  try {
    process.env.SPEXCODE_CODEX_SOCKET_DIR = override
    assert.equal(codexAppServerSock(deep), join(override, `spexcode-cx-${sock.match(/spexcode-cx-([0-9a-f]{16})/)![1]}.sock`))
  } finally {
    if (prev === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = prev
    rmSync(override, { recursive: true, force: true })
  }
})

test('codex resumeArg is a --resume marker for the owned thread, empty when none captured', () => {
  // the tail resumeSession() hands launch(): a captured thread id → `--resume <id>` (the launch script resumes that
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
  // claude/codex are ORDINARY safe seeded entries (as `spex init` plants them), NOT env-derived built-ins — alongside
  // two custom profiles. harness defaults to claude when omitted; cmd is carried through verbatim.
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({
    sessions: { launchers: {
      claude: { harness: 'claude', cmd: 'claude' },
      codex: { harness: 'codex', cmd: 'codex' },
      reclaude: { cmd: 'reclaude --dangerously-skip-permissions' },
      'claude-glm': { harness: 'claude', cmd: 'claude-glm --dangerously-skip-permissions' },
    } },
  }))
  // Name-sorted, exactly the config's real launchers — no ghost duplicates or derived execution variants.
  assert.deepEqual(launcherList(root), [
    { name: 'claude', harness: 'claude', cmd: 'claude', headless: false },
    { name: 'claude-glm', harness: 'claude', cmd: 'claude-glm --dangerously-skip-permissions', headless: false },
    { name: 'codex', harness: 'codex', cmd: 'codex', headless: false },
    { name: 'reclaude', harness: 'claude', cmd: 'reclaude --dangerously-skip-permissions', headless: false },
  ])
  assert.deepEqual(dashboardLauncherList(root), launcherList(root), 'the four interactive harnesses stay dashboard-visible')
  assert.deepEqual(
    [claudeHarness, codexHarness, opencodeHarness, piHarness].map((h) => h.headless),
    [false, false, false, false],
    'every existing adapter declares the capability explicitly',
  )
  assert.equal(resolveLauncher('claude-glm', root).cmd, 'claude-glm --dangerously-skip-permissions')
  assert.equal(resolveLauncher('codex', root).harness, 'codex')
  assert.throws(() => resolveLauncher('nope', root), /unknown launcher 'nope'/)
})

test('no built-in ghosts: an unseeded config lists NO launchers, and claude/codex are not implicitly resolvable', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-nolaunchers-'))
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ sessions: { maxActive: 4 } }))
  // with no seeded launchers there is nothing to list — the old env-derived built-in claude/codex are gone.
  assert.deepEqual(launcherList(root), [])
  // and `claude`/`codex` are just names like any other: unconfigured → fail loud, never a silent built-in.
  assert.throws(() => resolveLauncher('claude', root), /unknown launcher 'claude'/)
  assert.throws(() => resolveLauncher('codex', root), /unknown launcher 'codex'/)
  assert.throws(() => defaultLauncher(root), /sessions\.defaultLauncher is required/)
  assert.deepEqual(launcherDefault(root), {
    default: null,
    error: 'sessions.defaultLauncher is required for a launch without --launcher; set it in spexcode.json or spexcode.local.json (for example {"sessions":{"defaultLauncher":"claude"}})',
  })
  // seed a claude launcher + name it the default (the shape `spex init` plants) → resolves.
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ sessions: { maxActive: 4, launchers: { claude: { harness: 'claude', cmd: 'claude' } }, defaultLauncher: 'claude' } }))
  assert.equal(defaultLauncher(root), 'claude')
  assert.deepEqual(launcherDefault(root), { default: 'claude', error: null })
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
  mkdirSync(join(proj, '.claude', 'skills', 'sample-agent'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'skills', 'sample-agent', 'SKILL.md'), 'generated')
  mkdirSync(join(proj, '.claude', 'skills', 'my-skill'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'mine')
  mkdirSync(join(proj, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'agents', 'sample-agent.md'), 'generated')
  writeFileSync(join(proj, '.claude', 'agents', 'mine.md'), 'mine')

  claudeHarness.clean(proj, { skills: ['sample-agent'], agents: ['sample-agent'] })

  const md = readFileSync(claudeMd, 'utf8')
  assert.ok(md.includes('USER PROSE') && !md.includes('spexcode:start'))         // prose kept, block gone
  assert.ok(!existsSync(shim))                                                   // our shim deleted
  assert.ok(!existsSync(join(proj, '.claude', 'skills', 'sample-agent')))          // our skill pruned
  assert.ok(existsSync(join(proj, '.claude', 'skills', 'my-skill')))             // user skill spared
  assert.ok(!existsSync(join(proj, '.claude', 'agents', 'sample-agent.md')))       // our agent pruned
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

test('codex liveness walks the pane descendant tree, NOT the foreground name or the shared sock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-codex-live-'))
  const rec = { session: 'spex-1', harnessSessionId: 'codex-thread-1' }
  // FIELD-CONFIRMED shapes (Linux + macmini, codex 0.142.5). HEALTHY: the pane's FOREGROUND command is `bash`
  // (the launch.sh wrapper) for the TUI's whole life — the codex processes live BELOW it:
  //   pane bash(100) → bash -lc(101) → node/codex-cli(102) → vendored codex(103).
  // FAILED: launch.sh's bounded retries exhausted, the wrapper exited, the pane sits at the bare shell —
  // NOTHING below the pane pid — while the SHARED per-project app-server socket stays bound.
  writeFileSync(codexAppServerSock(dir), '')   // the sock is present in BOTH shapes — it must not decide
  const healthy = new Map([
    [100, { ppid: 1, comm: 'bash' }], [101, { ppid: 100, comm: 'bash' }],
    [102, { ppid: 101, comm: 'node' }], [103, { ppid: 102, comm: 'codex' }],
  ])
  const failed = new Map([[100, { ppid: 1, comm: 'bash' }], [999, { ppid: 1, comm: 'codex' }]])   // an UNRELATED codex elsewhere on the box must not count
  assert.equal(codexHarness.liveness(rec, true, dir, { panePid: 100, procs: healthy }), 'online')
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: null }, true, dir, { panePid: 100, procs: healthy }), 'online')
  assert.equal(codexHarness.liveness(rec, true, dir, { panePid: 100, procs: failed }), 'offline')  // bare shell → offline despite the sock
  // tmux down → offline even when a stale snapshot still shows the tree
  assert.equal(codexHarness.liveness(rec, false, dir, { panePid: 100, procs: healthy }), 'offline')
  // probe unavailable (tmux/ps couldn't report) → not-live
  assert.equal(codexHarness.liveness(rec, true, dir, undefined), 'offline')
  assert.equal(codexHarness.liveness(rec, true, dir, { panePid: 100 }), 'offline')
  assert.equal(codexHarness.liveness(rec, true, dir, { procs: healthy }), 'offline')
})

test('codex liveness PRIMARY path: the registered agent.pid verdict wins over the ps tree-walk', () => {
  const rec = { session: 'spex-1', harnessSessionId: 'codex-thread-1' }
  // a codex session with a registered agent.pid: `pidAlive` IS the truth — no ps scan, and it OVERRIDES the
  // pane tree. Even a healthy-looking tree reads offline when the registered pid is dead, and a bare-shell tree
  // reads online when the registered pid is alive (the tree is not consulted at all on the pid path).
  const healthy = new Map([[100, { ppid: 1, comm: 'bash' }], [101, { ppid: 100, comm: 'codex' }]])
  const bareShell = new Map([[100, { ppid: 1, comm: 'bash' }]])
  assert.equal(codexHarness.liveness(rec, true, undefined, { panePid: 100, pidAlive: true, procs: bareShell }), 'online')
  assert.equal(codexHarness.liveness(rec, true, undefined, { panePid: 100, pidAlive: false, procs: healthy }), 'offline')
  // tmux down → offline regardless of a live registered pid.
  assert.equal(codexHarness.liveness(rec, false, undefined, { pidAlive: true }), 'offline')
  // pidAlive UNDEFINED (a pre-registration session, no agent.pid) → LEGACY tree-walk fallback still decides.
  assert.equal(codexHarness.liveness(rec, true, undefined, { panePid: 100, procs: healthy }), 'online')
  assert.equal(codexHarness.liveness(rec, true, undefined, { panePid: 100, procs: bareShell }), 'offline')
})

test('claude liveness verifies a LISTENER, not the socket file — tmux up AND socketLive gates online', () => {
  const rec = { session: 'spex-c', harnessSessionId: null }
  // tooth 2: online iff the window is up AND a live listener answered the connect probe (socketLive). A stale
  // socket FILE left by a crashed claude is NOT enough — the caller connect-probes and passes socketLive=false.
  assert.equal(claudeHarness.liveness(rec, true, undefined, undefined, true), 'online')    // window + live listener → online
  assert.equal(claudeHarness.liveness(rec, true, undefined, undefined, false), 'offline')  // window up but NO listener (stale sock / dead claude) → offline
  assert.equal(claudeHarness.liveness(rec, false, undefined, undefined, true), 'offline')  // no window → offline regardless
  assert.equal(claudeHarness.liveness(rec, true, undefined, undefined, undefined), 'offline') // socketLive unknown/absent → not live
})

test('baseCmd resolves the launcher command the pin freezes: the named-launcher cmd wins, else the bare default', () => {
  // A session's pinned launcher cmd is what baseCmd freezes; there is NO env/config-field resolution anymore
  // (launchers are ordinary named config). Plain fallbacks only backstop a truly-old record with no pin.
  assert.equal(claudeHarness.baseCmd('reclaude --pinned'), 'reclaude --pinned')
  assert.equal(claudeHarness.baseCmd(undefined), 'claude')
  assert.equal(codexHarness.baseCmd('codex-glm --yolo'), 'codex-glm --yolo')
  assert.equal(codexHarness.baseCmd(undefined), 'codex')
  assert.equal(opencodeHarness.baseCmd(undefined), 'opencode')
  assert.equal(piHarness.baseCmd(undefined), 'pi')
})

test('rendezvousListening: tri-state — live listener, proven-dead stale file/absent path, unproven timeout', async () => {
  const id = `unit-rv-${process.pid}-${Date.now()}`
  // absent path → 'dead', fast (ENOENT — proven: nothing ever listened here)
  assert.equal(await rendezvousListening(id, 500), 'dead')
  // a real listener on the id's rvSock → 'live'
  const srv = createServer(() => {})
  await new Promise<void>((res) => srv.listen(rvSock(id), () => res()))
  try {
    assert.equal(await rendezvousListening(id, 500), 'live')
    // a TIMEOUT is UNPROVEN, never dead (issue #40): block the prober's own event loop past the probe budget,
    // so the expired timer fires before the pending connect event — the exact thrashed-backend condition that
    // read every live worker as offline. The listener here is LIVE the whole time.
    const p = rendezvousListening(id, 50)
    const until = Date.now() + 150
    while (Date.now() < until) { /* block the loop past the 50ms probe budget */ }
    assert.equal(await p, 'unproven')
  } finally {
    await new Promise<void>((res) => srv.close(() => res()))
  }
  // after close the socket FILE lingers but nothing listens → 'dead' (the exact stale-file case: ECONNREFUSED)
  if (existsSync(rvSock(id))) assert.equal(await rendezvousListening(id, 500), 'dead')
})

test('paneTreeRunsCodex: codex-ish descendants read live; a bare/unrelated tree does not', () => {
  const base = new Map([[10, { ppid: 1, comm: 'bash' }]])
  // any codex spelling — the plain binary, a vendored name, or the CLI's node runtime — anywhere below the pane
  for (const comm of ['codex', 'codex-x86_64-unknown-linux-musl', 'node']) {
    const procs = new Map([...base, [11, { ppid: 10, comm: 'bash' }], [12, { ppid: 11, comm }]])
    assert.equal(paneTreeRunsCodex({ panePid: 10, procs }), true, comm)
  }
  // macOS ps may report comm as a full path — match on the basename
  const macish = new Map([...base, [11, { ppid: 10, comm: '/usr/local/bin/node' }]])
  assert.equal(paneTreeRunsCodex({ panePid: 10, procs: macish }), true)
  // the pane pid ITSELF being codex-named must not be needed — but a bare shell with non-codex children is dead
  const deadish = new Map([...base, [11, { ppid: 10, comm: 'sleep' }]])
  assert.equal(paneTreeRunsCodex({ panePid: 10, procs: deadish }), false)
  assert.equal(paneTreeRunsCodex({ panePid: 10, procs: base }), false)          // nothing below the pane
  assert.equal(paneTreeRunsCodex(undefined), false)
  assert.equal(paneTreeRunsCodex({ panePid: 10, procs: new Map() }), false)
})

// [[harness-adapter]] — the UNCONDITIONAL codex trust write must be duplicate-SAFE: codex refuses to load a
// config.toml with a duplicate key, so a pre-existing bare `[projects."<proj>"]` (codex auto-writes one on an
// interactive trust) or an old-format sentinel block MUST be stripped before we write, else we append a second
// key and take codex fully offline (the public-vps outage). Also idempotent, and it leaves OTHER projects alone.
test('writeCodexTrust strips ALL prior trust for the project (bare + old-format) → no duplicate key, idempotent, other projects untouched', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-cxhome-'))
  const proj = '/tmp/spex-proj-x'
  const hooksJson = `${proj}/.codex/hooks.json`
  const orig = { ...process.env }
  process.env.CODEX_HOME = home
  try {
    // a config that ALREADY carries: another project's trust (keep), a BARE codex-auto trust for OUR project
    // (the killer), an OLD-format sentinel block for OUR project, and a stray hooks.state for our hooksJson.
    writeFileSync(join(home, 'config.toml'),
      `model = "gpt-5.5"\n\n` +
      `[projects."/other/keep"]\ntrust_level = "trusted"\n\n` +
      `[projects."${proj}"]\ntrust_level = "trusted"\n\n` +
      `# spexcode:trust:${proj} (OLD FORMAT)\n[hooks.state."${hooksJson}:stop:0:0"]\ntrusted_hash = "sha256:stale"\n\n` +
      `[hooks.state."/other/keep/.codex/hooks.json:stop:0:0"]\ntrusted_hash = "sha256:keepme"\n`)

    const cmdFor = (e: string) => `spex dispatch ${e}`
    writeCodexTrust(proj, ['SessionStart', 'Stop'], cmdFor)
    let cfg = readFileSync(join(home, 'config.toml'), 'utf8')

    const projKeys = (s: string, p: string) => (s.match(new RegExp(`^\\[projects\\."${p.replace(/[/.]/g, '\\$&')}"\\]$`, 'gm')) || []).length
    assert.equal(projKeys(cfg, proj), 1, 'exactly ONE [projects."<proj>"] — no duplicate key')
    assert.equal(projKeys(cfg, '/other/keep'), 1, "other project's trust preserved")
    assert.ok(cfg.includes('trusted_hash = "sha256:keepme"'), "other project's hooks.state preserved")
    assert.ok(!cfg.includes('sha256:stale'), 'stale hooks.state for our hooksJson removed')
    assert.ok(cfg.includes(`# spexcode:trust:${proj} (managed — do not edit)`), 'our current sentinel present')
    // per-hook hash count for our hooksJson: exactly the 2 events we wrote (no dup, no leftover)
    assert.equal((cfg.match(new RegExp(`\\[hooks\\.state\\."${hooksJson.replace(/[/.]/g, '\\$&')}:`, 'g')) || []).length, 2, 'exactly our 2 hooks.state entries')

    // idempotent: a second write does not grow the config or add a duplicate
    writeCodexTrust(proj, ['SessionStart', 'Stop'], cmdFor)
    const cfg2 = readFileSync(join(home, 'config.toml'), 'utf8')
    assert.equal(projKeys(cfg2, proj), 1, 're-write keeps exactly ONE project key (idempotent)')
    assert.equal(cfg2, cfg, 're-write is byte-identical (idempotent)')
  } finally {
    process.env = orig
  }
})

// A fake rendezvous daemon replicating the REAL one's load-bearing semantics (extracted from the claude
// binary): ONE connection at a time — a new connect destroys the previous socket, discarding its unparsed
// buffer — and a synchronous line loop that answers `repaint` with `repaint-done` (the in-order parse barrier
// deliver leans on). `kickFirst` simulates a liveness probe landing in the write→parse window: the first
// delivery connection is destroyed with its chunk unread.
function fakeRvDaemon(id: string, opts: { kickFirst?: boolean; silent?: boolean; reject?: boolean } = {}) {
  const replies: string[] = []
  let conns = 0
  let prev: import('node:net').Socket | undefined
  const srv = createServer((c) => {
    conns++
    prev?.destroy()
    prev = c
    c.on('error', () => {})
    if (opts.kickFirst && conns === 1) { setTimeout(() => c.destroy(), 20); return }
    if (opts.silent) return
    let buf = ''
    c.on('data', (d) => {
      buf += d.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        const m = JSON.parse(line) as { type?: string; text?: string }
        if (opts.reject) { c.write('{"type":"reply-rejected"}\n'); continue }
        if (m.type === 'reply') replies.push(m.text ?? '')
        if (m.type === 'repaint') c.write('{"type":"repaint-done"}\n')
      }
    })
  })
  return {
    replies,
    connCount: () => conns,
    listen: () => new Promise<void>((res) => srv.listen(rvSock(id), () => res())),
    // destroy the lingering last connection first: a silent daemon never reads, so its server-side socket
    // outlives the client's destroy and srv.close() would wait on it forever.
    close: () => new Promise<void>((res) => { prev?.destroy(); srv.close(() => res()) }),
  }
}

test('deliverViaRendezvous: repaint-done confirms the parse — ok, one reply, one connection', async () => {
  const id = `unit-rvd-ok-${process.pid}-${Date.now()}`
  const d = fakeRvDaemon(id)
  await d.listen()
  try {
    const r = await deliverViaRendezvous(id, 'hello 多行\nsecond line')
    assert.equal(r.ok, true)
    assert.deepEqual(d.replies, ['hello 多行\nsecond line'])
    assert.equal(d.connCount(), 1)
  } finally { await d.close() }
})

test('deliverViaRendezvous: a kicked connection (probe race) is a PROVEN whole-chunk loss — resends, lands exactly once', async () => {
  const id = `unit-rvd-kick-${process.pid}-${Date.now()}`
  const d = fakeRvDaemon(id, { kickFirst: true })
  await d.listen()
  try {
    const r = await deliverViaRendezvous(id, 'survives the kick')
    assert.equal(r.ok, true, JSON.stringify(r))
    // the whole point: the prompt lands EXACTLY once — the retry cannot duplicate because the kick proved
    // the atomic chunk was never parsed (the old optimistic write returned ok:true here and the prompt vanished)
    assert.deepEqual(d.replies, ['survives the kick'])
    assert.ok(d.connCount() >= 2, `expected a resend, got ${d.connCount()} connection(s)`)
  } finally { await d.close() }
})

test('deliverViaRendezvous: a silent-but-open daemon is BUSY, not lost — wall expiry reports optimistic ok, no retry storm', async () => {
  const id = `unit-rvd-wall-${process.pid}-${Date.now()}`
  const d = fakeRvDaemon(id, { silent: true })
  await d.listen()
  try {
    const r = await deliverViaRendezvous(id, 'busy claude', 250)
    assert.equal(r.ok, true)
    assert.equal(d.connCount(), 1, 'wall expiry is ok, never a kick retry')
  } finally { await d.close() }
})

test('deliverViaRendezvous: reply-rejected fails LOUD and is not retried', async () => {
  const id = `unit-rvd-rej-${process.pid}-${Date.now()}`
  const d = fakeRvDaemon(id, { reject: true })
  await d.listen()
  try {
    const r = await deliverViaRendezvous(id, 'gated')
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /rejected/)
    assert.equal(d.connCount(), 1)
  } finally { await d.close() }
})

test('deliverViaRendezvous: no socket at all fails loud before any connect', async () => {
  const r = await deliverViaRendezvous(`unit-rvd-none-${process.pid}-${Date.now()}`, 'nobody home')
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /no rendezvous control socket/)
})

test('claude deliveryBlockedBy: the sessions panel refuses with the recovery named; a composer pane passes', () => {
  const guard = claudeHarness.deliveryBlockedBy
  assert.ok(guard, 'claude carries the pane guard')
  // the panel's two signatures — the new-session composer placeholder, and the footer hint PAIR
  assert.match(guard('Needs input\n❯ describe a task for a new session\n') ?? '', /sessions panel/)
  assert.match(guard('⏵⏵ bypass permissions · enter to return · space to reply · ctrl+x to delete') ?? '', /press Enter/)
  // a normal composer (even mentioning agents in the footer) is NOT the panel
  assert.equal(guard('❯ draft text here\n  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents'), null)
  // a footer hint ALONE (one string, not the pair) is not enough to refuse
  assert.equal(guard('some prose that says enter to return somewhere'), null)
})
