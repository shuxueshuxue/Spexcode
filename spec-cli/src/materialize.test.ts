import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { seedWorktreeHostState } from './worktree-sources.js'

// [[residence]] / [[content-filter]] / [[commit-surgery]] / [[harness-delivery]] — the vote-less
// footprint engine: materialized artifacts are NEVER tracked (one residence behavior), a contract file's domain is a LIVE
// content fact (tracked → filter; untracked+ours → exclude; untracked+user-prose → un-hidden + clean armed),
// and history is guarded by the pre-commit surgery, all under the FORGETTING LAW:
// materialize(P₂) ∘ materialize(P₁) = materialize(P₂). Proven end-to-end through the REAL cli in throwaway
// git repos. A subprocess per step is deliberate: specs.ts memoizes ROOT = repoRoot() at module load, so
// only a fresh process resolves the temp repo correctly. The host shape mirrors the one that MADE the
// filter necessary: a repo that already TRACKS its own CLAUDE.md / AGENTS.md / .gitignore.

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
  const spexStderr = (...args: string[]) =>
    execFileSync('bash', ['-c', `cd '${proj}' && '${TSX}' '${CLI}' ${args.join(' ')} 2>&1 >/dev/null`], { encoding: 'utf8', env })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'CLAUDE.md'), '# team notes\nkeep me\n')
  writeFileSync(join(proj, 'AGENTS.md'), '# team agents\nkeep me\n')
  writeFileSync(join(proj, '.gitignore'), 'node_modules/\nartifacts/\n\n\ndist/\n')
  g('add', '-A'); g('commit', '-qm', 'init')
  spex('init', '.')
  g('add', '.spec', 'spexcode.json'); g('commit', '-qm', 'adopt (data tracked)', '--no-verify')
  const setLocal = (json: string | null) => {
    if (json === null) rmSync(join(proj, 'spexcode.local.json'), { force: true })
    else writeFileSync(join(proj, 'spexcode.local.json'), json)
  }
  return { proj, env, g, spex, spexStderr, setLocal }
}

const status = (g: (...a: string[]) => string) => g('status', '--short').trim()

test('one residence behavior: tracked contracts go through the filter, host .gitignore untouched, exclude carries the rest; idempotent', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex } = makeHost()
  const read = (f: string) => readFileSync(join(proj, f), 'utf8')
  const exclude = () => { const p = join(proj, '.git', 'info', 'exclude'); return existsSync(p) ? readFileSync(p, 'utf8') : '' }

  // no vote, no modes: the adoption materialize already left the host clean
  assert.equal(status(g), '', 'clean status straight after adoption — no leak, no phantom-M, no honest-M prompt')
  assert.equal(read('.gitignore'), 'node_modules/\nartifacts/\n\n\ndist/\n', 'the host .gitignore is NEVER touched')
  assert.match(exclude(), /spexcode:start[\s\S]*spexcode:end/, 'the managed ignore block lives in per-clone info/exclude')
  assert.ok(exclude().includes('.claude/settings.json') && exclude().includes('spexcode.local.json') && exclude().includes('.worktrees/'),
    'machine facts + run residue in the exclude block')
  assert.ok(!/^CLAUDE\.md$/m.test(exclude()) && !/^AGENTS\.md$/m.test(exclude()),
    'tracked contract files are the FILTER domain — never exclude entries')
  assert.ok(read('CLAUDE.md').includes('spexcode:start') && read('CLAUDE.md').includes('keep me'), 'contract delivered, prose kept')
  assert.ok(!g('show', ':CLAUDE.md').includes('spexcode:start'), 'the INDEX stays pristine (clean filter)')
  assert.ok(g('config', 'filter.spexcode.clean').trim().length > 0, 'filter configured per-clone')
  assert.match(readFileSync(join(proj, '.git', 'info', 'attributes'), 'utf8'), /\/CLAUDE\.md filter=spexcode/, 'attributes bind the tracked file')

  // idempotence: materializing again is byte-stable
  const snap = () => [read('.gitignore'), read('CLAUDE.md'), read('AGENTS.md'), exclude(), status(g)].join('\0')
  const once = snap()
  spex('materialize')
  assert.equal(snap(), once, 'idempotence: a second materialize changes nothing')
})

test('retired axis: any render/private value is IGNORED with a loud notice — behavior identical, no fail', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex, spexStderr, setLocal } = makeHost()
  const exclude = () => readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8')
  const snap = () => [readFileSync(join(proj, '.gitignore'), 'utf8'), exclude(), status(g)].join('\0')
  spex('materialize')
  const base = snap()
  for (const cfg of ['{"render":"committed"}\n', '{"render":"hidden"}\n', '{"render":"invisible"}\n', '{"private":true}\n']) {
    setLocal(cfg)
    const err = spexStderr('materialize')
    assert.match(err, /retired/i, `${cfg.trim()}: the notice is loud`)
    assert.match(err, /spex guide footprint/, `${cfg.trim()}: the notice points at the manual`)
    assert.equal(snap(), base, `${cfg.trim()}: behavior is unchanged — the field is inert`)
  }
  setLocal(null)
  assert.ok(!/retired/i.test(spexStderr('materialize')), 'removing the field retires the notice')
})

test('legacy .gitignore managed block is forgotten by the next materialize (erase phase) — an honest one-time migration diff', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex } = makeHost()
  // simulate a pre-collapse deployment: the old ignored-mode block sits in the TRACKED .gitignore
  const legacy = 'node_modules/\nartifacts/\n\n\ndist/\n\n# spexcode:start\nCLAUDE.md\n.claude/settings.json\n# spexcode:end\n'
  writeFileSync(join(proj, '.gitignore'), legacy)
  g('add', '.gitignore'); g('commit', '-qm', 'legacy ignored-mode block', '--no-verify')
  spex('materialize')
  const gi = readFileSync(join(proj, '.gitignore'), 'utf8')
  assert.ok(!gi.includes('spexcode:start'), 'the legacy block is stripped from the working .gitignore')
  assert.ok(gi.includes('node_modules/') && gi.includes('\n\n\ndist/'), 'the host rules + blank-line run survive')
  assert.match(status(g), /M \.gitignore/, 'the strip shows as an honest modification (commit it once to finish the migration)')
  assert.ok(readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8').includes('.claude/settings.json'), 'the entries live in exclude now')
})

test('content-filter edges: missing shim degrades to cat; a contract change re-materializes + settles; uninstall leaves no residue', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex, setLocal } = makeHost()
  setLocal('{}\n')                     // a real host overlay file, so the uninstall reveal below is observable
  spex('materialize')
  assert.equal(status(g), '', 'baseline: clean status')

  // edge ①: the shim goes missing → git must NOT spray fatals; the filter degrades to identity
  const shim = join(proj, '.git', 'spexcode', 'contract-filter.sh')
  const shimBytes = readFileSync(shim)
  rmSync(shim)
  const st = execFileSync('git', ['-C', proj, 'status', '--short'], { encoding: 'utf8' })   // throws on a git fatal
  assert.ok(typeof st === 'string', 'edge ①: git status still works with the shim missing')
  writeFileSync(shim, shimBytes)   // restore

  // edge ②: a surface:system edit must reach the working file on re-materialize AND leave status clean
  const sysNode = execFileSync('bash', ['-c', `grep -l '^surface: system' '${join(proj, '.spec')}'/*/.config/*/spec.md | sort | head -1`], { encoding: 'utf8' }).trim()
  assert.ok(sysNode, 'seeded .config has a surface:system node to edit')
  writeFileSync(sysNode, readFileSync(sysNode, 'utf8') + '\nEDGE-TWO-PROPAGATED\n')
  g('add', '.spec'); g('commit', '-qm', 'config edit (data is tracked — committed like any source)', '--no-verify')
  spex('materialize')
  assert.ok(readFileSync(join(proj, 'CLAUDE.md'), 'utf8').includes('EDGE-TWO-PROPAGATED'), 'edge ②: the re-materialize carried the new contract into the working file')
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
  // the user's own spexcode.local.json turns visible (its ignore rule left with the materialize) — the only
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

test('a HOST-TRACKED empty contract file survives the backout (deleteIfEmpty guards on tracked-ness)', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex } = makeHost()
  // the extreme host: a committed EMPTY CLAUDE.md the materialize folded a block into
  writeFileSync(join(proj, 'CLAUDE.md'), '')
  g('add', 'CLAUDE.md'); g('commit', '-qm', 'empty tracked contract file', '--no-verify')
  spex('materialize')
  assert.ok(readFileSync(join(proj, 'CLAUDE.md'), 'utf8').includes('spexcode:start'), 'block folded into the empty tracked file')
  spex('uninstall', '.')
  assert.ok(existsSync(join(proj, 'CLAUDE.md')), 'the tracked file is stripped, never deleted')
  assert.ok(!status(g).includes('D '), `no deletion in status: ${status(g)}`)
})

test('content-filter invariant: a host file that BEGINS with blank lines round-trips byte-exactly', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex } = makeHost()
  const leading = '\n\n# starts blank\nkeep me\n'
  writeFileSync(join(proj, 'CLAUDE.md'), leading)
  g('add', 'CLAUDE.md'); g('commit', '-qm', 'leading-blank host', '--no-verify')
  spex('materialize')
  // clean status PROVES clean(worktree) == index blob byte-for-byte — including the leading blanks
  assert.equal(status(g), '', 'clean status on a leading-blank host file')
  assert.ok(readFileSync(join(proj, 'CLAUDE.md'), 'utf8').startsWith('\n\n# starts blank'), 'leading blanks kept in the working tree')
  spex('uninstall', '.')
  assert.equal(readFileSync(join(proj, 'CLAUDE.md'), 'utf8'), leading, 'uninstall restores the exact bytes (leading blanks survive removeManagedBlock)')
})

// [[residence]] — the contract three-state as a LIVE content fact: wholly-ours stays excluded; the
// moment USER prose enters the file the exclude entry is withdrawn (hiding user content is data-loss
// shaped), the clean filter is pre-armed, and the user's own `git add` — the one tracking act, always
// theirs — stages pristine prose with the block stripped automatically.
test('contract kind transition: user prose entering a wholly-ours CLAUDE.md un-hides it and arms clean for their add', { skip: !gitAvailable() && 'git not available' }, () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-kind-'))
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

  // state 1 — wholly ours: generated, excluded, invisible
  const claude = join(proj, 'CLAUDE.md')
  assert.ok(readFileSync(claude, 'utf8').includes('spexcode:start'), 'init generated the contract file')
  execFileSync('git', ['-C', proj, 'check-ignore', '-q', 'CLAUDE.md'], { env })   // throws (exit 1) if NOT ignored
  assert.ok(!status(g).includes('CLAUDE.md'), 'wholly-ours: hidden from status')

  // state 2 — user prose enters: the next materialize un-hides it and pre-arms clean
  writeFileSync(claude, readFileSync(claude, 'utf8') + '\nMY OWN TEAM NOTES\n')
  spex('materialize')
  assert.throws(() => execFileSync('git', ['-C', proj, 'check-ignore', '-q', 'CLAUDE.md'], { env, stdio: 'ignore' }),
    'user content present: the exclude entry is withdrawn — never hide user prose')
  assert.ok(status(g).includes('?? CLAUDE.md'), 'the file surfaces as honestly untracked — tracking stays the user\'s act')
  assert.match(readFileSync(join(proj, '.git', 'info', 'attributes'), 'utf8'), /\/CLAUDE\.md filter=spexcode/, 'clean is pre-armed')

  // state 3 — THEIR add: clean strips the block; only their prose reaches the index
  g('add', 'CLAUDE.md')
  const staged = g('show', ':CLAUDE.md')
  assert.ok(staged.includes('MY OWN TEAM NOTES'), 'their prose is staged')
  assert.ok(!staged.includes('spexcode:start'), 'the block never reaches the index')
  assert.ok(readFileSync(claude, 'utf8').includes('spexcode:start'), 'the working tree still carries the block')
})

// [[commit-surgery]] — the history anchor repairs the STAGED INDEX and never rejects: a leaked sentinel
// block is cleaned in place from the staged blob (partial staging survives — the source is the blob, not
// the worktree), a HEAD-untracked generated/machine artifact is evicted, and the whole thing honors
// GIT_INDEX_FILE so a pathspec/-a commit's temporary index is the one repaired.
test('commit surgery: strips a leaked block from the staged blob (worktree + partial staging intact), evicts machine/ours artifacts', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env, g, spex } = makeHost()
  spex('materialize')

  // (a) leak: a staged CLAUDE.md blob carrying prose + block (as a -f before the filter existed would)
  const leak = '# team notes\nkeep me — staged edit\n\n<!-- spexcode:start -->\nLEAKED\n<!-- spexcode:end -->\n'
  const sha = execFileSync('git', ['-C', proj, 'hash-object', '-w', '--stdin'], { input: leak, encoding: 'utf8', env }).trim()
  g('update-index', '--cacheinfo', `100644,${sha},CLAUDE.md`)
  // the worktree meanwhile holds a FURTHER unstaged edit (in the prose region — a materialize canonicalizes
  // the block to EOF, so prose position is the stable part) — surgery must not scoop it
  const wtBefore = readFileSync(join(proj, 'CLAUDE.md'), 'utf8').replace('keep me\n', 'keep me\nUNSTAGED EDIT\n')
  writeFileSync(join(proj, 'CLAUDE.md'), wtBefore)
  // (b) a machine fact force-staged
  writeFileSync(join(proj, 'spexcode.local.json'), '{"x":1}\n')
  g('add', '-f', 'spexcode.local.json')
  // (c) a wholly-ours AGENTS.md force-staged... AGENTS.md is tracked in this host, so use a worktrees path
  mkdirSync(join(proj, '.worktrees'), { recursive: true })
  writeFileSync(join(proj, '.worktrees', 'stray.txt'), 'residue\n')
  g('add', '-f', '.worktrees/stray.txt')

  spex('internal', 'commit-surgery')

  const staged = g('show', ':CLAUDE.md')
  assert.equal(staged, '# team notes\nkeep me — staged edit\n', 'the staged blob is cleaned IN PLACE: block gone, staged edit kept')
  assert.equal(readFileSync(join(proj, 'CLAUDE.md'), 'utf8'), wtBefore, 'the worktree (with its unstaged edit) is untouched')
  const stagedList = g('diff', '--cached', '--name-only')
  assert.ok(!stagedList.includes('spexcode.local.json'), 'the machine fact is evicted from the index')
  assert.ok(!stagedList.includes('.worktrees/stray.txt'), 'run residue is evicted from the index')
  assert.ok(existsSync(join(proj, 'spexcode.local.json')), 'eviction never deletes the file on disk')
})

test('commit surgery honors GIT_INDEX_FILE: a temporary index (pathspec/-a commits) is the one repaired', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env, g, spex } = makeHost()
  spex('materialize')
  const tmpIndex = join(proj, '.git', 'tmp-index')
  execFileSync('bash', ['-c', `cp '${join(proj, '.git', 'index')}' '${tmpIndex}'`])
  const leak = 'keep me\n\n<!-- spexcode:start -->\nLEAKED\n<!-- spexcode:end -->\n'
  const sha = execFileSync('git', ['-C', proj, 'hash-object', '-w', '--stdin'], { input: leak, encoding: 'utf8', env }).trim()
  const tmpEnv = { ...env, GIT_INDEX_FILE: tmpIndex }
  execFileSync('git', ['-C', proj, 'update-index', '--cacheinfo', `100644,${sha},CLAUDE.md`], { env: tmpEnv })
  execFileSync(TSX, [CLI, 'internal', 'commit-surgery'], { cwd: proj, encoding: 'utf8', env: tmpEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const tmpStaged = execFileSync('git', ['-C', proj, 'show', ':CLAUDE.md'], { encoding: 'utf8', env: tmpEnv })
  assert.equal(tmpStaged, 'keep me\n', 'the TEMPORARY index was repaired')
  assert.ok(!g('show', ':CLAUDE.md').includes('LEAKED'), 'sanity: the real index never saw the leak')
  rmSync(tmpIndex, { force: true })
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
  spex(wt, 'materialize')                                  // per-worktree materialize (as sessions.ts does at launch)

  assert.ok(existsSync(join(wt, '.codex', 'hooks.json')), 'worktree has a .codex/hooks.json anchor')
  assert.ok(existsSync(join(proj, '.codex', 'hooks.json')), 'main checkout still has the codex shim')
  const cfg = readFileSync(join(codex, 'config.toml'), 'utf8')
  assert.ok(cfg.includes(`[projects."${proj}"]`) && cfg.includes('trust_level = "trusted"'), 'main-checkout project trusted')
  for (const snake of ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop'])
    assert.match(cfg, new RegExp(`hooks.state."[^"]*:${snake}:0:0"\\]\\s*\\ntrusted_hash = "sha256:`), `per-hook trusted_hash for ${snake}`)
})

// [[residence]] — worktree seeding by KIND: tracked data arrives by CHECKOUT (no symlinks, ever),
// materialized artifacts by re-materialize, and the ONE thing git cannot deliver — the machine-local spexcode.local.json —
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

// [[harness-select]] / [[commit-surgery]] — the SELECTION CHAIN, every leg a real adopter rides: the
// persisted spexcode.json `harnesses` set must be honored by init, by a manual materialize, by the
// pre-commit anchor's unconditional materialize, AND by a worktree materialize — never falling back to the
// default full set. And the retired dispatch gate must NOT materialize: a harness event is never a trigger.
const DISPATCH = join(SRC, '..', 'hooks', 'dispatch.sh')

function makeBareRepo(prefix: string) {
  const proj = mkdtempSync(join(tmpdir(), prefix))
  const home = mkdtempSync(join(tmpdir(), 'spex-home-'))
  const codex = mkdtempSync(join(tmpdir(), 'spex-codex-'))
  const env = { ...process.env, SPEXCODE_HOME: home, CODEX_HOME: codex }
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
  const spex = (cwd: string, ...args: string[]) =>
    execFileSync(TSX, [CLI, ...args], { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  // fire ONE harness lifecycle event through the real dispatcher — must NEVER trigger a materialize now.
  const fireEvent = (cwd: string) =>
    execFileSync('bash', [DISPATCH, 'codex', 'SessionStart'], { cwd, encoding: 'utf8', env: { ...env, SPEX: `${TSX} ${CLI}` }, input: '{}' })
  // the content-hash stamp sits in the MATERIALIZED TREE's slot (trees/<enc(tree)>) — here the main checkout's.
  const runtimeHash = () => {
    const projects = join(home, 'projects')
    const enc = readdirSync(projects)[0]
    return readFileSync(join(projects, enc, 'trees', proj.replace(/[/.]/g, '-'), 'content-hash'), 'utf8').trim()
  }
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'README.md'), '# app\n')
  return { proj, env, g, spex, fireEvent, runtimeHash }
}

test('harness selection chain: a codex-only repo NEVER grows .claude — init, manual materialize, the pre-commit anchor, a worktree materialize; a harness event materializes NOTHING', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex, fireEvent, runtimeHash } = makeBareRepo('spex-cxonly-')
  // the adopter declares codex-only BEFORE init (init leaves an existing spexcode.json untouched)
  writeFileSync(join(proj, 'spexcode.json'), '{"harnesses":["codex"],"lint":{"governedRoots":["."]}}\n')
  g('add', '-A'); g('commit', '-qm', 'init')
  const noClaude = (dir: string, leg: string) => {
    assert.ok(!existsSync(join(dir, '.claude')), `${leg}: no .claude dir`)
    assert.ok(!existsSync(join(dir, 'CLAUDE.md')), `${leg}: no CLAUDE.md`)
  }
  // leg 1 — spex init
  spex(proj, 'init', '.')
  noClaude(proj, 'init')
  assert.ok(existsSync(join(proj, '.codex', 'hooks.json')) && readFileSync(join(proj, 'AGENTS.md'), 'utf8').includes('spexcode:start'), 'init: codex delivered')
  // leg 2 — manual spex materialize
  spex(proj, 'materialize')
  noClaude(proj, 'manual materialize')
  // leg 3 — the DE-HARNESSED dispatcher: a .config edit + a harness event must NOT re-materialize
  const cfgNode = execFileSync('bash', ['-c', `ls '${join(proj, '.spec', 'project', '.config')}'/*/spec.md | head -1`], { encoding: 'utf8' }).trim()
  writeFileSync(cfgNode, readFileSync(cfgNode, 'utf8') + '\nGATE-LEG\n')
  const before = runtimeHash()
  fireEvent(proj)
  assert.equal(runtimeHash(), before, 'de-harnessed: a harness event never triggers a materialize (the old gate is retired)')
  // leg 4 — the pre-commit anchor's unconditional materialize picks the edit up instead
  spex(proj, 'internal', 'commit-surgery')
  assert.notEqual(runtimeHash(), before, 'the git-native anchor re-materialized (unconditional materialize)')
  noClaude(proj, 'pre-commit anchor')
  // leg 5 — a worktree materialize (what bootstrapMaterialize runs at session creation)
  g('add', '-A'); g('commit', '-qm', 'adopt', '--no-verify')
  const wt = join(proj, '.worktrees', 'wt')
  g('worktree', 'add', '-q', wt, '-b', 'node/wt')
  spex(wt, 'materialize')
  noClaude(wt, 'worktree materialize')
  assert.ok(existsSync(join(wt, '.codex', 'hooks.json')) && readFileSync(join(wt, 'AGENTS.md'), 'utf8').includes('spexcode:start'), 'worktree: codex delivered')
})

test('harness selection is persistent + self-healing at the git-native anchors: narrowing `harnesses` prunes on the next anchor materialize', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, g, spex } = makeBareRepo('spex-narrow-')
  g('add', '-A'); g('commit', '-qm', 'init')
  spex(proj, 'init', '.')                                     // default set: both natives delivered
  assert.ok(existsSync(join(proj, '.claude', 'settings.json')) && existsSync(join(proj, 'CLAUDE.md')), 'baseline: claude delivered')
  // narrow the PERSISTED selection — a bare config edit, exactly what an adopter does
  const cfg = JSON.parse(readFileSync(join(proj, 'spexcode.json'), 'utf8'))
  cfg.harnesses = ['codex']
  writeFileSync(join(proj, 'spexcode.json'), JSON.stringify(cfg, null, 2))
  spex(proj, 'internal', 'commit-surgery')                    // the pre-commit anchor is the next materialize
  assert.ok(!existsSync(join(proj, '.claude')), 'the anchor materialize pruned .claude entirely (shim, skills, agents, the dir itself)')
  assert.ok(!existsSync(join(proj, 'CLAUDE.md')), 'the wholly-ours untracked CLAUDE.md is gone')
  const excl = readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8')
  assert.ok(!excl.includes('.claude'), 'no .claude entries left in the exclude block')
  assert.ok(existsSync(join(proj, '.codex', 'hooks.json')) && readFileSync(join(proj, 'AGENTS.md'), 'utf8').includes('spexcode:start'), 'codex untouched')
  // idempotence over the harness dimension: a manual materialize changes nothing
  spex(proj, 'materialize')
  assert.ok(!existsSync(join(proj, '.claude')) && !existsSync(join(proj, 'CLAUDE.md')), 'manual re-materialize is byte-stable on the narrowed set')
})

// [[hook-dispatch]] / [[runtime]] — per-tree materialize slots: the manifest (+ content-hash + ledger) is a pure
// function of ONE tree's .config, so each tree materializes into its own trees/<enc(toplevel)> slot. The old
// single global file was last-writer-wins across worktrees — tree A's materialize silently replaced the hook set
// tree B's sessions dispatched (cross-tree hook bleed).
test('per-tree materialize slots: a divergent worktree materializes into its own slot; another tree\'s later materialize never rewrites it', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, env, g, spex } = makeBareRepo('spex-slots-')
  g('add', '-A'); g('commit', '-qm', 'init')
  spex(proj, 'init', '.')
  g('add', '-A'); g('commit', '-qm', 'adopt', '--no-verify')
  // worktree with a DIVERGENT .config: one extra surface:hook node bound to SessionStart
  const wt = join(proj, '.worktrees', 'wt')
  g('worktree', 'add', '-q', wt, '-b', 'node/wt')
  const probe = join(wt, '.spec', 'project', '.config', 'probe')
  mkdirSync(probe, { recursive: true })
  writeFileSync(join(probe, 'spec.md'), '---\ntitle: probe\nsurface: hook\nstatus: active\nevents:\n- SessionStart\norder: 10\nblock: false\n---\nmarker\n')
  writeFileSync(join(probe, 'probe.sh'), '#!/usr/bin/env bash\necho PROBE\n')
  spex(wt, 'materialize')
  const slotOf = (tree: string) => {
    const projects = join(env.SPEXCODE_HOME, 'projects')
    return join(projects, readdirSync(projects)[0], 'trees', tree.replace(/[/.]/g, '-'))
  }
  const wtManifest = readFileSync(join(slotOf(wt), 'hooks-manifest'), 'utf8')
  assert.ok(wtManifest.includes('probe.sh'), "the worktree's slot compiled the worktree's own .config")
  const mainManifest = readFileSync(join(slotOf(proj), 'hooks-manifest'), 'utf8')
  assert.ok(!mainManifest.includes('probe.sh'), "main's slot (from init) never saw the worktree-only node")
  // the OTHER tree materializes LAST — under the old single slot this was the clobber
  spex(proj, 'materialize')
  assert.equal(readFileSync(join(slotOf(wt), 'hooks-manifest'), 'utf8'), wtManifest,
    "main's later materialize lands in main's slot and leaves the worktree's manifest untouched")
  assert.ok(existsSync(join(slotOf(wt), 'content-hash')) && existsSync(join(slotOf(proj), 'content-hash')),
    'each tree carries its own content-hash stamp')
})
