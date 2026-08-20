import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReviewAcceptance } from './review-acceptance.js'

const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function commit(cwd: string, message: string): string {
  g(cwd, 'add', '.')
  g(cwd, 'commit', '-qm', message)
  return g(cwd, 'rev-parse', 'HEAD')
}

test('review acceptance compares repeated unions, signs cached provenance, and expires evidenced flaky exemptions', { timeout: 60_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-review-acceptance-'))
  const root = join(fixture, 'repo')
  const home = join(fixture, 'home')
  const previousCwd = process.cwd()
  const previousHome = process.env.SPEXCODE_HOME
  try {
    g(fixture, 'init', '-q', '-b', 'main', root)
    g(root, 'config', 'user.email', 'review@example.test')
    g(root, 'config', 'user.name', 'Review Fixture')
    writeFileSync(join(root, 'behavior.txt'), 'base\n')
    writeFileSync(join(root, 'suite.mjs'), `
import { readFileSync } from 'node:fs'
const mode = readFileSync(new URL('./behavior.txt', import.meta.url), 'utf8').trim()
const candidate = mode !== 'base'
console.log('TAP version 13')
console.log('not ok 1 - baseline noise')
console.log(candidate ? 'not ok 2 - candidate regression' : 'ok 2 - candidate regression')
console.log(candidate ? 'not ok 3 - known unstable' : 'ok 3 - known unstable')
console.log('1..3')
process.exitCode = 1
`)
    const evidenceSha = commit(root, 'seed evidence commit')
    writeFileSync(join(root, 'spexcode.json'), `${JSON.stringify({
      mainBranch: 'main',
      review: {
        runs: 2,
        suites: [{ id: 'probe', command: 'node suite.mjs', format: 'tap' }],
        flaky: [{
          test: 'probe::known unstable',
          observations: [
            { sha: evidenceSha, observedAt: '2026-08-20T00:00:00.000Z', outcome: 'pass', source: 'fixture pass log' },
            { sha: evidenceSha, observedAt: '2026-08-20T00:01:00.000Z', outcome: 'fail', source: 'fixture fail log' },
          ],
          expiresAfterDays: 30,
          expiresAfterBaselineCollections: 10,
        }],
      },
    }, null, 2)}\n`)
    commit(root, 'configure review')
    const worker = join(fixture, 'worker')
    g(root, 'worktree', 'add', '-q', '-b', 'node/review-probe', worker)
    writeFileSync(join(worker, 'behavior.txt'), 'candidate\n')
    commit(worker, 'introduce candidate failures')

    process.env.SPEXCODE_HOME = home
    process.chdir(worker)
    const first = await runReviewAcceptance({ now: new Date('2026-08-20T01:00:00.000Z') })
    assert.equal(first.ok, false)
    assert.equal(first.baselineCached, false)
    assert.equal(first.candidateRuns, 2)
    assert.equal(first.baseRuns, 2)
    assert.deepEqual(first.candidateOnly, ['probe::candidate regression', 'probe::known unstable'])
    assert.deepEqual(first.exempted, ['probe::known unstable'])
    assert.match(first.report, /main [0-9a-f]{40} — 2 run\(s\), freshly collected at/)
    assert.match(first.report, /APPLIED probe::known unstable .*pass@.*fail@/)
    assert.match(first.report, /attributable failures after exemptions \(1\): probe::candidate regression/)

    const projectStores = readdirSync(join(home, 'projects'))
    assert.equal(projectStores.length, 1)
    const acceptance = join(home, 'projects', projectStores[0], 'review-acceptance')
    const baselinePath = join(acceptance, 'baselines', readdirSync(join(acceptance, 'baselines'))[0])
    const oneRun = JSON.parse(readFileSync(baselinePath, 'utf8'))
    oneRun.runs = oneRun.runs.slice(0, 1)
    writeFileSync(baselinePath, `${JSON.stringify(oneRun, null, 2)}\n`)

    writeFileSync(join(worker, 'behavior.txt'), 'flaky-only\n')
    writeFileSync(join(worker, 'suite.mjs'), readFileSync(join(worker, 'suite.mjs'), 'utf8').replace("const candidate = mode !== 'base'", "const candidate = mode === 'candidate'\nconst flaky = mode !== 'base'").replace("candidate ? 'not ok 3", "flaky ? 'not ok 3"))
    commit(worker, 'keep only known instability')
    const cached = await runReviewAcceptance({ now: new Date('2026-08-20T01:05:00.000Z') })
    assert.equal(cached.ok, true)
    assert.equal(cached.baselineCached, true)
    assert.equal(cached.baseRuns, 1)
    assert.match(cached.report, /main [0-9a-f]{40} — 1 run\(s\), CACHED at .*LOW CONFIDENCE: one run only/)
    assert.match(cached.report, /candidate .* — 2 run\(s\), freshly collected/)

    appendFileSync(oneRun.runs[0].logPath, 'tampered\n')
    const recollected = await runReviewAcceptance({ now: new Date('2026-08-20T01:06:00.000Z') })
    assert.equal(recollected.ok, true)
    assert.equal(recollected.baselineCached, false, 'a hash-mismatched raw log invalidates the cache entry')
    assert.equal(recollected.baseRuns, 2)

    const expired = await runReviewAcceptance({ now: new Date('2026-09-20T01:05:00.000Z') })
    assert.equal(expired.ok, false)
    assert.equal(expired.baselineCached, true)
    assert.match(expired.report, /NOT APPLIED probe::known unstable — expired by age/)
    assert.match(expired.report, /attributable failures after exemptions \(1\): probe::known unstable/)

    const collectionLedger = join(acceptance, 'baseline-collections.ndjson')
    const collected = readFileSync(collectionLedger, 'utf8').trim().split('\n').length
    for (let index = 0; index < 10 - collected; index++) appendFileSync(collectionLedger, `${JSON.stringify({ sha: evidenceSha, collectedAt: `2026-08-${String(21 + index).padStart(2, '0')}T00:00:00.000Z`, runs: 2, flips: [] })}\n`)
    const expiredByCollections = await runReviewAcceptance({ now: new Date('2026-08-30T01:05:00.000Z') })
    assert.equal(expiredByCollections.ok, false)
    assert.match(expiredByCollections.report, /expired after 10 later baseline collection\(s\) without another flip/)

    appendFileSync(collectionLedger, `${JSON.stringify({ sha: evidenceSha, collectedAt: '2026-08-30T02:00:00.000Z', runs: 2, flips: ['probe::known unstable'] })}\n`)
    for (let index = 0; index < 9; index++) appendFileSync(collectionLedger, `${JSON.stringify({ sha: evidenceSha, collectedAt: `2026-09-${String(1 + index).padStart(2, '0')}T00:00:00.000Z`, runs: 2, flips: [] })}\n`)
    const renewed = await runReviewAcceptance({ now: new Date('2026-09-09T01:05:00.000Z') })
    assert.equal(renewed.ok, true, 'a later baseline flip renews both expiry clocks')
    assert.match(renewed.report, /renewed by baseline flip@/)
    appendFileSync(collectionLedger, `${JSON.stringify({ sha: evidenceSha, collectedAt: '2026-09-10T00:00:00.000Z', runs: 2, flips: [] })}\n`)
    const reexpired = await runReviewAcceptance({ now: new Date('2026-09-10T01:05:00.000Z') })
    assert.equal(reexpired.ok, false)
    assert.match(reexpired.report, /expired after 10 later baseline collection\(s\) without another flip/)

    assert.ok(readdirSync(join(acceptance, 'baselines')).length > 0)
    assert.ok(readdirSync(join(acceptance, 'logs')).length > 0)
    assert.equal(g(worker, 'status', '--porcelain'), '', 'raw acceptance evidence stays outside the product worktree')
  } finally {
    process.chdir(previousCwd)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('only merge declarations invoke the acceptance gate', () => {
  const source = readFileSync(new URL('./session-declarations.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(proposal === 'merge'\) \{[\s\S]*runReviewAcceptance/)
  const afterMerge = source.split("if (proposal === 'merge') {")[1]
  assert.ok(afterMerge)
  assert.match(afterMerge, /if \(proposal === 'close'\)/)
  assert.doesNotMatch(source.split("if \(verb === 'park'\)")[1] ?? '', /runReviewAcceptance/)
  assert.doesNotMatch(source.split('const asked =')[1] ?? '', /runReviewAcceptance/)
})
