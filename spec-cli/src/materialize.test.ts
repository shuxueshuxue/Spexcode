import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, rmSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { seedWorktreeHostState } from './worktree-sources.js'

// [[render-policy]] / [[content-filter]] / [[harness-delivery]] — the share-axis render engine is a state
// machine over policies (committed | ignored | hidden | legacy private | ∅), and its contract is the
// FORGETTING LAW: materialize(P₂) ∘ materialize(P₁) = materialize(P₂). Proven end-to-end through the REAL
// cli in throwaway git repos. A subprocess per step is deliberate: specs.ts memoizes ROOT = repoRoot() at
// module load, so only a fresh process resolves the temp repo correctly. The host shape mirrors the one
// that MADE the filter necessary: a repo that already TRACKS its own CLAUDE.md / AGENTS.md / .gitignore.

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = join(SRC, '..', 'node_modules', '.bin', 'tsx')

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}

// a fresh host repo that tracks its own contract files + .gitignore (internal blank-line run included —
// the shape whose bytes every round-trip must preserve), adopted via the real `spex init`, data committed.
function makeHost() {
  const proj = mkdtempSync(join(tmpdir(), 'spex-rp-'))
  const home = mkdtempSync(join(tmpdir(), 'spex-home-'))
  const codex = mkdtempSync(join(tmpdir(), 'spex-codex-'))
  const env = { ...process.env, SPEXCODE_HOME: home, CODEX_HOME: codex }
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
  const spex = (...args: string[]) =>
    execFileSync(TSX, [CLI, ...args], { cwd: proj, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'CLAUDE.md'), '# team notes\nkeep me\n')
  writeFileSync(join(proj, 'AGENTS.md'), '# team agents\nkeep me\n')
  writeFileSync(join(proj, '.gitignore'), 'node_modules/\nartifacts/\n\n\ndist/\n')
  g('add', '-A'); g('commit', '-qm', 'init')
  spex('init', '.')
  g('add', '.spec', 'spexcode.json'); g('commit', '-qm', 'adopt (data tracked)', '--no-verify')
  const setPolicy = (json: string | null) => {
    if (json === null) rmSync(join(proj, 'spexcode.local.json'), { force: true })
    else writeFileSync(join(proj, 'spexcode.local.json'), json)
  }
  return { proj, env, g, spex, setPolicy }
}

const status = (g: (...a: string[]) => string) => g('status', '--short').trim()

test('render policy: three values + the forgetting law (any-order switching converges; idempotent)', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex, setPolicy } = makeHost()
  const read = (f: string) => readFileSync(join(proj, f), 'utf8')
  const exclude = () => { const p = join(proj, '.git', 'info', 'exclude'); return existsSync(p) ? readFileSync(p, 'utf8') : '' }

  // -- ignored (the default, already rendered by init) --------------------------------------------------
  const giIgnored = read('.gitignore')
  assert.ok(giIgnored.includes('spexcode:start'), 'ignored: managed block in the tracked .gitignore')
  assert.ok(giIgnored.includes('CLAUDE.md') && giIgnored.includes('.claude/settings.json') && giIgnored.includes('.worktrees/'),
    'ignored: renders + machine facts + run residue all in the block')
  assert.ok(giIgnored.includes('\n\n\ndist/'), 'the user internal blank-line run is intact')
  assert.ok(read('CLAUDE.md').includes('spexcode:start') && read('CLAUDE.md').includes('keep me'), 'contract delivered, prose kept')

  // -- hidden: zero repo footprint; tracked contract files go through the content filter ----------------
  setPolicy('{"render":"hidden"}\n')
  spex('materialize')
  assert.equal(status(g), '', 'hidden: git status is CLEAN — no leak, no phantom-M')
  assert.equal(read('.gitignore'), 'node_modules/\nartifacts/\n\n\ndist/\n', 'hidden: .gitignore back to the committed bytes')
  assert.match(exclude(), /spexcode:start[\s\S]*CLAUDE\.md[\s\S]*spexcode:end/, 'hidden: the block moved to info/exclude')
  assert.ok(read('CLAUDE.md').includes('spexcode:start'), 'hidden: the working tree still carries the contract')
  assert.ok(!g('show', ':CLAUDE.md').includes('spexcode:start'), 'hidden: the INDEX stays pristine (clean filter)')
  assert.ok(g('config', 'filter.spexcode.clean').trim().length > 0, 'hidden: filter configured per-clone')
  assert.match(readFileSync(join(proj, '.git', 'info', 'attributes'), 'utf8'), /\/CLAUDE\.md filter=spexcode/, 'hidden: attributes bind the tracked file')

  // -- committed: renders become ordinary files; ONLY their entries leave the block ---------------------
  setPolicy('{"render":"committed"}\n')
  spex('materialize')
  const giCommitted = read('.gitignore')
  assert.ok(giCommitted.includes('spexcode:start'), 'committed: machine facts still need the block')
  assert.ok(!/^CLAUDE\.md$/m.test(giCommitted) && !/^AGENTS\.md$/m.test(giCommitted), 'committed: render entries left the block')
  assert.ok(giCommitted.includes('.claude/settings.json') && giCommitted.includes('spexcode.local.json'), 'committed: shims + local overlay stay ignored')
  assert.throws(() => g('config', 'filter.spexcode.clean'), 'committed: filter unplanted')
  assert.ok(!exclude().includes('spexcode:start'), 'committed: exclude block gone')
  assert.ok(read('CLAUDE.md').includes('spexcode:start'), 'committed: the render is present, an ordinary committable file')

  // -- the forgetting law: P₁→P₂→P₁ converges byte-for-byte; running P₁ twice changes nothing -----------
  setPolicy(null)   // back to the default policy (ignored)
  spex('materialize')
  assert.equal(read('.gitignore'), giIgnored, 'ignored→hidden→committed→ignored: .gitignore converges to the P₁ render')
  const snap = () => [read('.gitignore'), read('CLAUDE.md'), read('AGENTS.md'), exclude(), status(g)].join('\0')
  const once = snap()
  spex('materialize')
  assert.equal(snap(), once, 'idempotence: rendering the same policy twice is byte-stable')
})

test('content-filter edges: missing shim degrades to cat; a contract change re-renders + settles; uninstall leaves no residue', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex, setPolicy } = makeHost()
  setPolicy('{"render":"hidden"}\n')
  spex('materialize')
  assert.equal(status(g), '', 'hidden baseline: clean status')

  // edge ①: the shim goes missing → git must NOT spray fatals; the filter degrades to identity
  const shim = join(proj, '.git', 'spexcode', 'contract-filter.sh')
  const shimBytes = readFileSync(shim)
  rmSync(shim)
  const st = execFileSync('git', ['-C', proj, 'status', '--short'], { encoding: 'utf8' })   // throws on a git fatal
  assert.ok(typeof st === 'string', 'edge ①: git status still works with the shim missing')
  writeFileSync(shim, shimBytes)   // restore

  // edge ②: a surface:system edit must reach the working file on re-render AND leave status clean
  const sysNode = execFileSync('bash', ['-c', `grep -l '^surface: system' '${join(proj, '.spec')}'/*/.config/*/spec.md | sort | head -1`], { encoding: 'utf8' }).trim()
  assert.ok(sysNode, 'seeded .config has a surface:system node to edit')
  writeFileSync(sysNode, readFileSync(sysNode, 'utf8') + '\nEDGE-TWO-PROPAGATED\n')
  g('add', '.spec'); g('commit', '-qm', 'config edit (data is tracked — committed like any source)', '--no-verify')
  spex('materialize')
  assert.ok(readFileSync(join(proj, 'CLAUDE.md'), 'utf8').includes('EDGE-TWO-PROPAGATED'), 'edge ②: the re-render carried the new contract into the working file')
  assert.equal(status(g), '', 'edge ②: still clean — the settle refreshed the stat, the index stayed pristine')
  assert.ok(!g('show', ':CLAUDE.md').includes('EDGE-TWO-PROPAGATED'), 'edge ②: index untouched')

  // a REAL user edit must keep its honest M (the settle guard must not swallow it)
  const claude = join(proj, 'CLAUDE.md')
  writeFileSync(claude, readFileSync(claude, 'utf8').replace('keep me', 'keep me — user edit'))
  spex('materialize')
  assert.match(status(g), /M CLAUDE\.md/, 'a genuine prose edit stays visible as modified')
  g('checkout', '--', 'CLAUDE.md')   // drop the edit; the smudge re-injects the block on checkout
  assert.ok(readFileSync(claude, 'utf8').includes('spexcode:start'), 'checkout re-smudges the block')
  spex('materialize')
  assert.equal(status(g), '', 'clean again after the edit is dropped')

  // edge ③: uninstall = materialize(∅) — ordered unplant, zero residue, user bytes restored
  spex('uninstall', '.')
  // the user's own spexcode.local.json turns visible (its ignore rule left with the render) — the only
  // acceptable status line; no modified file may remain (no block residue, no phantom-M).
  assert.equal(status(g), '?? spexcode.local.json', 'edge ③: only the now-unignored user overlay shows after uninstall')
  assert.equal(readFileSync(claude, 'utf8'), '# team notes\nkeep me\n', 'CLAUDE.md back to the pristine host bytes')
  assert.throws(() => g('config', 'filter.spexcode.clean'), 'filter config unset')
  assert.ok(!existsSync(shim) && !existsSync(join(proj, '.git', 'spexcode', 'contract-block.md')), 'shim + block content removed')
  const attrs = join(proj, '.git', 'info', 'attributes')
  assert.ok(!existsSync(attrs) || !readFileSync(attrs, 'utf8').includes('spexcode'), 'attributes clean')
  assert.ok(!existsSync(join(proj, '.claude', 'settings.json')) && !existsSync(join(proj, '.codex', 'hooks.json')), 'shims removed')
  assert.ok(!existsSync(join(proj, '.claude')) && !existsSync(join(proj, '.codex')), 'the emptied harness dirs themselves are gone — nothing left behind')
  assert.ok(existsSync(join(proj, '.spec')) && existsSync(join(proj, 'spexcode.json')), 'the spec ASSET is never touched')
})

test('a HOST-TRACKED wholly-ours .gitignore survives the backout (same authorship guard)', { skip: !gitAvailable() && 'git not available' }, () => {
  // a plain adopter with NO .gitignore of its own: init generates one that is nothing but our block —
  // then the team commits it (ignored mode, block tracked). Backout must strip it, never delete it.
  const proj = mkdtempSync(join(tmpdir(), 'spex-gi-'))
  const home = mkdtempSync(join(tmpdir(), 'spex-home-'))
  const codex = mkdtempSync(join(tmpdir(), 'spex-codex-'))
  const env = { ...process.env, SPEXCODE_HOME: home, CODEX_HOME: codex }
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
  const spex = (...args: string[]) =>
    execFileSync(TSX, [CLI, ...args], { cwd: proj, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'README.md'), '# app\n')
  g('add', '-A'); g('commit', '-qm', 'init')
  spex('init', '.')
  assert.ok(readFileSync(join(proj, '.gitignore'), 'utf8').includes('spexcode:start'), 'init generated a wholly-ours .gitignore')
  g('add', '.spec', 'spexcode.json', '.gitignore'); g('commit', '-qm', 'adopt (block committed)', '--no-verify')
  spex('uninstall', '.')
  assert.ok(existsSync(join(proj, '.gitignore')), 'the tracked .gitignore is stripped, never deleted')
  assert.ok(!/^.?D /m.test(g('status', '--short')), `no deletion in status: ${status(g)}`)
  assert.equal(readFileSync(join(proj, '.gitignore'), 'utf8').trim(), '', 'stripped clean — no block residue')
})

test('a HOST-TRACKED empty contract file survives the backout (deleteIfEmpty guards on tracked-ness)', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex } = makeHost()
  // the extreme host: a committed EMPTY CLAUDE.md the render folded a block into
  writeFileSync(join(proj, 'CLAUDE.md'), '')
  g('add', 'CLAUDE.md'); g('commit', '-qm', 'empty tracked contract file', '--no-verify')
  spex('materialize')
  assert.ok(readFileSync(join(proj, 'CLAUDE.md'), 'utf8').includes('spexcode:start'), 'block folded into the empty tracked file')
  spex('uninstall', '.')
  assert.ok(existsSync(join(proj, 'CLAUDE.md')), 'the tracked file is stripped, never deleted')
  assert.ok(!status(g).includes('D '), `no deletion in status: ${status(g)}`)
})

test('content-filter invariant: a host file that BEGINS with blank lines round-trips byte-exactly', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex, setPolicy } = makeHost()
  const leading = '\n\n# starts blank\nkeep me\n'
  writeFileSync(join(proj, 'CLAUDE.md'), leading)
  g('add', 'CLAUDE.md'); g('commit', '-qm', 'leading-blank host', '--no-verify')
  setPolicy('{"render":"hidden"}\n')
  spex('materialize')
  // clean status PROVES clean(worktree) == index blob byte-for-byte — including the leading blanks
  assert.equal(status(g), '', 'hidden: clean status on a leading-blank host file')
  assert.ok(readFileSync(join(proj, 'CLAUDE.md'), 'utf8').startsWith('\n\n# starts blank'), 'leading blanks kept in the working tree')
  spex('uninstall', '.')
  assert.equal(readFileSync(join(proj, 'CLAUDE.md'), 'utf8'), leading, 'uninstall restores the exact bytes (leading blanks survive removeManagedBlock)')
})

test('legacy private:true maps to render=hidden with a loud migration notice (untracked data recipe included)', { skip: !gitAvailable() && 'git not available' }, () => {
  // the LEGACY untrack-private deployment shape: private:true AND the spec sources untracked
  const proj = mkdtempSync(join(tmpdir(), 'spex-legacy-'))
  const home = mkdtempSync(join(tmpdir(), 'spex-home-'))
  const codex = mkdtempSync(join(tmpdir(), 'spex-codex-'))
  const env = { ...process.env, SPEXCODE_HOME: home, CODEX_HOME: codex }
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'README.md'), '# app\n')
  g('add', '-A'); g('commit', '-qm', 'init')
  // seed an UNTRACKED spec tree (as the retired mode left it) by copying a real init's .spec
  const donor = makeHost()
  cpSync(join(donor.proj, '.spec'), join(proj, '.spec'), { recursive: true })
  cpSync(join(donor.proj, 'spexcode.json'), join(proj, 'spexcode.json'))
  writeFileSync(join(proj, 'spexcode.local.json'), '{"private":true}\n')
  const stderr = execFileSync('bash', ['-c', `cd '${proj}' && '${TSX}' '${CLI}' materialize 2>&1 >/dev/null`], { encoding: 'utf8', env })
  assert.match(stderr, /private.*retired/is, 'the migration notice is loud')
  assert.match(stderr, /"render": "hidden"/, 'the notice names the mapping')
  assert.match(stderr, /git add \.spec spexcode\.json/, 'the untracked legacy data gets the track-once recipe')
  assert.match(stderr, /not retroactive/i, 'the pushed-history WARN is present')
  // behaviourally hidden: exclude carries the block, no tracked .gitignore block
  const excl = readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8')
  assert.ok(excl.includes('spexcode:start'), 'private:true renders as hidden (exclude block)')
  assert.ok(!existsSync(join(proj, '.gitignore')) || !readFileSync(join(proj, '.gitignore'), 'utf8').includes('spexcode:start'), 'no tracked .gitignore block')
})

test('render: an unknown policy word fails loud', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env, setPolicy } = makeHost()
  setPolicy('{"render":"invisible"}\n')
  assert.throws(
    () => execFileSync(TSX, [CLI, 'materialize'], { cwd: proj, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }),
    'materialize rejects the unknown word',
  )
})

// [[harness-adapter]] — a dispatched CODEX worker runs in a LINKED WORKTREE, and codex fires its hooks only
// when the worktree (a) ANCHORS a project config layer and (b) that project is TRUSTED and (c) each hook is
// HASHED. materialize must satisfy all three at the worktree so a fresh-init codex worker's hooks fire.
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

  const wt = join(proj, '.worktrees', 'wt')
  g('worktree', 'add', '-q', wt, '-b', 'node/wt')
  spex(wt, 'materialize')                                  // per-worktree render (as sessions.ts does at launch)

  assert.ok(existsSync(join(wt, '.codex', 'hooks.json')), 'worktree has a .codex/hooks.json anchor')
  assert.ok(existsSync(join(proj, '.codex', 'hooks.json')), 'main checkout still has the codex shim')
  const cfg = readFileSync(join(codex, 'config.toml'), 'utf8')
  assert.ok(cfg.includes(`[projects."${proj}"]`) && cfg.includes('trust_level = "trusted"'), 'main-checkout project trusted')
  for (const snake of ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop'])
    assert.match(cfg, new RegExp(`hooks.state."[^"]*:${snake}:0:0"\\]\\s*\\ntrusted_hash = "sha256:`), `per-hook trusted_hash for ${snake}`)
})

// [[render-policy]] — worktree seeding by KIND: tracked data arrives by CHECKOUT (no symlinks, ever),
// renders by re-render, and the ONE thing git cannot deliver — the machine-local spexcode.local.json —
// is COPIED as a snapshot whose writes die with the worktree. What it seeds it hides.
test('worktree seeding: tracked data via checkout (never a link), host state copied with write isolation, seeded entry hidden', { skip: !gitAvailable() && 'git not available' }, () => {
  const main = mkdtempSync(join(tmpdir(), 'spex-seed-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  mkdirSync(join(main, '.spec'))
  writeFileSync(join(main, '.spec', 'x.md'), 'x')
  writeFileSync(join(main, 'spexcode.json'), '{}')
  g('add', '-A'); g('commit', '-qm', 'init')                      // data TRACKED — the model's invariant
  const hostLocal = '{"sessions":{"defaultLauncher":"reclaude"}}\n'
  writeFileSync(join(main, 'spexcode.local.json'), hostLocal)

  const wt = join(main, '.worktrees', 'wt')
  g('worktree', 'add', '-q', wt, '-b', 'node/wt')
  seedWorktreeHostState(main, wt)

  // tracked data arrived by CHECKOUT — real files, never links
  assert.ok(!lstatSync(join(wt, '.spec')).isSymbolicLink(), '.spec is a real checkout, not a link')
  assert.equal(readFileSync(join(wt, '.spec', 'x.md'), 'utf8'), 'x', 'spec content delivered by git')
  assert.ok(!lstatSync(join(wt, 'spexcode.json')).isSymbolicLink(), 'spexcode.json is a real checkout')
  // host state is a COPY snapshot with write isolation
  assert.ok(!lstatSync(join(wt, 'spexcode.local.json')).isSymbolicLink(), 'spexcode.local.json is a copy, not a link')
  assert.equal(readFileSync(join(wt, 'spexcode.local.json'), 'utf8'), hostLocal, 'a faithful snapshot')
  writeFileSync(join(wt, 'spexcode.local.json'), '{"forge":{"host":"gitlab"}}\n')
  assert.equal(readFileSync(join(main, 'spexcode.local.json'), 'utf8'), hostLocal, 'a worker write never reaches the host config')
  // the seeded (git-visible) entry is hidden via the shared exclude; a second seed appends nothing
  const st = (dir: string) => execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  assert.ok(!st(wt).includes('spexcode.local.json'), 'no force-add bait in the worktree')
  const exclude = readFileSync(join(main, '.git', 'info', 'exclude'), 'utf8')
  const wt2 = join(main, '.worktrees', 'wt2')
  g('worktree', 'add', '-q', wt2, '-b', 'node/wt2')
  seedWorktreeHostState(main, wt2)
  assert.equal(readFileSync(join(main, '.git', 'info', 'exclude'), 'utf8'), exclude, 'idempotent — no duplicate exclude entries')
})
