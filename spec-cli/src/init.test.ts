import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { templateConfigPath } from '@spexcode/spec-core'
import { tsxBin } from './tsx-bin.js'

// [[spex-init]] / [[residence]] — the ADOPTION SURFACE: what `spex init` prints must be TRUE of what it
// planted (the success message once claimed governedRoots ["src"] while the template seeded ["."] — the
// first-minute lie a real field e2e hit). Footprint needs NO vote at adoption: a host-tracked contract
// file goes straight through the content filter (clean status, no decision hint, no mystery M), and a
// pre-existing retired `render` field is ignored with a loud notice, never a failure.

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const PACKAGE = join(SRC, '..')
const TSX = tsxBin(PACKAGE)
const HOOK_TEMPLATES = join(SRC, '..', 'templates', 'hooks')
const TEMPLATE_ROOTS = JSON.stringify(JSON.parse(readFileSync(templateConfigPath, 'utf8')).lint.governedRoots)
// template order: each harness's headless form leads its interactive one, so a selection that includes both
// defaults to the terminal-free launcher ([[launcher-select]])
const SEEDED_LAUNCHERS = {
  'claude-headless': { harness: 'claude-headless', cmd: 'claude' },
  claude: { harness: 'claude', cmd: 'claude' },
  'codex-headless': { harness: 'codex-headless', cmd: 'codex --yolo' },
  codex: { harness: 'codex', cmd: 'codex' },
  'opencode-headless': { harness: 'opencode-headless', cmd: 'opencode --auto' },
  opencode: { harness: 'opencode', cmd: 'opencode' },
  'pi-headless': { harness: 'pi-headless', cmd: 'pi' },
  pi: { harness: 'pi', cmd: 'pi' },
} as const

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}

const freePort = () => new Promise<number>((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => typeof address === 'object' && address ? resolvePort(address.port) : reject(new Error('no test port')))
  })
})

function freshRepo(opts: { trackedContract?: boolean } = {}) {
  const proj = mkdtempSync(join(tmpdir(), 'spex-init-'))
  const home = mkdtempSync(join(tmpdir(), 'spex-home-'))
  const codex = mkdtempSync(join(tmpdir(), 'spex-codex-'))
  const piAgent = mkdtempSync(join(tmpdir(), 'spex-pi-'))
  const env = { ...process.env, SPEXCODE_HOME: home, CODEX_HOME: codex, SPEXCODE_PI_AGENT_DIR: piAgent }
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
  const spex = (...args: string[]) =>
    execFileSync(process.execPath, [TSX, CLI, ...args], { cwd: proj, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'README.md'), '# app\n')
  if (opts.trackedContract) {
    writeFileSync(join(proj, 'CLAUDE.md'), '# team notes\nkeep me\n')
    writeFileSync(join(proj, 'AGENTS.md'), '# team agents\nkeep me\n')
  }
  g('add', '-A'); g('commit', '-qm', 'init')
  return { proj, home, codex, env, g, spex }
}

test('init success message reports the governedRoots the template ACTUALLY ships — read from the planted file, drift-proof', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, spex } = freshRepo()
  const out = spex('init', '.', '--harness', 'claude,codex')
  // the host-local overlay is checkout-invariant machine residue: it belongs to the common exclude that
  // materialize writes, NOT to the tree's .gitignore ([[harness-delivery]]). Appending it there would make
  // every adopted ignore look host-authored and cost it materialize's self-entry ([[spex-init]]).
  assert.match(readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8'), /^\.spec\/spexcode\.local\.json$/m)
  assert.doesNotMatch(readFileSync(join(proj, '.gitignore'), 'utf8'), /^\.spec\/spexcode\.local\.json$/m)
  assert.ok(out.includes(`lint.governedRoots starts as ${TEMPLATE_ROOTS}`), `plant message names the template value ${TEMPLATE_ROOTS}: ${out}`)
  assert.ok(out.includes(`(currently ${TEMPLATE_ROOTS})`), 'next-steps names the LIVE planted value')
  assert.ok(!out.includes('["src"]') || TEMPLATE_ROOTS === '["src"]', 'no stale hardcoded ["src"] claim anywhere')
  const projectSpec = readFileSync(join(proj, '.spec', 'project', 'spec.md'), 'utf8')
  assert.match(projectSpec, /`system` contracts[\s\S]*`hook` handlers[\s\S]*`command` presets[\s\S]*`skill`/, 'starter project spec names the initialized plugin surfaces')
  assert.doesNotMatch(projectSpec, /seed ships `core`|seed ships `tidy`/, 'obsolete core-plus-tidy inventory is gone')
  const mergeNode = readFileSync(join(proj, '.spec', 'project', '.plugins', 'skills', 'merge', 'spec.md'), 'utf8')
  assert.match(mergeNode, /^surface: skill, command$/m, 'merge is one present-plugin node with skill and command surfaces')
  for (const skill of [join(proj, '.claude', 'skills', 'merge', 'SKILL.md'), join(proj, '.codex', 'skills', 'merge', 'SKILL.md')]) {
    assert.match(readFileSync(skill, 'utf8'), /^name: merge$/m, `${skill} materializes the merge skill`)
    assert.match(readFileSync(skill, 'utf8'), /do not call `spex session merge \.` recursively/i, `${skill} prevents recursive self-dispatch`)
  }
})

test('init adoption data cannot masquerade as a clean untracked project', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, env, spex } = freshRepo()
  const out = spex('init', '.', '--harness', 'codex')
  assert.match(out, /project source of truth[\s\S]*\.spec[\s\S]*spexcode\.json/i)
  assert.match(out, /commit them/i)

  const before = spawnSync(process.execPath, [TSX, CLI, 'spec', 'lint'], {
    cwd: proj,
    env,
    encoding: 'utf8',
  })
  assert.equal(before.status, 1, `untracked adoption data must block lint: ${before.stdout}\n${before.stderr}`)
  assert.match(before.stderr, /integrity: project source of truth is untracked/i)
  assert.match(before.stderr, /git add \.spec/i)

  g('add', '.spec')
  execFileSync('git', ['-C', proj, 'commit', '-qm', 'adopt SpexCode seed'], {
    env: { ...env, SPEXCODE_ALLOW_MAIN: '1' },
  })
  const after = spawnSync(process.execPath, [TSX, CLI, 'spec', 'lint'], {
    cwd: proj,
    env,
    encoding: 'utf8',
  })
  assert.equal(after.status, 0, `tracked adoption data should leave lint advisory-only: ${after.stdout}\n${after.stderr}`)
  assert.doesNotMatch(after.stderr, /project source of truth is untracked/i)
})

test('a legacy root config the loader has stopped reading is not source of truth', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, env, spex } = freshRepo()
  spex('init', '.', '--harness', 'codex')
  g('add', '.spec')
  execFileSync('git', ['-C', proj, 'commit', '-qm', 'adopt SpexCode seed'], {
    env: { ...env, SPEXCODE_ALLOW_MAIN: '1' },
  })
  const lint = () => spawnSync(process.execPath, [TSX, CLI, 'spec', 'lint'], { cwd: proj, env, encoding: 'utf8' })

  // `.spec/spexcode.json` is tracked, so readProjectConfig never reads this root file. Integrity must not
  // demand a file the loader has already ruled out — the two would say different things about one path.
  writeFileSync(join(proj, 'spexcode.json'), '{"mainBranch":"main"}\n')
  const dead = lint()
  assert.equal(dead.status, 0, `a legacy file the loader ignores must not block: ${dead.stdout}\n${dead.stderr}`)
  assert.doesNotMatch(dead.stderr, /source of truth is untracked/i)

  // Now put the repo in the pre-migration shape: the root file is the ONLY config, so the loader reads it
  // and it is source of truth again. Tracked, integrity is satisfied...
  rmSync(join(proj, 'spexcode.json'))
  g('mv', '.spec/spexcode.json', 'spexcode.json')
  execFileSync('git', ['-C', proj, 'commit', '-qm', 'move config back to the root'], {
    env: { ...env, SPEXCODE_ALLOW_MAIN: '1' },
  })
  const tracked = lint()
  assert.equal(tracked.status, 0, `a tracked legacy config is source of truth, satisfied: ${tracked.stdout}\n${tracked.stderr}`)

  // ...and untracked, integrity must demand it, naming it in the repair. This state is deliberately not
  // committed: the commit gate runs this very lint, so the block under test would refuse the commit.
  g('rm', '-q', '--cached', 'spexcode.json')
  const live = lint()
  assert.equal(live.status, 1, `the legacy file the loader reads must block: ${live.stdout}\n${live.stderr}`)
  assert.match(live.stderr, /source of truth is untracked: spexcode\.json/i)
  assert.match(live.stderr, /git add \.spec spexcode\.json/i)
})

test('adoption needs no vote: a host-TRACKED contract file goes straight through the filter — clean status, no hint, no honest-M', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex } = freshRepo({ trackedContract: true })
  const out = spex('init', '.', '--harness', 'claude,codex')
  assert.ok(!out.includes('--render') && !/vote/i.test(out), 'no vote vocabulary anywhere in the adoption output')
  // the tracked contract files are covered immediately: block in the worktree, index pristine, status clean
  assert.ok(readFileSync(join(proj, 'CLAUDE.md'), 'utf8').includes('spexcode:start'), 'contract delivered into the tracked file')
  assert.ok(!g('show', ':CLAUDE.md').includes('spexcode:start'), 'index stays pristine (clean filter planted at init)')
  const dirty = g('status', '--short').trim().split('\n').filter((l) => l && !l.startsWith('??'))
  assert.deepEqual(dirty, [], `no modified tracked file after adoption (no mystery M): ${dirty}`)
  // Checkout-invariant residue stays common; selection-local products live in this tree's filtered ignore.
  const excl = readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8')
  assert.ok(excl.includes('spexcode:start') && excl.includes('.codex/hooks.json'), 'common exclude block owns project transport')
  assert.ok(!excl.includes('.claude/settings.json'), 'common exclude does not leak tree-local selection')
  const localIgnore = readFileSync(join(proj, '.gitignore'), 'utf8')
  assert.ok(localIgnore.includes('spexcode:start') && localIgnore.includes('.claude/settings.json'), 'tree-local ignore owns selected artifacts')
  assert.ok(localIgnore.includes('.gitignore'), 'a wholly generated ignore hides itself')
})

test('a wholly generated ignore stays self-hidden after repeated materialize', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env, g, spex } = freshRepo()
  spex('init', '.', '--harness', 'codex')
  g('add', '.spec')
  execFileSync('git', ['-C', proj, 'commit', '-qm', 'adopt SpexCode seed'], {
    env: { ...env, SPEXCODE_ALLOW_MAIN: '1' },
  })

  spex('materialize')

  const localIgnore = readFileSync(join(proj, '.gitignore'), 'utf8')
  assert.match(localIgnore, /^\.gitignore$/m, 'the repeated projection keeps its own ignore entry')
  assert.equal(g('check-ignore', '.gitignore').trim(), '.gitignore', 'Git still classifies the generated file as ignored')
  assert.ok(!g('status', '--short', '--untracked-files=all').includes('.gitignore'), 'the generated file stays absent from status')
})

test('init without --harness fails loud BEFORE writing anything — the delivery choice is required, never defaulted', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env } = freshRepo()
  const result = spawnSync(process.execPath, [TSX, CLI, 'init', '.'], { cwd: proj, encoding: 'utf8', env })
  const all = `${result.stdout}${result.stderr}\nexit:${result.status}`
  assert.match(all, /--harness is required/, 'the error names the missing flag')
  assert.match(all, /exit:1/, 'non-zero exit')
  assert.ok(!existsSync(join(proj, '.spec')) && !existsSync(join(proj, '.spec/spexcode.json')), 'nothing was written')
})

test('--harness seeds only the selected launchers, with automatic permission limited to the headless runtime that requires it', { skip: !gitAvailable() && 'git not available' }, () => {
  const selections = [['claude'], ['codex'], ['codex-headless'], ['opencode'], ['pi'], ['claude-headless'], ['opencode-headless'], ['pi-headless'], ['claude', 'codex', 'codex-headless', 'opencode', 'pi', 'claude-headless', 'opencode-headless', 'pi-headless']]
  for (const selected of selections) {
    const { proj, codex, spex } = freshRepo()
    const out = spex('init', '.', '--harness', selected.join(','))
    const cfg = JSON.parse(readFileSync(join(proj, '.spec/spexcode.json'), 'utf8'))
    const expectedNames = Object.keys(SEEDED_LAUNCHERS).filter((name) => selected.includes(name))
    const expectedLaunchers = Object.fromEntries(expectedNames.map((name) => [name, SEEDED_LAUNCHERS[name as keyof typeof SEEDED_LAUNCHERS]]))

    assert.deepEqual(cfg.harnesses, selected, 'the choice is persisted as the harnesses field')
    assert.equal(cfg.dashboard?.showHeadlessLaunchers, undefined, 'no headless-launcher visibility gate: the picker offers every configured launcher')
    assert.deepEqual(cfg.sessions.launchers, expectedLaunchers, 'unselected harnesses got no launcher and selected commands match their runtime form')
    assert.equal(cfg.sessions.defaultLauncher, expectedNames[0], 'defaultLauncher names the first real planted entry')
    if (!selected.includes('codex-headless'))
      assert.doesNotMatch(JSON.stringify(cfg.sessions), /dangerously-skip-permissions|--yolo/, 'clean init never seeds wrapper-specific permission bypasses')
    const autoLaunchers = Object.entries(cfg.sessions.launchers).filter(([, launcher]: any) => launcher.cmd.includes('--auto')).map(([name]) => name)
    assert.deepEqual(autoLaunchers, selected.includes('opencode-headless') ? ['opencode-headless'] : [], 'only the explicitly selected headless OpenCode runtime receives --auto')

    if (selected.length === 1 && selected[0] === 'claude') {
      assert.match(out, /contract: CLAUDE\.md/, 'the materialize receipt reports the Claude contract')
      assert.match(out, /shim: \.claude\/settings\.json/, 'the materialize receipt reports the Claude shim')
      assert.doesNotMatch(out, /AGENTS\.md|\.codex\/hooks\.json|trust:/, 'no Codex contract, shim, or trust claim')
      assert.ok(existsSync(join(proj, 'CLAUDE.md')) && existsSync(join(proj, '.claude', 'settings.json')), 'Claude artifacts exist')
      assert.ok(!existsSync(join(proj, 'AGENTS.md')) && !existsSync(join(proj, '.codex')), 'no Codex artifacts were planted')
      assert.ok(!existsSync(join(codex, 'config.toml')), 'no Codex trust was planted')
    }
    if (selected.length === 1 && selected[0] === 'codex') {
      assert.match(out, /contract: AGENTS\.md/, 'the materialize receipt reports the Codex contract')
      assert.match(out, /shim: \.codex\/hooks\.json/, 'the materialize receipt reports the Codex shim')
      assert.match(out, /trust: .*config\.toml/, 'the materialize receipt reports the Codex trust write')
      assert.doesNotMatch(out, /CLAUDE\.md|\.claude\/settings\.json/, 'no Claude contract or shim claim')
      assert.ok(existsSync(join(proj, 'AGENTS.md')) && existsSync(join(proj, '.codex', 'hooks.json')), 'Codex artifacts exist')
      assert.ok(existsSync(join(codex, 'config.toml')), 'Codex trust exists')
      assert.ok(!existsSync(join(proj, 'CLAUDE.md')) && !existsSync(join(proj, '.claude')), 'no claude artifacts for a codex-only selection')
    }
  }
})

test('--harness seeds hook nodes only when a selected native adapter can emit their events', { skip: !gitAvailable() && 'git not available' }, () => {
  const node = (proj: string, name: string) => join(proj, '.spec', 'project', '.plugins', 'core', name)
  const pluginNodeCount = (proj: string) => readdirSync(join(proj, '.spec', 'project', '.plugins'), { recursive: true })
    .filter((path) => path === 'spec.md' || String(path).endsWith('/spec.md')).length
  // The counts move whenever a plugin node is added or retired, and that is the point: a node that leaks
  // into a selection whose adapter cannot emit its events shows up here as an off-by-one before it ships.
  // Last moved by the review-report skill node, landing beside the atlas skill; every harness receives both.
  const cases: ReadonlyArray<readonly [string, number]> = [
    ['zcode', 25],
    ['claude', 27],
    ['zcode,claude', 27],
  ]
  for (const [selected, expectedNodes] of cases) {
    const { proj, spex } = freshRepo()
    spex('init', '.', '--harness', selected)
    assert.equal(pluginNodeCount(proj), expectedNodes, selected)
    const zcodeOnly = selected === 'zcode'
    assert.equal(existsSync(node(proj, 'idle')), !zcodeOnly, `${selected}: idle follows the reachable events`)
    assert.equal(existsSync(node(proj, 'session-fail')), !zcodeOnly, `${selected}: session-fail follows the reachable events`)
    assert.equal(existsSync(join(node(proj, 'idle'), 'idle.sh')), !zcodeOnly, `${selected}: idle script follows its node`)
    assert.equal(existsSync(join(node(proj, 'session-fail'), 'fail.sh')), !zcodeOnly, `${selected}: session-fail script follows its node`)
    assert.ok(existsSync(node(proj, 'stop-gate')), `${selected}: reachable Stop hook remains`)
  }

  const { proj, spex } = freshRepo()
  spex('init', '.', '--harness', 'zcode')
  assert.ok(existsSync(join(proj, 'AGENTS.md')), 'zcode contract remains materialized')
  assert.ok(existsSync(join(proj, '.zcode', 'skills', 'distill', 'SKILL.md')), 'zcode skill remains materialized')
  assert.ok(existsSync(join(proj, '.zcode', 'skills', 'merge', 'SKILL.md')), 'zcode receives the merge skill from the same present-plugin node')
  const settings = JSON.parse(readFileSync(join(proj, '.zcode', 'settings.json'), 'utf8'))
  assert.deepEqual(Object.keys(settings.hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'], 'zcode shim binds exactly its declared events')
  assert.ok(!('Notification' in settings.hooks) && !('StopFailure' in settings.hooks), 'unreachable events never enter zcode settings')
})

test('a fresh selected-harness default drives no-choice session creation and pins its safe command', { skip: !gitAvailable() && 'git not available' }, async () => {
  const { proj, home, env, spex } = freshRepo()
  spex('init', '.', '--harness', 'codex')

  // Make the liveness snapshot time out so the real create path leaves the session queued instead of starting
  // an installed Codex. This exercises CLI → bounded create owner → persisted record without replacing the launcher.
  const fakeBin = mkdtempSync(join(tmpdir(), 'spex-init-bin-'))
  const fakeTmux = join(fakeBin, 'tmux')
  writeFileSync(fakeTmux, '#!/usr/bin/env node\nsetTimeout(() => {}, 10000)\n')
  chmodSync(fakeTmux, 0o755)
  const refusedPort = await freePort()
  const createEnv = {
    ...env,
    SPEX_SESSION_DATABASE_PATH: join(home, 'sessions.sqlite'),
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    SPEXCODE_API_URL: `http://127.0.0.1:${refusedPort}`,
    SPEXCODE_TMUX: `safe-init-${process.pid}`,
  }
  const out = execFileSync(process.execPath, [TSX, CLI, 'session', 'new', 'safe default probe'], {
    cwd: proj,
    env: createEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20000,
  })
  const created = JSON.parse(out)
  assert.equal(created.status, 'queued')
  assert.equal(created.launcher, 'codex')
  assert.equal(created.harness, 'codex')

  const projectKey = proj.replace(/[/.]/g, '-')
  const rec = JSON.parse(readFileSync(join(home, 'projects', projectKey, 'sessions', created.id, 'runtime.json'), 'utf8'))
  assert.equal(rec.launcher, 'codex')
  assert.equal(rec.harness, 'codex')
  assert.equal(rec.launch_cmd, 'codex', 'session creation pins the plain command from the named launcher')
})

test('post-checkout defers only the session-owned refresh', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env, spex } = freshRepo()
  spex('init', '.', '--harness', 'codex')
  assert.match(readFileSync(join(proj, '.git', 'hooks', 'post-checkout'), 'utf8'), /^#!\/usr\/bin\/env bash\n# spexcode-managed-hook-v1\n/,
    'fresh post-checkout installs a managed snapshot so a later init can refresh it')
  const bin = mkdtempSync(join(tmpdir(), 'spex-post-checkout-bin-'))
  const trace = join(proj, 'post-checkout.trace')
  const fakeSpex = join(bin, 'spex')
  writeFileSync(fakeSpex, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SPEX_POST_CHECKOUT_TRACE"\n')
  chmodSync(fakeSpex, 0o755)
  const hookEnv = { ...env, PATH: `${bin}:${process.env.PATH}`, SPEX_POST_CHECKOUT_TRACE: trace }
  const deferred = join(proj, '.worktrees', 'deferred')
  execFileSync('git', ['-C', proj, 'worktree', 'add', '-b', 'node/deferred', deferred, 'HEAD'], {
    env: { ...hookEnv, SPEXCODE_DEFER_FOOTPRINT_REFRESH: 'session-create' },
  })
  assert.ok(!existsSync(trace), 'the session-owned checkout must not invoke a competing refresh')

  const ordinary = join(proj, '.worktrees', 'ordinary')
  execFileSync('git', ['-C', proj, 'worktree', 'add', '-b', 'node/ordinary', ordinary, 'HEAD'], { env: hookEnv })
  assert.equal(readFileSync(trace, 'utf8'), 'internal refresh-footprint\n', 'an ordinary worktree checkout still refreshes')
  execFileSync('git', ['-C', proj, 'worktree', 'remove', '--force', deferred], { env })
  execFileSync('git', ['-C', proj, 'worktree', 'remove', '--force', ordinary], { env })
})

test('a pre-existing retired render field is ignored with a loud notice — init still succeeds', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env } = freshRepo()
  mkdirSync(join(proj, '.spec'), { recursive: true })
  writeFileSync(join(proj, '.spec/spexcode.json'), '{"render":"committed","lint":{"governedRoots":["."]}}\n')
  const result = spawnSync(process.execPath, [TSX, CLI, 'init', '.', '--harness', 'claude,codex'], { cwd: proj, encoding: 'utf8', env })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  const all = `${result.stdout}${result.stderr}`
  assert.match(all, /retired/i, 'the retired-field notice is loud')
  assert.ok(existsSync(join(proj, '.spec')), 'adoption proceeded — the field is inert, never fatal')
  assert.ok(readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8').includes('spexcode:start'), 'one residence behavior regardless of the field')
})

test('re-init refreshes managed Spex hooks, preserves a custom commit-msg, and never probes it', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex } = freshRepo()
  const hooks = join(proj, '.git', 'hooks')
  spex('init', '.', '--harness', 'claude')
  writeFileSync(join(hooks, 'pre-commit'), '#!/usr/bin/env bash\n# spexcode-managed-hook-v1\nexit 0\n')
  writeFileSync(join(hooks, 'prepare-commit-msg'), '#!/usr/bin/env bash\n# spexcode-managed-hook-v1\nexit 0\n')
  chmodSync(join(hooks, 'pre-commit'), 0o755)
  chmodSync(join(hooks, 'prepare-commit-msg'), 0o755)
  const calls = join(proj, 'custom-commit-msg.calls')
  const custom = `#!/bin/sh\nprintf '%s\\n' "$1" >> ${JSON.stringify(calls)}\n`
  writeFileSync(join(hooks, 'commit-msg'), custom)
  chmodSync(join(hooks, 'commit-msg'), 0o755)

  spex('init', '.', '--harness', 'claude')
  assert.equal(readFileSync(join(hooks, 'pre-commit'), 'utf8'), readFileSync(join(HOOK_TEMPLATES, 'pre-commit'), 'utf8'))
  assert.equal(readFileSync(join(hooks, 'prepare-commit-msg'), 'utf8'), readFileSync(join(HOOK_TEMPLATES, 'prepare-commit-msg'), 'utf8'))
  assert.equal(readFileSync(join(hooks, 'commit-msg'), 'utf8'), custom, 'custom commit-msg was overwritten')
  assert.equal(readFileSync(join(hooks, 'reference-transaction'), 'utf8'), readFileSync(join(HOOK_TEMPLATES, 'reference-transaction'), 'utf8'))
  assert.ok(!existsSync(calls), 'init executed the custom hook as an identity probe')

  const localBin = join(proj, 'node_modules', '.bin')
  mkdirSync(localBin, { recursive: true })
  const localSpex = join(localBin, 'spex')
  writeFileSync(localSpex, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(TSX)} ${JSON.stringify(CLI)} "$@"\n`)
  chmodSync(localSpex, 0o755)

  const cfg = JSON.parse(readFileSync(join(proj, '.spec/spexcode.json'), 'utf8'))
  assert.equal(cfg.mainBranch, 'main', 'init persists trunk identity before an ordinary checkout can switch away')
  g('switch', '-qc', 'node/init-hook')
  writeFileSync(join(proj, 'README.md'), '# changed\n')
  g('add', 'README.md')
  g('commit', '-qm', 'exercise preserved hook')
  const argv = readFileSync(calls, 'utf8').trim().split('\n')
  assert.equal(argv.length, 1, `custom hook should run once at Git commit, got: ${argv.join(', ')}`)
  assert.doesNotMatch(argv[0], /spexcode-probe/)
})

// [[spex-init]] --pure: the spec skeleton and nothing else, and the later adoption of such a tree as it is.
const PURE_ROOT = join(SRC, '..', 'templates', 'pure', 'project', 'spec.md')
const TEMPLATE_LINT = JSON.parse(readFileSync(templateConfigPath, 'utf8')).lint

function filesUnder(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.git') return []
    const path = join(dir, e.name)
    return e.isDirectory() ? filesUnder(path, base) : [path.slice(base.length + 1)]
  }).sort()
}

function gitFootprint(proj: string) {
  const git = join(proj, '.git')
  const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : null
  return {
    hooks: readdirSync(join(git, 'hooks')).filter((name) => !name.endsWith('.sample')).sort(),
    config: read(join(git, 'config')),
    exclude: read(join(git, 'info', 'exclude')),
    attributes: read(join(git, 'info', 'attributes')),
    spexcodeDir: existsSync(join(git, 'spexcode')),
  }
}

function createSessionWithDefaultLauncher(proj: string, home: string, env: NodeJS.ProcessEnv, refusedPort: number) {
  // the liveness snapshot times out, so the real create path leaves the session queued instead of starting a CLI
  const fakeBin = mkdtempSync(join(tmpdir(), 'spex-init-bin-'))
  writeFileSync(join(fakeBin, 'tmux'), '#!/usr/bin/env node\nsetTimeout(() => {}, 10000)\n')
  chmodSync(join(fakeBin, 'tmux'), 0o755)
  return spawnSync(process.execPath, [TSX, CLI, 'session', 'new', 'default launcher probe'], {
    cwd: proj,
    env: {
      ...env,
      SPEX_SESSION_DATABASE_PATH: join(home, 'sessions.sqlite'),
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      SPEXCODE_API_URL: `http://127.0.0.1:${refusedPort}`,
      SPEXCODE_TMUX: `pure-init-${process.pid}`,
    },
    encoding: 'utf8',
    timeout: 20000,
  })
}

test('--pure plants the spec skeleton and nothing else: no .plugins, nothing in .git, nothing outside .spec', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, home, g, spex } = freshRepo()
  const before = gitFootprint(proj)
  const out = spex('init', '.', '--pure')

  assert.deepEqual(filesUnder(proj), ['.spec/project/spec.md', '.spec/spexcode.json', 'README.md'], 'exactly the root node and the config')
  assert.deepEqual(JSON.parse(readFileSync(join(proj, '.spec/spexcode.json'), 'utf8')), { lint: TEMPLATE_LINT }, 'the config holds only the lint section')
  assert.equal(readFileSync(join(proj, '.spec/project/spec.md'), 'utf8'), readFileSync(PURE_ROOT, 'utf8'), 'the root comes from the pure template')
  assert.doesNotMatch(readFileSync(join(proj, '.spec/project/spec.md'), 'utf8'), /\.plugins/, 'the pure root does not describe machinery it lacks')
  assert.deepEqual(gitFootprint(proj), before, 'no hook, no filter, no exclude or attributes entry, no .git/spexcode')
  assert.deepEqual(readdirSync(home), [], 'no global store')
  assert.match(out, /planted \.spec\/project\/spec\.md, \.spec\/spexcode\.json/)
  assert.match(out, /spex init --harness <id>/, 'the output names the later full adoption')

  g('add', '.spec'); g('commit', '-qm', 'spec skeleton')
  assert.equal(g('log', '-1', '--format=%s').trim(), 'spec skeleton', 'an ordinary commit on main still works: no main-guard was installed')
})

test('--pure refuses --harness and --preset before writing anything, and leaves an existing tree alone', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env } = freshRepo()
  for (const extra of [['--harness', 'claude'], ['--preset', 'default']]) {
    const res = spawnSync(process.execPath, [TSX, CLI, 'init', '.', '--pure', ...extra], { cwd: proj, env, encoding: 'utf8' })
    assert.notEqual(res.status, 0, `--pure ${extra[0]} is refused`)
    assert.match(res.stderr, /--pure plants only the spec skeleton/)
    assert.ok(!existsSync(join(proj, '.spec')), 'nothing was written')
  }

  mkdirSync(join(proj, '.spec', 'app'), { recursive: true })
  writeFileSync(join(proj, '.spec', 'app', 'spec.md'), '---\ntitle: app\n---\n# app\n')
  const res = spawnSync(process.execPath, [TSX, CLI, 'init', '.', '--pure'], { cwd: proj, env, encoding: 'utf8' })
  assert.equal(res.status, 0)
  assert.match(res.stdout, /adds nothing to an existing tree/)
  assert.deepEqual(filesUnder(proj), ['.spec/app/spec.md', 'README.md'], 'an existing tree gets no config and no root')
})

test('a pure tree grown by hand is adopted as it is by a later init, and its sessions can start', { skip: !gitAvailable() && 'git not available' }, async () => {
  const { proj, home, env, g, spex } = freshRepo()
  spex('init', '.', '--pure')
  mkdirSync(join(proj, '.spec', 'project', 'api'), { recursive: true })
  writeFileSync(join(proj, '.spec', 'project', 'api', 'spec.md'), '---\ntitle: api\n---\n# api\nThe HTTP surface.\n')
  const lint = { ...TEMPLATE_LINT, sourceExcludeGlobs: ['vendor/**'] }
  writeFileSync(join(proj, '.spec', 'spexcode.json'), JSON.stringify({ lint }, null, 2) + '\n')
  g('add', '.spec'); g('commit', '-qm', 'spec tree grown before adoption')
  const root = readFileSync(join(proj, '.spec/project/spec.md'), 'utf8')
  const api = readFileSync(join(proj, '.spec/project/api/spec.md'), 'utf8')

  const out = spex('init', '.', '--harness', 'codex')
  assert.match(out, /adopting the existing spec tree under 'project' \(2 spec node\(s\)\) as it is/)
  assert.doesNotMatch(out, /skipping spec scaffold/, 'adoption is not reported as an obstacle')
  assert.equal(readFileSync(join(proj, '.spec/project/spec.md'), 'utf8'), root, 'the root node is untouched')
  assert.equal(readFileSync(join(proj, '.spec/project/api/spec.md'), 'utf8'), api, 'the grown node is untouched')
  assert.ok(existsSync(join(proj, '.spec/project/.plugins/core/spec.md')), 'the machinery went into the existing root')

  const cfg = JSON.parse(readFileSync(join(proj, '.spec/spexcode.json'), 'utf8'))
  assert.deepEqual(cfg.lint, lint, 'the reader-edited lint section stays')
  assert.deepEqual(cfg.harnesses, ['codex'])
  assert.equal(cfg.mainBranch, 'main')
  assert.deepEqual(cfg.sessions.launchers, { codex: SEEDED_LAUNCHERS.codex }, 'the missing launcher pool is filled for the selection only')
  assert.equal(cfg.sessions.defaultLauncher, 'codex')

  const res = createSessionWithDefaultLauncher(proj, home, env, await freePort())
  assert.equal(res.status, 0, res.stderr)
  const created = JSON.parse(res.stdout)
  assert.equal(created.status, 'queued')
  assert.equal(created.launcher, 'codex', 'a no-choice session starts from the filled default')
})

test('re-init fills no launcher when the local overlay already configures them', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, spex } = freshRepo()
  spex('init', '.', '--pure')
  const local = { sessions: { launchers: { mine: { harness: 'claude', cmd: 'my-claude' } }, defaultLauncher: 'mine' } }
  writeFileSync(join(proj, '.spec', 'spexcode.local.json'), JSON.stringify(local, null, 2) + '\n')
  spex('init', '.', '--harness', 'claude')
  const cfg = JSON.parse(readFileSync(join(proj, '.spec/spexcode.json'), 'utf8'))
  assert.equal(cfg.sessions, undefined, 'the committed config gains no launcher pool')
  assert.deepEqual(JSON.parse(readFileSync(join(proj, '.spec/spexcode.local.json'), 'utf8')), local, 'the overlay is untouched')
})
