import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// [[private-overlay]] — the private-mode render is a state-machine edge (DEFAULT ⇄ PRIVATE) that must fully
// reverse, so it is proven end-to-end through the REAL cli in a throwaway git repo. A subprocess per step is
// deliberate: specs.ts memoizes ROOT = repoRoot() at module load, so only a fresh process resolves the temp
// repo correctly. The scenario mirrors the host that MADE this feature necessary — one that already TRACKS its
// own CLAUDE.md / AGENTS.md / .gitignore, where gitignoring a tracked file is a no-op and the folded-in block
// would otherwise leak.

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = join(SRC, '..', 'node_modules', '.bin', 'tsx')

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}

test('private-overlay: on a host that pre-tracks CLAUDE.md/AGENTS.md/.gitignore, private mode leaves ZERO trace and reverses cleanly', { skip: !gitAvailable() && 'git not available' }, () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-priv-'))
  const home = mkdtempSync(join(tmpdir(), 'spex-home-'))
  const codex = mkdtempSync(join(tmpdir(), 'spex-codex-'))
  const env = { ...process.env, SPEXCODE_HOME: home, CODEX_HOME: codex }
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
  const spex = (...args: string[]) => execFileSync(TSX, [CLI, ...args], { cwd: proj, encoding: 'utf8', env })

  // a host that already TRACKS its own contract files + .gitignore
  g('init', '-q')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'CLAUDE.md'), '# team notes\nkeep me\n')
  writeFileSync(join(proj, 'AGENTS.md'), '# team agents\nkeep me\n')
  writeFileSync(join(proj, '.gitignore'), 'node_modules/\n')
  g('add', '-A'); g('commit', '-qm', 'init')

  // adopt SpexCode (DEFAULT render), then flip to PRIVATE
  spex('init', '.')
  writeFileSync(join(proj, 'spexcode.local.json'), '{"private":true}\n')
  spex('materialize')

  const infoExclude = readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8')
  const gitignore = readFileSync(join(proj, '.gitignore'), 'utf8')
  const claude = readFileSync(join(proj, 'CLAUDE.md'), 'utf8')
  const lsv = (f: string) => g('ls-files', '-v', f).trim()[0]   // 'S' = skip-worktree, 'H' = tracked/normal

  // (1) nothing spexcode-related is staged or shows as a working-tree change
  assert.equal(g('status', '--short').trim(), '', 'working tree must be clean — no leak')
  // (2) the ignore block moved to the per-clone .git/info/exclude, widened to hide .spec + spexcode.json
  assert.match(infoExclude, /spexcode:start[\s\S]*\.spec\/[\s\S]*spexcode\.json[\s\S]*spexcode:end/, 'info/exclude carries the widened block')
  // (3) the tracked .gitignore carries NO spexcode block
  assert.ok(!gitignore.includes('spexcode:start'), '.gitignore stays untouched')
  // (4) the pre-tracked contract files are skip-worktree'd, yet the block + the team's prose are BOTH present
  assert.equal(lsv('CLAUDE.md'), 'S', 'CLAUDE.md skip-worktree')
  assert.equal(lsv('AGENTS.md'), 'S', 'AGENTS.md skip-worktree')
  assert.ok(claude.includes('spexcode:start') && claude.includes('keep me'), 'block delivered + user prose kept')

  // (5) REVERSIBLE: flip back to DEFAULT and every private artifact is undone
  writeFileSync(join(proj, 'spexcode.local.json'), '{"private":false}\n')
  spex('materialize')
  assert.ok(!readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8').includes('spexcode:start'), 'info/exclude block stripped')
  assert.ok(readFileSync(join(proj, '.gitignore'), 'utf8').includes('spexcode:start'), '.gitignore block restored')
  assert.equal(lsv('CLAUDE.md'), 'H', 'CLAUDE.md skip-worktree cleared')
})
