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
const SAFE_LAUNCHERS = {
  claude: { harness: 'claude', cmd: 'claude' },
  codex: { harness: 'codex', cmd: 'codex' },
  opencode: { harness: 'opencode', cmd: 'opencode' },
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
  return { proj, home, env, g, spex }
}

test('init success message reports the governedRoots the template ACTUALLY ships — read from the planted file, drift-proof', { skip: !gitAvailable() && 'git not available' }, () => {
  const { spex } = freshRepo()
  const out = spex('init', '.', '--harness', 'claude,codex')
  assert.ok(out.includes(`lint.governedRoots starts as ${TEMPLATE_ROOTS}`), `plant message names the template value ${TEMPLATE_ROOTS}: ${out}`)
  assert.ok(out.includes(`(currently ${TEMPLATE_ROOTS})`), 'next-steps names the LIVE planted value')
  assert.ok(!out.includes('["src"]') || TEMPLATE_ROOTS === '["src"]', 'no stale hardcoded ["src"] claim anywhere')
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

test('--harness seeds ONLY safe ordinary launchers for every fresh selected-harness config', { skip: !gitAvailable() && 'git not available' }, () => {
  const selections = [['claude'], ['codex'], ['opencode'], ['pi'], ['claude', 'codex', 'opencode', 'pi']]
  for (const selected of selections) {
    const { proj, spex } = freshRepo()
    spex('init', '.', '--harness', selected.join(','))
    const cfg = JSON.parse(readFileSync(join(proj, 'spexcode.json'), 'utf8'))
    const expectedNames = Object.keys(SAFE_LAUNCHERS).filter((name) => selected.includes(name))
    const expectedLaunchers = Object.fromEntries(expectedNames.map((name) => [name, SAFE_LAUNCHERS[name as keyof typeof SAFE_LAUNCHERS]]))

    assert.deepEqual(cfg.harnesses, selected, 'the choice is persisted as the harnesses field')
    assert.deepEqual(cfg.sessions.launchers, expectedLaunchers, 'unselected harnesses got no launcher and selected commands stay ordinary')
    assert.equal(cfg.sessions.defaultLauncher, expectedNames[0], 'defaultLauncher names the first real planted entry')
    assert.doesNotMatch(JSON.stringify(cfg.sessions), /dangerously-skip-permissions|--yolo|--auto/, 'clean init never grants automatic permissions')

    if (selected.length === 1 && selected[0] === 'codex') {
      assert.ok(!existsSync(join(proj, 'CLAUDE.md')) && !existsSync(join(proj, '.claude')), 'no claude artifacts for a codex-only selection')
      assert.ok(existsSync(join(proj, '.codex', 'hooks.json')), 'the selected harness was delivered')
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
