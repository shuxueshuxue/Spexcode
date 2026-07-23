import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// [[spex-init]] / [[residence]] — the ADOPTION SURFACE: what `spex init` prints must be TRUE of what it
// planted (the success message once claimed governedRoots ["src"] while the template seeded ["."] — the
// first-minute lie a real field e2e hit). Footprint needs NO vote at adoption: a host-tracked contract
// file goes straight through the content filter (clean status, no decision hint, no mystery M), and a
// pre-existing retired `render` field is ignored with a loud notice, never a failure.

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = join(SRC, '..', 'node_modules', '.bin', 'tsx')
const TEMPLATE_ROOTS = JSON.stringify(JSON.parse(readFileSync(join(SRC, '..', 'templates', 'spexcode.json'), 'utf8')).lint.governedRoots)
const SEEDED_LAUNCHERS = {
  claude: { harness: 'claude', cmd: 'claude' },
  'claude-headless': { harness: 'claude-headless', cmd: 'claude' },
  codex: { harness: 'codex', cmd: 'codex' },
  opencode: { harness: 'opencode', cmd: 'opencode' },
  'opencode-headless': { harness: 'opencode-headless', cmd: 'opencode --auto' },
  pi: { harness: 'pi', cmd: 'pi' },
} as const

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}

function freshRepo(opts: { trackedContract?: boolean } = {}) {
  const proj = mkdtempSync(join(tmpdir(), 'spex-init-'))
  const home = mkdtempSync(join(tmpdir(), 'spex-home-'))
  const codex = mkdtempSync(join(tmpdir(), 'spex-codex-'))
  const piAgent = mkdtempSync(join(tmpdir(), 'spex-pi-'))
  const env = { ...process.env, SPEXCODE_HOME: home, CODEX_HOME: codex, SPEXCODE_PI_AGENT_DIR: piAgent }
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
  const spex = (...args: string[]) =>
    execFileSync(TSX, [CLI, ...args], { cwd: proj, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
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
  assert.ok(out.includes(`lint.governedRoots starts as ${TEMPLATE_ROOTS}`), `plant message names the template value ${TEMPLATE_ROOTS}: ${out}`)
  assert.ok(out.includes(`(currently ${TEMPLATE_ROOTS})`), 'next-steps names the LIVE planted value')
  assert.ok(!out.includes('["src"]') || TEMPLATE_ROOTS === '["src"]', 'no stale hardcoded ["src"] claim anywhere')
  const projectSpec = readFileSync(join(proj, '.spec', 'project', 'spec.md'), 'utf8')
  assert.match(projectSpec, /`system` contracts[\s\S]*`hook` handlers[\s\S]*`command` presets[\s\S]*`skill`/, 'starter project spec names the initialized plugin surfaces')
  assert.doesNotMatch(projectSpec, /seed ships `core`|seed ships `tidy`/, 'obsolete core-plus-tidy inventory is gone')
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
  // materialized artifacts + machine facts land in the per-clone exclude; the host has no .gitignore to touch
  const excl = readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8')
  assert.ok(excl.includes('spexcode:start') && excl.includes('.claude/settings.json'), 'exclude block planted')
  assert.ok(!existsSync(join(proj, '.gitignore')), 'init never creates or edits a host .gitignore')
})

test('init without --harness fails loud BEFORE writing anything — the delivery choice is required, never defaulted', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env } = freshRepo()
  const all = execFileSync('bash', ['-c', `cd '${proj}' && '${TSX}' '${CLI}' init . 2>&1; echo "exit:$?"`], { encoding: 'utf8', env })
  assert.match(all, /--harness is required/, 'the error names the missing flag')
  assert.match(all, /exit:1/, 'non-zero exit')
  assert.ok(!existsSync(join(proj, '.spec')) && !existsSync(join(proj, 'spexcode.json')), 'nothing was written')
})

test('--harness seeds only the selected launchers, with automatic permission limited to the headless runtime that requires it', { skip: !gitAvailable() && 'git not available' }, () => {
  const selections = [['claude'], ['codex'], ['opencode'], ['pi'], ['claude-headless'], ['opencode-headless'], ['claude', 'codex', 'opencode', 'pi', 'claude-headless', 'opencode-headless']]
  for (const selected of selections) {
    const { proj, codex, spex } = freshRepo()
    const out = spex('init', '.', '--harness', selected.join(','))
    const cfg = JSON.parse(readFileSync(join(proj, 'spexcode.json'), 'utf8'))
    const expectedNames = Object.keys(SEEDED_LAUNCHERS).filter((name) => selected.includes(name))
    const expectedLaunchers = Object.fromEntries(expectedNames.map((name) => [name, SEEDED_LAUNCHERS[name as keyof typeof SEEDED_LAUNCHERS]]))

    assert.deepEqual(cfg.harnesses, selected, 'the choice is persisted as the harnesses field')
    assert.equal(cfg.dashboard.showHeadlessLaunchers, false, 'fresh init explicitly hides headless dashboard launchers')
    assert.deepEqual(cfg.sessions.launchers, expectedLaunchers, 'unselected harnesses got no launcher and selected commands match their runtime form')
    assert.equal(cfg.sessions.defaultLauncher, expectedNames[0], 'defaultLauncher names the first real planted entry')
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

test('a fresh selected-harness default drives no-choice session creation and pins its safe command', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, home, env, spex } = freshRepo()
  spex('init', '.', '--harness', 'codex')

  // Make the liveness snapshot time out so the real create path leaves the session queued instead of starting
  // an installed Codex. This exercises CLI → newSession → persisted record without replacing the launcher.
  const fakeBin = mkdtempSync(join(tmpdir(), 'spex-init-bin-'))
  const fakeTmux = join(fakeBin, 'tmux')
  writeFileSync(fakeTmux, '#!/usr/bin/env node\nsetTimeout(() => {}, 10000)\n')
  chmodSync(fakeTmux, 0o755)
  const createEnv = {
    ...env,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    SPEXCODE_API_URL: 'http://127.0.0.1:1',
    SPEXCODE_TMUX: `safe-init-${process.pid}`,
  }
  const out = execFileSync(TSX, [CLI, 'session', 'new', 'safe default probe'], {
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
  const rec = JSON.parse(readFileSync(join(home, 'projects', projectKey, 'sessions', created.id, 'session.json'), 'utf8'))
  assert.equal(rec.launcher, 'codex')
  assert.equal(rec.harness, 'codex')
  assert.equal(rec.launch_cmd, 'codex', 'session creation pins the plain command from the named launcher')
})

test('a pre-existing retired render field is ignored with a loud notice — init still succeeds', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env } = freshRepo()
  writeFileSync(join(proj, 'spexcode.json'), '{"render":"committed","lint":{"governedRoots":["."]}}\n')
  const all = execFileSync('bash', ['-c', `cd '${proj}' && '${TSX}' '${CLI}' init . --harness claude,codex 2>&1`], { encoding: 'utf8', env })
  assert.match(all, /retired/i, 'the retired-field notice is loud')
  assert.ok(existsSync(join(proj, '.spec')), 'adoption proceeded — the field is inert, never fatal')
  assert.ok(readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8').includes('spexcode:start'), 'one residence behavior regardless of the field')
})
