import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scenarioIndex, scenarioChangeCommits, scenarioBlocksAt } from './scenariofresh.js'

// The scenario axis is SEMANTIC: only a scenario's measurement contract (description + expected) stales its
// readings. Routing/coverage metadata — tags, test, code, related — is outside the projection, so a
// schema-clean tags sweep across a whole tree records NO scenario change (the false-stale wave this pins).
// Proven against a real scratch git history through BOTH freshness paths: the in-history change-commit index
// (scenarioIndex) and the off-history content probe (scenarioBlocksAt, what scenarioDiffers compares).

function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim()
}

const YATSU = '.spec/n/eval.md'
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scenariofresh-test-'))
  sh(dir, 'git', ['init', '-q', '-b', 'main'])
  sh(dir, 'git', ['config', 'user.email', 't@t'])
  sh(dir, 'git', ['config', 'user.name', 't'])
  mkdirSync(join(dir, '.spec/n'), { recursive: true })
  return dir
}
function commitYatsu(dir: string, body: string, msg: string): string {
  writeFileSync(join(dir, YATSU), body)
  sh(dir, 'git', ['add', '-A'])
  sh(dir, 'git', ['commit', '-q', '-m', msg])
  return sh(dir, 'git', ['rev-parse', 'HEAD'])
}
const scenario = (fields: string) => `---\nscenarios:\n  - name: s\n${fields}---\nbody\n`
const V1 = scenario('    tags: [cli]\n    description: check the thing\n    expected: it works\n')

test('scenario axis: a tags-only edit records NO change-commit; an expected edit does', async () => {
  const dir = repo()
  const c1 = commitYatsu(dir, V1, 'add scenario')
  commitYatsu(dir, scenario('    tags: [cli, backend-api]\n    description: check the thing\n    expected: it works\n'), 'tags sweep')
  assert.deepEqual(scenarioChangeCommits(await scenarioIndex(dir, [YATSU]), YATSU, 's'), [c1],
    'the tags-only commit must not enter the change list — only the scenario\'s birth commit')
  const c3 = commitYatsu(dir, scenario('    tags: [cli, backend-api]\n    description: check the thing\n    expected: it works twice\n'), 'tighten expected')
  assert.deepEqual(scenarioChangeCommits(await scenarioIndex(dir, [YATSU]), YATSU, 's'), [c3, c1],
    'the expected edit is a semantic change and must register')
})

test('scenario axis: scalar→case-specific test/code/related retunes are metadata too — no change-commit', async () => {
  const dir = repo()
  writeFileSync(join(dir, 'a.ts'), 'export {}\n')
  writeFileSync(join(dir, 'b.ts'), 'export {}\n')
  const c1 = commitYatsu(dir, scenario('    tags: [cli]\n    description: check the thing\n    expected: it works\n    test: a.ts\n'), 'add scenario with scalar test')
  commitYatsu(dir, scenario('    tags: [cli]\n    description: check the thing\n    expected: it works\n    test: { path: a.ts, name: one concrete case }\n    code: [a.ts]\n    related: [b.ts]\n'), 'retune coverage')
  assert.deepEqual(scenarioChangeCommits(await scenarioIndex(dir, [YATSU]), YATSU, 's'), [c1])
})

test('off-history probe reads the same projection: blocks equal across a tags-only edit, differ on expected', async () => {
  const dir = repo()
  const c1 = commitYatsu(dir, V1, 'add scenario')
  const c2 = commitYatsu(dir, scenario('    tags: [cli, desktop]\n    description: check the thing\n    expected: it works\n'), 'tags sweep')
  const c3 = commitYatsu(dir, scenario('    tags: [cli, desktop]\n    description: check the thing\n    expected: it works twice\n'), 'tighten expected')
  const at = (rev: string) => scenarioBlocksAt(dir, rev, YATSU)!.get('s')
  assert.equal(at(c1), at(c2), 'tags-only: scenarioDiffers\'s comparison must see identical blocks')
  assert.notEqual(at(c2), at(c3), 'expected edit: the blocks must differ')
})

test('off-history probe memoizes per (sha, path): a repeat query forks no git (spexcode#39)', async () => {
  const dir = repo()
  const c1 = commitYatsu(dir, V1, 'add scenario')
  const first = scenarioBlocksAt(dir, c1, YATSU)
  assert.ok(first, 'first query resolves through git')
  // a full sha names an immutable object, so the memo may answer without git at all — prove it by
  // making the repo unreadable: a repeat query must still answer from the memo, never re-fork.
  renameSync(join(dir, '.git'), join(dir, '.git-gone'))
  assert.equal(scenarioBlocksAt(dir, c1, YATSU), first, 'repeat (sha, path) query answers from the memo — no git child')
  assert.equal(scenarioBlocksAt(dir, 'HEAD', YATSU), null, 'a symbolic rev is never cached — it resolves live (and here fails loudly)')
})

// @@@ archive-pathspec regression — the yatsu.md→eval.md migration must not false-stale history
// ([[eval-core]] rename-chain-survives-archive-pathspec). The whole-history walk reads IMMUTABLE commits,
// and pre-rename commits touched files literally named yatsu.md — an archive answers only to its archive
// name. A single live-name '*eval.md' pathspec truncates every chain at the rename commit; the earliest
// visible version then diffs against EMPTY, so the pure rename itself registers as every scenario's
// "birth" — a change-commit NEWER than any pre-rename reading's codeSha → the whole corpus false-stales.
// The dual pathspec ('*eval.md' '*yatsu.md') keeps the chain whole: pre-rename change-commits survive,
// the R100 rename (byte-identical blob) records no change, and a pre-rename reading stays FRESH.
test('archive pathspec: a yatsu.md→eval.md rename keeps the change-commit chain whole — pre-rename readings stay fresh', async () => {
  const dir = repo()
  const OLD = '.spec/n/yatsu.md'
  // history under the ARCHIVED name: birth, then a semantic edit — two real change-commits for 's'
  writeFileSync(join(dir, OLD), V1)
  sh(dir, 'git', ['add', '-A']); sh(dir, 'git', ['commit', '-q', '-m', 'add scenario (archived name)'])
  const c1 = sh(dir, 'git', ['rev-parse', 'HEAD'])
  writeFileSync(join(dir, OLD), scenario('    tags: [cli]\n    description: check the thing\n    expected: it works twice\n'))
  sh(dir, 'git', ['add', '-A']); sh(dir, 'git', ['commit', '-q', '-m', 'tighten expected (archived name)'])
  const c2 = sh(dir, 'git', ['rev-parse', 'HEAD'])
  // a reading was filed here (codeSha = c2) — the state the migration must not orphan
  // the migration: a PURE rename to the live name, then unrelated churn on top
  sh(dir, 'git', ['mv', OLD, YATSU])
  sh(dir, 'git', ['commit', '-q', '-m', 'migrate: yatsu.md -> eval.md'])
  const cRename = sh(dir, 'git', ['rev-parse', 'HEAD'])
  writeFileSync(join(dir, 'other.ts'), 'export {}\n')
  sh(dir, 'git', ['add', '-A']); sh(dir, 'git', ['commit', '-q', '-m', 'unrelated'])

  const commits = scenarioChangeCommits(await scenarioIndex(dir, [YATSU]), YATSU, 's')
  assert.deepEqual(commits, [c2, c1],
    'the chain must survive the rename: both ARCHIVED-name change-commits register, newest first')
  assert.ok(!commits.includes(cRename),
    'the pure R100 rename is byte-identical — it must record NO scenario change')
  // the freshness verdict the chain feeds: every change-commit is an ancestor of the reading's codeSha
  // (c2), so the scenario axis reads FRESH — the exact reachability scenarioMoved tests. With a truncated
  // chain the rename commit becomes a change-commit that is NOT an ancestor of c2 → false stale.
  const isAncestor = (a: string, b: string) => { try { sh(dir, 'git', ['merge-base', '--is-ancestor', a, b]); return true } catch { return false } }
  assert.ok(commits.every((h) => isAncestor(h, c2)),
    'every recorded change-commit predates the reading — a pre-rename reading reads fresh, never false-staled by the migration')
})
