import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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
  return { proj, codex, env, g, spex }
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

test('Claude-only clean init reports and plants only Claude delivery artifacts', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, codex, spex } = freshRepo()
  const out = spex('init', '.', '--harness', 'claude')
  const cfg = JSON.parse(readFileSync(join(proj, 'spexcode.json'), 'utf8'))
  assert.deepEqual(cfg.harnesses, ['claude'], 'the choice is persisted as the harnesses field')
  assert.deepEqual(Object.keys(cfg.sessions.launchers), ['claude'], 'unselected harnesses got no launcher')
  assert.equal(cfg.sessions.defaultLauncher, 'claude', 'defaultLauncher follows the selection')
  assert.match(out, /contract: CLAUDE\.md/, 'the materialize receipt reports the Claude contract')
  assert.match(out, /shim: \.claude\/settings\.json/, 'the materialize receipt reports the Claude shim')
  assert.doesNotMatch(out, /AGENTS\.md|\.codex\/hooks\.json|trust:/, 'no Codex contract, shim, or trust claim')
  assert.ok(existsSync(join(proj, 'CLAUDE.md')) && existsSync(join(proj, '.claude', 'settings.json')), 'Claude artifacts exist')
  assert.ok(!existsSync(join(proj, 'AGENTS.md')) && !existsSync(join(proj, '.codex')), 'no Codex artifacts were planted')
  assert.ok(!existsSync(join(codex, 'config.toml')), 'no Codex trust was planted')
})

test('Codex-only clean init reports and plants only Codex delivery artifacts', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, codex, spex } = freshRepo()
  const out = spex('init', '.', '--harness', 'codex')
  const cfg = JSON.parse(readFileSync(join(proj, 'spexcode.json'), 'utf8'))
  assert.deepEqual(cfg.harnesses, ['codex'], 'the choice is persisted as the harnesses field')
  assert.deepEqual(Object.keys(cfg.sessions.launchers), ['codex'], 'unselected harnesses got no launcher')
  assert.equal(cfg.sessions.defaultLauncher, 'codex', 'defaultLauncher follows the selection')
  assert.match(out, /contract: AGENTS\.md/, 'the materialize receipt reports the Codex contract')
  assert.match(out, /shim: \.codex\/hooks\.json/, 'the materialize receipt reports the Codex shim')
  assert.match(out, /trust: .*config\.toml/, 'the materialize receipt reports the Codex trust write')
  assert.doesNotMatch(out, /CLAUDE\.md|\.claude\/settings\.json/, 'no Claude contract or shim claim')
  assert.ok(existsSync(join(proj, 'AGENTS.md')) && existsSync(join(proj, '.codex', 'hooks.json')), 'Codex artifacts exist')
  assert.ok(existsSync(join(codex, 'config.toml')), 'Codex trust exists')
  assert.ok(!existsSync(join(proj, 'CLAUDE.md')) && !existsSync(join(proj, '.claude')), 'no Claude artifacts were planted')
})

test('a pre-existing retired render field is ignored with a loud notice — init still succeeds', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env } = freshRepo()
  writeFileSync(join(proj, 'spexcode.json'), '{"render":"committed","lint":{"governedRoots":["."]}}\n')
  const all = execFileSync('bash', ['-c', `cd '${proj}' && '${TSX}' '${CLI}' init . --harness claude,codex 2>&1`], { encoding: 'utf8', env })
  assert.match(all, /retired/i, 'the retired-field notice is loud')
  assert.ok(existsSync(join(proj, '.spec')), 'adoption proceeded — the field is inert, never fatal')
  assert.ok(readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8').includes('spexcode:start'), 'one residence behavior regardless of the field')
})
