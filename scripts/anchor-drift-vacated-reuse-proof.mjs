import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const productRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(productRoot, 'spec-cli/bin/spex.mjs')
const hostNodeModules = dirname(dirname(dirname(createRequire(import.meta.url).resolve('typescript'))))
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const write = (root, path, content) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}
const commit = (root, message) => { git(root, 'add', '-A'); git(root, 'commit', '-qm', message); return git(root, 'rev-parse', 'HEAD') }
const baseRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-vacated-reuse-proof-'))
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.email', 'proof@example.com'); git(root, 'config', 'user.name', 'proof')
  symlinkSync(hostNodeModules, join(root, 'node_modules'), 'dir')
  return root
}
const source = (value, marker) => `export function f() { return ${value} }\n// ${marker}\n${'// stable\n'.repeat(12)}`
const historySpec = marker => `---\ntitle: ${marker}\n---\n# ${marker}\n\n${'stable\n'.repeat(20)}${marker}\n`
const productSpec = path => `---\ntitle: fixture\nstatus: active\ncode:\n  - ${path}#f\n---\n# fixture\n`
const productEval = path => `---\nscenarios:\n  - name: fixture-scenario\n    code: [${path}#f]\n    description: lineage reuse\n    expected: old events stay on the old lineage\n---\nfixture\n`
const runLint = (root, home, ...args) => spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '' },
})
const outputOf = result => `${result.stdout ?? ''}\n${result.stderr ?? ''}`

async function vacatedReuse() {
  const root = baseRepo()
  try {
    write(root, '.spec/project/fixture/spec.md', productSpec('src/a.ts'))
    write(root, '.spec/project/fixture/eval.md', productEval('src/a.ts'))
    write(root, '.spec/lineage/a/spec.md', historySpec('base-a'))
    write(root, 'src/a.ts', source(0, 'base-a'))
    const base = commit(root, 'base')

    write(root, '.spec/project/fixture/spec.md', productSpec('src/a.ts'))
    write(root, 'src/a.ts', source(1, 'old edit'))
    const oldEdit = commit(root, 'old lineage edit')

    git(root, 'mv', 'src/a.ts', 'src/b.ts'); mkdirSync(join(root, '.spec/lineage/b'), { recursive: true })
    git(root, 'mv', '.spec/lineage/a/spec.md', '.spec/lineage/b/spec.md')
    write(root, '.spec/project/fixture/spec.md', productSpec('src/b.ts'))
    write(root, '.spec/project/fixture/eval.md', productEval('src/b.ts'))
    write(root, '.spec/lineage/b/spec.md', historySpec('rename-b')); write(root, 'src/b.ts', source(2, 'rename-b'))
    const toB = commit(root, 'rename a to b')

    write(root, 'src/a.ts', source(10, 'new a')); write(root, '.spec/lineage/a/spec.md', historySpec('new-a'))
    const recreateA = commit(root, 'recreate a')

    git(root, 'mv', 'src/a.ts', 'src/c.ts'); mkdirSync(join(root, '.spec/lineage/c'), { recursive: true })
    git(root, 'mv', '.spec/lineage/a/spec.md', '.spec/lineage/c/spec.md')
    write(root, '.spec/project/fixture/spec.md', productSpec('src/c.ts'))
    write(root, '.spec/project/fixture/eval.md', productEval('src/c.ts'))
    write(root, '.spec/lineage/c/spec.md', historySpec('rename-c')); write(root, 'src/c.ts', source(11, 'rename-c'))
    const toC = commit(root, 'rename a to c')

    const { historyIndex, rowsFor, driftIndex, pathRangeEvents } = await import('../spec-cli/src/git.ts')
    const { anchorHitCommits, extractors } = await import('../spec-cli/src/anchors.ts')
    const { codeDrift } = await import('../spec-eval/src/freshness.ts')
    const { projectSessionImpact } = await import('../spec-eval/src/sessioneval.ts')
    const hidx = await historyIndex(root), didx = await driftIndex(root)
    const rows = rowsFor(hidx, '.spec/lineage/c/spec.md').map(row => row.hash)
    const events = pathRangeEvents(didx, base, 'src/c.ts') ?? []
    const hits = await anchorHitCommits(root, events, ['f'], extractors(root))
    const freshness = codeDrift(didx, base, ['src/c.ts#f'])
    const impact = await projectSessionImpact(root, { base, head: toC })
    const scenario = impact.nodes.flatMap(node => node.scenarios).find(item => item.name === 'fixture-scenario')
    assert.deepEqual(rows, [toC, recreateA], 'history must stop at the reused path lineage epoch')
    assert.ok(!events.some(event => event.commit === oldEdit), 'drift lineage must exclude the old path edit')
    assert.ok(!hits.some(hit => hit.commit === oldEdit), 'anchor projection must exclude the old path edit')
    assert.deepEqual(freshness, [{ file: 'src/c.ts', behind: 2 }], 'freshness must count only the current lineage')
    assert.ok(scenario, 'session impact must include the fixture scenario')
    const headHits = scenario.selectorHits.filter(hit => hit.path === 'src/c.ts')
    const baseHits = scenario.selectorHits.filter(hit => hit.path === 'src/a.ts')
    assert.ok(!headHits.some(hit => hit.commit === oldEdit), 'session head projection must exclude oldEdit')
    assert.ok(baseHits.some(hit => hit.commit === oldEdit), 'session base projection must retain oldEdit')
    return { base, oldEdit, toB, recreateA, toC, rows, events: events.map(event => ({ commit: event.commit, path: event.historicalPath })), hits, freshness, sessionHeadHits: headHits, sessionBaseHits: baseHits }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function lintAck() {
  const root = baseRepo(), home = mkdtempSync(join(tmpdir(), 'spex-vacated-lint-home-'))
  try {
    write(root, '.spec/project/fixture/spec.md', productSpec('src/a.ts'))
    write(root, 'src/a.ts', source(0, 'base'))
    commit(root, 'lint base')
    write(root, 'src/a.ts', source(1, 'anchored hit'))
    const hit = commit(root, 'anchored hit')
    const blocked = runLint(root, home, 'spec', 'lint')
    assert.notEqual(blocked.status, 0, 'real spec lint must block the anchored hit')
    assert.match(outputOf(blocked), /anchor-drift/, 'blocking lint must name anchor-drift')
    const ack = runLint(root, home, 'spec', 'ack', 'fixture', '--reason', 'verified anchored hit')
    assert.equal(ack.status, 0, outputOf(ack))
    const clear = runLint(root, home, 'spec', 'lint')
    assert.equal(clear.status, 0, outputOf(clear))
    assert.doesNotMatch(outputOf(clear), /anchor-drift/, 'ack must clear the same finding')
    return { hit, blockedStatus: blocked.status, ackStatus: ack.status, clearStatus: clear.status }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) }
}

const [lineage, lint] = await Promise.all([vacatedReuse(), lintAck()])
console.log(JSON.stringify({ candidate: git(productRoot, 'rev-parse', 'HEAD'), lineage, lint }, null, 2))
