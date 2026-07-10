import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { linkUntrackedSpecSources } from './worktree-sources.js'

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
  // an INTERNAL blank-line run in the user's .gitignore — the shape the round-trip must preserve exactly
  writeFileSync(join(proj, '.gitignore'), 'node_modules/\nartifacts/\n\n\ndist/\n')
  g('add', '-A'); g('commit', '-qm', 'init')

  // adopt SpexCode (DEFAULT render) — capture its canonical .gitignore for the cancel-out check below
  spex('init', '.')
  const gitignoreDefault = readFileSync(join(proj, '.gitignore'), 'utf8')
  assert.ok(gitignoreDefault.includes('spexcode:start') && gitignoreDefault.includes('\n\n\ndist/'), 'default block written, user blank-line run intact')
  assert.ok(gitignoreDefault.includes('.worktrees/'), 'default block ignores SpexCode session worktrees')
  // flip to PRIVATE
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
  assert.match(infoExclude, /\.worktrees\//, 'private exclude also hides SpexCode session worktrees')
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

  // (6) CANCEL-OUT: default→private→default lands the .gitignore BYTE-for-byte back to the default render —
  // switching modes and back is a no-op on the tracked file (this fails if remove mangles the user's whitespace)
  assert.equal(readFileSync(join(proj, '.gitignore'), 'utf8'), gitignoreDefault, 'default→private→default restores .gitignore exactly (idempotent cancel-out)')
})

// [[harness-adapter]] — a dispatched CODEX worker runs in a LINKED WORKTREE, and codex fires its hooks only
// when the worktree (a) ANCHORS a project config layer and (b) that project is TRUSTED and (c) each hook is
// HASHED — none of which `--dangerously-bypass-hook-trust` provides. materialize must satisfy all three at the
// worktree so a fresh-init codex worker's hooks fire (before this, only a project that happened to materialize
// `.codex/skills` got the anchor, and the bypass path skipped the trust entirely → ZERO hooks).
test('codex worktree materialize plants the .codex anchor + unconditional project trust + per-hook hashes', { skip: !gitAvailable() && 'git not available' }, () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-cxwt-'))
  const home = mkdtempSync(join(tmpdir(), 'spex-home-'))
  const codex = mkdtempSync(join(tmpdir(), 'spex-codex-'))
  const env = { ...process.env, SPEXCODE_HOME: home, CODEX_HOME: codex }
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
  const spex = (cwd: string, ...args: string[]) => execFileSync(TSX, [CLI, ...args], { cwd, encoding: 'utf8', env })

  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'README.md'), '# app\n')
  g('add', '-A'); g('commit', '-qm', 'init')
  spex(proj, 'init', '.')                                  // seeds .spec (incl .config/core) + materializes at main
  g('add', '-A'); g('commit', '-qm', 'adopt', '--no-verify')

  // a linked worktree, the shape a dispatched codex worker runs in
  const wt = join(proj, '.worktrees', 'wt')
  g('worktree', 'add', '-q', wt, '-b', 'node/wt')
  spex(wt, 'materialize')                                  // per-worktree render (as sessions.ts does at launch)

  // (a) the worktree carries a .codex/hooks.json ANCHOR (else codex builds no layer for the worktree cwd)
  assert.ok(existsSync(join(wt, '.codex', 'hooks.json')), 'worktree has a .codex/hooks.json anchor')
  // the shim codex actually reads via the root rewrite still lives at the MAIN checkout
  assert.ok(existsSync(join(proj, '.codex', 'hooks.json')), 'main checkout still has the codex shim')

  // (b)+(c) config.toml carries PROJECT trust for the MAIN checkout AND a per-hook trusted_hash for each event
  const cfg = readFileSync(join(codex, 'config.toml'), 'utf8')
  assert.ok(cfg.includes(`[projects."${proj}"]`) && cfg.includes('trust_level = "trusted"'), 'main-checkout project trusted')
  for (const snake of ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop'])
    assert.match(cfg, new RegExp(`hooks.state."[^"]*:${snake}:0:0"\\]\\s*\\ntrusted_hash = "sha256:`), `per-hook trusted_hash for ${snake}`)
})

// [[private-overlay]] — the session-worktree seam: git worktree add checks out only tracked content, so a
// private-mode repo (untracked .spec + spexcode.json) would hand a dispatched agent a spec-blind, hook-dead
// worktree. linkUntrackedSpecSources seeds each source by its semantics: PROJECT state (.spec, spexcode.json)
// links (shared write-through is the point), HOST state (spexcode.local.json) copies (a worker's config write
// must die with the worktree, not clobber the host's launchers), and whatever it seeds it hides in the SHARED
// .git/info/exclude so nothing sits as force-add bait in the worktree's git status.
test('private-overlay worktree seeding: project state links, host state copies (writes stay local), seeded entries hidden via shared info/exclude', { skip: !gitAvailable() && 'git not available' }, () => {
  const main = mkdtempSync(join(tmpdir(), 'spex-priv-main-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(main, 'README.md'), '# app\n')
  g('add', '-A'); g('commit', '-qm', 'init')
  // private HALF-configured shape (the wild incident shape): untracked sources, NO exclude entries
  mkdirSync(join(main, '.spec'))
  writeFileSync(join(main, '.spec', 'x.md'), 'x')
  writeFileSync(join(main, 'spexcode.json'), '{}')
  const hostLocal = '{"sessions":{"defaultLauncher":"reclaude"}}\n'
  writeFileSync(join(main, 'spexcode.local.json'), hostLocal)

  const wt = join(main, '.worktrees', 'wt')
  g('worktree', 'add', '-q', wt, '-b', 'node/wt')
  linkUntrackedSpecSources(main, wt)

  // project state arrives as LINKS (spec writes land in the main tree); host state as a COPY snapshot
  assert.ok(lstatSync(join(wt, '.spec')).isSymbolicLink(), '.spec arrives as a link')
  assert.equal(readFileSync(join(wt, '.spec', 'x.md'), 'utf8'), 'x', 'worktree reads the main spec tree through the link')
  assert.ok(lstatSync(join(wt, 'spexcode.json')).isSymbolicLink(), 'spexcode.json arrives as a link')
  assert.ok(!lstatSync(join(wt, 'spexcode.local.json')).isSymbolicLink(), 'spexcode.local.json is a COPY, not a link')
  assert.equal(readFileSync(join(wt, 'spexcode.local.json'), 'utf8'), hostLocal, 'the copy is a faithful snapshot (same mode/launchers)')

  // a worker overwriting "its" local config must NOT write through to the host's real config
  writeFileSync(join(wt, 'spexcode.local.json'), '{"forge":{"host":"gitlab"}}\n')
  assert.equal(readFileSync(join(main, 'spexcode.local.json'), 'utf8'), hostLocal, 'the main checkout config survives the worker write')

  // seeded entries are hidden in the COMMON info/exclude → invisible in the worktree AND the main checkout
  const st = (dir: string) => execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  assert.equal(st(wt), '', 'worktree git status shows no seeded entry (no force-add bait)')
  // main sees the rig's own `.worktrees/` (materialize's block ignores it in a real repo) but no seeded entry
  assert.ok(!/\.spec|spexcode/.test(st(main)), 'main checkout no longer shows the sources (the shared exclude self-heals the half-configured repo)')
  const exclude = readFileSync(join(main, '.git', 'info', 'exclude'), 'utf8')
  for (const f of ['.spec', 'spexcode.json', 'spexcode.local.json'])
    assert.ok(exclude.includes(`${f}\n`), `${f} written into the shared exclude`)

  // idempotent: a second dispatch seeds its own worktree but appends nothing (check-ignore already says hidden)
  const wt2 = join(main, '.worktrees', 'wt2')
  g('worktree', 'add', '-q', wt2, '-b', 'node/wt2')
  linkUntrackedSpecSources(main, wt2)
  assert.equal(st(wt2), '', 'second worktree is clean as well')
  assert.equal(readFileSync(join(main, '.git', 'info', 'exclude'), 'utf8'), exclude, 'no duplicate exclude entries on re-seed')
})

// default-mode shape: git already delivers the tracked sources, so the seed guards no-op (one mechanism, no
// mode branch) — and since nothing git-visible was seeded, NO exclude residue is left behind.
test('private-overlay worktree seeding: on a default-mode repo the guards no-op and leave no exclude residue', { skip: !gitAvailable() && 'git not available' }, () => {
  const main = mkdtempSync(join(tmpdir(), 'spex-def-main-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  mkdirSync(join(main, '.spec'))
  writeFileSync(join(main, '.spec', 'own.md'), 'own')
  writeFileSync(join(main, 'spexcode.json'), '{}')
  writeFileSync(join(main, '.gitignore'), 'spexcode.local.json\n')   // default render gitignores the local overlay
  g('add', '-A'); g('commit', '-qm', 'init')
  writeFileSync(join(main, 'spexcode.local.json'), '{"private":false}\n')

  const wt = join(main, '.worktrees', 'wt')
  g('worktree', 'add', '-q', wt, '-b', 'node/wt')
  linkUntrackedSpecSources(main, wt)

  // tracked sources came from the checkout — never clobbered; only the genuinely missing local overlay is seeded
  assert.ok(!lstatSync(join(wt, '.spec')).isSymbolicLink(), 'the checked-out .spec is untouched')
  assert.equal(readFileSync(join(wt, '.spec', 'own.md'), 'utf8'), 'own', 'its content is intact')
  assert.ok(!lstatSync(join(wt, 'spexcode.local.json')).isSymbolicLink(), 'the local overlay is seeded as a copy')
  // gitignored already → check-ignore short-circuits → no exclude write, no residue
  const excludePath = join(main, '.git', 'info', 'exclude')
  const exclude = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
  assert.ok(!exclude.includes('spexcode.local.json'), 'no exclude residue on a default-mode repo')
  assert.equal(execFileSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'worktree clean')
})
