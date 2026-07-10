import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
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

const YATSU = '.spec/n/yatsu.md'
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

test('scenario axis: test/code/related retunes are metadata too — no change-commit', async () => {
  const dir = repo()
  writeFileSync(join(dir, 'a.ts'), 'export {}\n')
  writeFileSync(join(dir, 'b.ts'), 'export {}\n')
  const c1 = commitYatsu(dir, V1, 'add scenario')
  commitYatsu(dir, scenario('    tags: [cli]\n    description: check the thing\n    expected: it works\n    test: a.ts\n    code: [a.ts]\n    related: [b.ts]\n'), 'retune coverage')
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
