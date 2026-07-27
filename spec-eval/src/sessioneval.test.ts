import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  completeExportNodeIds,
  declaredLatest,
  nodeScore,
  projectSessionImpact,
  renderExportHtml,
  scopedScenarioReadings,
  sessionEvalSummary,
  sessionEvalContentRevision,
  SessionEvalProjectionCache,
  SessionImpactUnavailableError,
  type ExportModel,
  type SessionEvalNode,
} from './sessioneval.js'
import type { EvalTimeline, EvalEntry } from './evaltab.js'

// a reading with sensible defaults; override per case (mirrors show.test.ts).
function reading(over: Partial<EvalEntry>): EvalEntry {
  return {
    scenario: 's', expected: '', codeSha: 'abcdef0123456789', blob: null, evaluator: 'manual@1',
    ts: '2026-06-22T00:00:00.000Z', fresh: true, staleAxes: [], blobState: 'none', ...over,
  }
}
const timeline = (readings: EvalEntry[], over: Partial<EvalTimeline> = {}): EvalTimeline =>
  ({ node: 'n', hasEvalFile: true, scenarios: [], retractions: [], dangling: [], readings, ...over })

// ---- declaredLatest: the proof scores DECLARED scenarios, never residual sidecar readings ----
// The bug this pins: a scenario removed from eval.md leaves its old reading in the append-only
// evals.ndjson. The proof used to score every reading that EXISTED (latestPerScenario over the raw
// sidecar), so a retired reading became a phantom card + skewed the passed/total ribbon + dragged the node
// score — while the dashboard (score.jsx scenarioStates, driven by the DECLARED set) never showed it. Now the
// proof reads the same declared-bounded latest-per-scenario as every other eval face, so the two agree.

test('declaredLatest: a retired scenario’s residual reading is dropped; the declared one survives', () => {
  const tl = timeline(
    [
      reading({ scenario: 'alive', verdict: { status: 'pass' }, fresh: true }),
      reading({ scenario: 'retired', verdict: { status: 'pass' }, fresh: false, staleAxes: ['scenario'] }),
    ],
    { scenarios: [{ name: 'alive', expected: 'stays green' }] },
  )
  const latest = declaredLatest(tl)
  assert.deepEqual(latest.map((r) => r.scenario), ['alive'])   // retired never flows into readings/ribbon
})

test('declaredLatest vs the raw latest: the fix is exactly the declared-set filter', () => {
  const tl = timeline(
    [
      reading({ scenario: 'alive', verdict: { status: 'pass' }, fresh: true }),
      reading({ scenario: 'retired', verdict: { status: 'pass' }, fresh: false, staleAxes: ['scenario'] }),
    ],
    { scenarios: [{ name: 'alive', expected: 'x' }] },
  )
  const latest = declaredLatest(tl)
  // node score + ribbon (passed/total) mirror the dashboard: one declared scenario, fresh-passing → green 1/1.
  assert.equal(nodeScore(tl.hasEvalFile, latest), 'pass')
  assert.equal(latest.length, 1)                                             // total = 1 (not 2)
  assert.equal(latest.filter((r) => r.fresh && r.verdict?.status === 'pass').length, 1)   // passed = 1

  // the BUG the fix closes: scoring the raw readings (what the proof did before) would keep the retired,
  // stale reading — a phantom card, a 1/2 ribbon, and a grey stalePass node — none of which the dashboard shows.
  assert.equal(nodeScore(tl.hasEvalFile, tl.readings), 'stalePass')
  assert.equal(tl.readings.length, 2)
})

test('declaredLatest: newest reading per DECLARED scenario wins (history is not double-counted)', () => {
  const tl = timeline(
    [
      reading({ scenario: 'alive', ts: '2026-07-02', verdict: { status: 'pass' }, fresh: true }),
      reading({ scenario: 'alive', ts: '2026-07-01', verdict: { status: 'fail' }, fresh: true }),
    ],
    { scenarios: [{ name: 'alive', expected: 'x' }] },
  )
  const latest = declaredLatest(tl)
  assert.equal(latest.length, 1)
  assert.equal(latest[0].ts, '2026-07-02')          // first-seen (newest) wins
  assert.equal(nodeScore(tl.hasEvalFile, latest), 'pass')
})

test('declaredLatest: a node with no declared scenarios scores nothing, even with residual readings', () => {
  const tl = timeline(
    [reading({ scenario: 'gone', verdict: { status: 'pass' }, fresh: true })],
    { scenarios: [] },
  )
  assert.deepEqual(declaredLatest(tl), [])
})

test('public exact-revision impact projection is selector-aware, delta-complete, and loud', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-session-impact-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const evalPath = join(root, '.spec/project/n/eval.md')
  const declarations = (over: {
    semanticExpected?: string
    metadataTags?: string
    metadataTest?: string
    metadataCode?: string
    renamed?: boolean
    betaSelector?: string
    dropRemoved?: boolean
  } = {}) => `---
scenarios:
  - name: alpha-scenario
    tags: [backend-api]
    code: [src/shared.py#alpha]
    description: measure alpha
    expected: alpha stays exact
  - name: beta-scenario
    tags: [backend-api]
    code: [src/shared.py#${over.betaSelector ?? 'beta'}]
    description: measure beta
    expected: beta stays exact
  - name: semantic-scenario
    tags: [backend-api]
    description: semantic contract
    expected: ${over.semanticExpected ?? 'semantic v1'}
  - name: metadata-scenario
    tags: [${over.metadataTags ?? 'backend-api'}]
    test: ${over.metadataTest ?? 'tests/a.txt'}
    code: [${over.metadataCode ?? 'src/shared.py#beta'}]
    description: metadata contract
    expected: metadata hash stays exact
  - name: ${over.renamed ? 'new-name' : 'old-name'}
    tags: [backend-api]
    description: rename contract
    expected: rename is remove plus add
  - name: inherited-scenario
    tags: [backend-api]
    description: inherit node selector
    expected: inherited alpha moves only with alpha
${over.dropRemoved ? '' : `  - name: removed-selector
    tags: [backend-api]
    code: [src/shared.py#obsolete]
    description: removable selector contract
    expected: removal validates against base
`}
---
impact fixture
`
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'eval@example.test')
    git('config', 'user.name', 'Eval Test')
    mkdirSync(join(root, '.spec/project/n'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'docs'), { recursive: true })
    mkdirSync(join(root, 'tests'), { recursive: true })
    writeFileSync(join(root, '.spec/project/spec.md'), '---\ntitle: project\n---\n# project\n')
    writeFileSync(join(root, '.spec/project/n/spec.md'), [
      '---', 'title: n', 'code:', '  - src/shared.py#alpha', 'related:', '  - docs/context.md', '---', '# n', '',
    ].join('\n'))
    writeFileSync(evalPath, declarations())
    writeFileSync(join(root, 'src/shared.py'), 'def alpha():\n    return 1\n\ndef beta():\n    return 1\n\ndef obsolete():\n    return 1\n')
    writeFileSync(join(root, 'docs/context.md'), 'context v1\n')
    writeFileSync(join(root, 'tests/a.txt'), 'a\n')
    writeFileSync(join(root, 'tests/b.txt'), 'b\n')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    const base = git('rev-parse', 'HEAD')

    writeFileSync(join(root, 'src/shared.py'), 'def alpha():\n    return 1\n\ndef beta():\n    return 2\n\ndef obsolete():\n    return 1\n')
    git('add', '.')
    git('commit', '-q', '-m', 'change beta')
    const betaHead = git('rev-parse', 'HEAD')
    const betaProjection = await projectSessionImpact(root, { base, head: betaHead })
    assert.equal(betaProjection.base, base)
    assert.equal(betaProjection.head, betaHead)
    assert.match(betaProjection.revision, /^[0-9a-f]{64}$/)
    const betaNode = betaProjection.nodes.find((node) => node.id === 'n')!
    const betaScenario = betaNode.scenarios.find((item) => item.name === 'beta-scenario')!
    assert.deepEqual(betaScenario.impact, ['code'])
    assert.deepEqual(betaScenario.selectorHits.flatMap((hit) => hit.selectors), ['beta'])
    assert.deepEqual(betaNode.scenarios.find((item) => item.name === 'alpha-scenario')!.impact, [])
    assert.deepEqual(betaNode.scenarios.find((item) => item.name === 'inherited-scenario')!.impact, [])

    writeFileSync(join(root, 'src/shared.py'), 'def alpha():\n    return 2\n\ndef beta():\n    return 2\n\ndef obsolete():\n    return 1\n')
    git('add', '.')
    git('commit', '-q', '-m', 'change alpha')
    const alphaHead = git('rev-parse', 'HEAD')
    const alphaProjection = await projectSessionImpact(root, { base: betaHead, head: alphaHead })
    const alphaNode = alphaProjection.nodes.find((node) => node.id === 'n')!
    assert.deepEqual(alphaNode.scenarios.find((item) => item.name === 'alpha-scenario')!.impact, ['code'])
    assert.deepEqual(alphaNode.scenarios.find((item) => item.name === 'inherited-scenario')!.impact, ['code'])
    assert.deepEqual(alphaNode.scenarios.find((item) => item.name === 'beta-scenario')!.impact, [])

    writeFileSync(evalPath, declarations({
      semanticExpected: 'semantic v2',
      metadataTags: 'cli',
      metadataTest: 'tests/b.txt',
      metadataCode: 'src/shared.py#alpha',
      renamed: true,
    }))
    writeFileSync(join(root, 'docs/context.md'), 'context v2\n')
    git('add', '.')
    git('commit', '-q', '-m', 'change contracts and review context')
    const contractHead = git('rev-parse', 'HEAD')
    const contractProjection = await projectSessionImpact(root, { base: alphaHead, head: contractHead })
    const contractNode = contractProjection.nodes.find((node) => node.id === 'n')!
    const semantic = contractNode.scenarios.find((item) => item.name === 'semantic-scenario')!
    assert.equal(semantic.delta.semantic, true)
    assert.notEqual(semantic.baseScenarioHash, semantic.headScenarioHash)
    assert.deepEqual(semantic.impact, ['contract'])
    const metadata = contractNode.scenarios.find((item) => item.name === 'metadata-scenario')!
    assert.deepEqual(metadata.delta, { kind: 'modified', semantic: false, metadata: true, metadataOnly: true })
    assert.equal(metadata.baseScenarioHash, metadata.headScenarioHash)
    assert.deepEqual(metadata.impact, [])
    assert.equal(contractNode.scenarios.find((item) => item.name === 'old-name')!.delta.kind, 'removed')
    assert.equal(contractNode.scenarios.find((item) => item.name === 'new-name')!.delta.kind, 'added')
    assert.ok(contractNode.causes.some((cause) => cause.kind === 'related' && cause.paths.includes('docs/context.md')))
    assert.deepEqual(contractNode.scenarios.find((item) => item.name === 'alpha-scenario')!.impact, [])

    const specPath = join(root, '.spec/project/n/spec.md')
    writeFileSync(specPath, execFileSync('git', ['show', `${contractHead}:.spec/project/n/spec.md`], { cwd: root, encoding: 'utf8' })
      .replace('src/shared.py#alpha', 'src/shared.py#beta'))
    git('add', '.spec/project/n/spec.md')
    git('commit', '-q', '-m', 'move inherited node selector')
    const inheritedHead = git('rev-parse', 'HEAD')
    const inheritedProjection = await projectSessionImpact(root, { base: contractHead, head: inheritedHead })
    const inherited = inheritedProjection.nodes.find((node) => node.id === 'n')!.scenarios
      .find((item) => item.name === 'inherited-scenario')!
    assert.equal(inherited.delta.semantic, false)
    assert.equal(inherited.delta.metadata, true)
    assert.equal(inherited.baseScenarioHash, inherited.headScenarioHash)
    assert.deepEqual(inherited.impact, [])
    assert.deepEqual(inherited.baseEffectiveCode, [{ path: 'src/shared.py', selectors: ['alpha'] }])
    assert.deepEqual(inherited.headEffectiveCode, [{ path: 'src/shared.py', selectors: ['beta'] }])

    writeFileSync(evalPath, declarations({
      semanticExpected: 'semantic v2', metadataTags: 'cli', metadataTest: 'tests/b.txt',
      metadataCode: 'src/shared.py#alpha', renamed: true, dropRemoved: true,
    }))
    writeFileSync(join(root, 'src/shared.py'), 'def alpha():\n    return 2\n\ndef beta():\n    return 2\n')
    git('add', '.')
    git('commit', '-q', '-m', 'remove declaration and its selector target')
    const removedHead = git('rev-parse', 'HEAD')
    const removedProjection = await projectSessionImpact(root, { base: inheritedHead, head: removedHead })
    const removed = removedProjection.nodes.find((node) => node.id === 'n')!.scenarios
      .find((item) => item.name === 'removed-selector')!
    assert.equal(removed.state, 'removed')
    assert.equal(removed.delta.kind, 'removed')
    assert.deepEqual(removed.impact, ['contract'])
    assert.deepEqual(removed.baseEffectiveCode, [{ path: 'src/shared.py', selectors: ['obsolete'] }])
    assert.deepEqual(removed.headEffectiveCode, [])

    writeFileSync(evalPath, declarations({
      semanticExpected: 'semantic v2', metadataTags: 'cli', metadataTest: 'tests/b.txt',
      metadataCode: 'src/shared.py#alpha', betaSelector: 'gone', renamed: true, dropRemoved: true,
    }))
    git('add', '.')
    git('commit', '-q', '-m', 'introduce dead selector')
    const deadHead = git('rev-parse', 'HEAD')
    await assert.rejects(
      projectSessionImpact(root, { base: removedHead, head: deadHead }),
      (error: any) => error instanceof SessionImpactUnavailableError && /dead.*shared\.py#gone/.test(error.message),
    )
    await assert.rejects(
      projectSessionImpact(root, { base: deadHead, head: deadHead }),
      (error: any) => error instanceof SessionImpactUnavailableError && /dead.*shared\.py#gone/.test(error.message),
      'an unchanged dead selector must be unavailable rather than a zero-impact projection',
    )

    const sibling = git('commit-tree', `${deadHead}^{tree}`, '-p', base, '-m', 'divergent sibling')
    await assert.rejects(
      projectSessionImpact(root, { base: betaHead, head: sibling }),
      (error: any) => error instanceof SessionImpactUnavailableError && /not an ancestor/.test(error.message),
    )

    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const fakeBin = join(root, 'fake-bin')
    const fakeGit = join(fakeBin, 'git')
    const countFile = join(root, 'git-counts')
    mkdirSync(fakeBin)
    writeFileSync(fakeGit, `#!/bin/sh
if [ -n "$IMPACT_MOVING_REF" ] && printf '%s\\n' "$*" | grep -Fq "rev-parse --verify $IMPACT_MOVING_REF^{commit}"; then
  if [ -s "$IMPACT_MOVING_COUNT" ]; then
    ${JSON.stringify(realGit)} -C ${JSON.stringify(root)} update-ref "refs/heads/$IMPACT_MOVING_REF" "$IMPACT_MOVING_TARGET"
  else
    echo first > "$IMPACT_MOVING_COUNT"
  fi
fi
case " $* " in
  *--full-history*) echo window >> "$IMPACT_GIT_COUNT"; [ "$IMPACT_GIT_FAIL" = window ] && echo forced-window-failure >&2 && exit 70 ;;
  *--no-walk*) echo hunk >> "$IMPACT_GIT_COUNT"; [ "$IMPACT_GIT_FAIL" = hunk ] && echo forced-hunk-failure >&2 && exit 71 ;;
esac
exec ${JSON.stringify(realGit)} "$@"
`)
    chmodSync(fakeGit, 0o755)
    const priorPath = process.env.PATH
    const priorCount = process.env.IMPACT_GIT_COUNT
    const priorFail = process.env.IMPACT_GIT_FAIL
    const priorMovingRef = process.env.IMPACT_MOVING_REF
    const priorMovingTarget = process.env.IMPACT_MOVING_TARGET
    const priorMovingCount = process.env.IMPACT_MOVING_COUNT
    process.env.PATH = `${fakeBin}:${priorPath}`
    process.env.IMPACT_GIT_COUNT = countFile
    try {
      writeFileSync(countFile, '')
      await projectSessionImpact(root, { base, head: betaHead })
      const counts = readFileSync(countFile, 'utf8').trim().split('\n').filter(Boolean)
      assert.equal(counts.filter((kind) => kind === 'window').length, 2, 'ordinary+merge window reads once per changed path, not per scenario')
      assert.equal(counts.filter((kind) => kind === 'hunk').length, 3, 'hunk reads once per unique selector set (alpha, beta, obsolete)')

      const movingRef = 'moving-impact'
      const movingCount = join(root, 'moving-count')
      const movedTarget = git('commit-tree', `${betaHead}^{tree}`, '-p', betaHead, '-m', 'move during projection')
      git('branch', movingRef, betaHead)
      writeFileSync(movingCount, '')
      process.env.IMPACT_MOVING_REF = movingRef
      process.env.IMPACT_MOVING_TARGET = movedTarget
      process.env.IMPACT_MOVING_COUNT = movingCount
      await assert.rejects(
        projectSessionImpact(root, { base, head: movingRef }),
        (error: any) => error?.name === 'SessionImpactRevisionMovedError' && /revisions moved/.test(error.message),
      )
      delete process.env.IMPACT_MOVING_REF
      delete process.env.IMPACT_MOVING_TARGET
      delete process.env.IMPACT_MOVING_COUNT

      writeFileSync(countFile, '')
      process.env.IMPACT_GIT_FAIL = 'window'
      await assert.rejects(
        projectSessionImpact(root, { base, head: betaHead }),
        (error: any) => error instanceof SessionImpactUnavailableError && /forced-window-failure/.test(error.message),
      )

      writeFileSync(countFile, '')
      process.env.IMPACT_GIT_FAIL = 'hunk'
      await assert.rejects(
        projectSessionImpact(root, { base, head: betaHead }),
        (error: any) => error instanceof SessionImpactUnavailableError && /forced-hunk-failure/.test(error.message),
      )
    } finally {
      process.env.PATH = priorPath
      if (priorCount === undefined) delete process.env.IMPACT_GIT_COUNT
      else process.env.IMPACT_GIT_COUNT = priorCount
      if (priorFail === undefined) delete process.env.IMPACT_GIT_FAIL
      else process.env.IMPACT_GIT_FAIL = priorFail
      if (priorMovingRef === undefined) delete process.env.IMPACT_MOVING_REF
      else process.env.IMPACT_MOVING_REF = priorMovingRef
      if (priorMovingTarget === undefined) delete process.env.IMPACT_MOVING_TARGET
      else process.env.IMPACT_MOVING_TARGET = priorMovingTarget
      if (priorMovingCount === undefined) delete process.env.IMPACT_MOVING_COUNT
      else process.env.IMPACT_MOVING_COUNT = priorMovingCount
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('exact impact accepts only commit headers from a merge patch stream', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-session-impact-merge-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const source = (target: number, left: number, right: number) => [
    'def target():', `    return ${target}`, '',
    'def left():', `    return ${left}`, '',
    'def right():', `    return ${right}`, '',
  ].join('\n')
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'eval@example.test')
    git('config', 'user.name', 'Eval Test')
    mkdirSync(join(root, '.spec/project/n'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, '.spec/project/spec.md'), '---\ntitle: project\n---\n# project\n')
    writeFileSync(join(root, '.spec/project/n/spec.md'), [
      '---', 'title: n', 'code:', '  - src/shared.py#target', '---', '# n', '',
    ].join('\n'))
    writeFileSync(join(root, '.spec/project/n/eval.md'), [
      '---', 'scenarios:', '  - name: merge-target', '    tags: [backend-api]',
      '    code: [src/shared.py#target]', '    description: merge authors target',
      '    expected: exact impact reports the merge commit', '---', '',
    ].join('\n'))
    writeFileSync(join(root, 'src/shared.py'), source(0, 0, 0))
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    const base = git('rev-parse', 'HEAD')
    git('branch', 'side')

    writeFileSync(join(root, 'src/shared.py'), source(0, 1, 0))
    git('add', 'src/shared.py')
    git('commit', '-q', '-m', 'change left')
    git('checkout', '-q', 'side')
    writeFileSync(join(root, 'src/shared.py'), source(0, 0, 1))
    git('add', 'src/shared.py')
    git('commit', '-q', '-m', 'change right')
    git('checkout', '-q', 'main')
    git('merge', '-q', '--no-ff', '--no-commit', 'side')
    writeFileSync(join(root, 'src/shared.py'), source(1, 1, 1))
    git('add', 'src/shared.py')
    git('commit', '-q', '-m', 'merge and author target')
    const merge = git('rev-parse', 'HEAD')

    const projection = await projectSessionImpact(root, { base, head: merge })
    const scenario = projection.nodes.find((node) => node.id === 'n')!.scenarios
      .find((item) => item.name === 'merge-target')!
    assert.deepEqual(scenario.impact, ['code'])
    assert.deepEqual(scenario.selectorHits.map((hit) => hit.commit), [merge])
    assert.ok(scenario.selectorHits.every((hit) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hit.commit)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an empty exact projection batch-reads declarations independent of node count', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-impact-batch-'))
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const git = (...args: string[]) => execFileSync(realGit, args, { cwd: root, encoding: 'utf8' }).trim()
  const priorPath = process.env.PATH
  const priorCount = process.env.IMPACT_GIT_COUNT
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'eval@example.test')
    git('config', 'user.name', 'Eval Test')
    mkdirSync(join(root, '.spec/project'), { recursive: true })
    writeFileSync(join(root, '.spec/project/spec.md'), '---\ntitle: project\n---\n# project\n')
    for (let i = 0; i < 80; i++) {
      const dir = join(root, `.spec/project/node-${i}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'spec.md'), `---\ntitle: node-${i}\n---\n# node-${i}\n`)
      writeFileSync(join(dir, 'eval.md'), `---\nscenarios:\n  - name: stable\n    description: stable ${i}\n    expected: unchanged\n---\nstable\n`)
    }
    git('add', '.spec')
    git('commit', '-q', '-m', 'many declarations')
    const head = git('rev-parse', 'HEAD')

    const fakeBin = join(root, 'fake-bin')
    const countFile = join(root, 'git-counts')
    mkdirSync(fakeBin)
    const fakeGit = join(fakeBin, 'git')
    writeFileSync(fakeGit, `#!/bin/sh\necho git >> "$IMPACT_GIT_COUNT"\nexec ${JSON.stringify(realGit)} "$@"\n`)
    chmodSync(fakeGit, 0o755)
    writeFileSync(countFile, '')
    process.env.PATH = `${fakeBin}:${priorPath}`
    process.env.IMPACT_GIT_COUNT = countFile

    const projection = await projectSessionImpact(root, { base: head, head })
    assert.deepEqual(projection.nodes, [])
    const calls = readFileSync(countFile, 'utf8').trim().split('\n').filter(Boolean)
    assert.equal(calls.length, 8, 'base=head projection uses fixed revision/tree/diff reads, not per-node Git')
  } finally {
    process.env.PATH = priorPath
    if (priorCount === undefined) delete process.env.IMPACT_GIT_COUNT
    else process.env.IMPACT_GIT_COUNT = priorCount
    rmSync(root, { recursive: true, force: true })
  }
})

test('export projection counts and renders affected missing scenarios and retains changed-only nodes', () => {
  assert.deepEqual(completeExportNodeIds(['changed-only'], ['measured']), ['changed-only', 'measured'])
  const model: ExportModel = {
    id: 'session-id', node: 'measured', branch: 'node/measured', title: 'Measured', generatedAt: '2026-07-20',
    ahead: 1, dirtyNonRuntime: 0, gates: [], score: { passed: 1, total: 2, fresh: 1 }, otherFiles: [],
    impact: { base: 'base', head: 'head', revision: 'revision', nodes: [] },
    nodes: [
      {
        id: 'measured', title: 'Measured', hue: 150, desc: '', files: [], additions: 0, deletions: 0,
        hasEvalFile: true, uncoveredFrontend: false, affectedScenarios: 2, score: 'empty',
        readings: [{
          scenario: 'fresh', expected: 'fresh expected', impact: ['code'], verdict: { status: 'pass' },
          fresh: true, staleAxes: [], score: 'pass', ts: '2026-07-20', evidence: { kind: 'none' },
        }],
        unmeasured: [{ scenario: 'missing', expected: 'missing expected', impact: ['contract'] }],
      },
      {
        id: 'changed-only', title: 'Changed only', hue: 200, desc: '', additions: 1, deletions: 0,
        hasEvalFile: true, uncoveredFrontend: false, affectedScenarios: 0, score: 'empty', readings: [], unmeasured: [],
        files: [{
          path: '.spec/changed-only/spec.md', status: 'modified', additions: 1, deletions: 0,
          patch: '+changed', oldText: 'old', newText: 'new', truncated: false, omitted: false,
        }],
      },
    ],
  }
  const html = renderExportHtml(model)
  assert.match(html, /1\/2 passing/)
  assert.match(html, /missing/)
  assert.match(html, /unmeasured/)
  assert.match(html, /\.spec\/changed-only\/spec\.md/)
  assert.match(html, /no declared scenario is affected by this worktree/)
})

const summary = (measured: number) => ({
  measured, total: measured, pass: measured, fail: 0, review: 0, blind: 0, unknown: 0,
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

test('sessionEvalSummary is the declared-bounded full/graph projection', () => {
  const nodes: SessionEvalNode[] = [{
    id: 'n', title: 'n', hue: 1, desc: '', hasEvalFile: true, uncoveredFrontend: false,
    unknownCoverage: ['src/unknown.jsx'], causes: [],
    scenarios: [
      { name: 'pass', expected: '', impact: ['code'] },
      { name: 'fail', expected: '', impact: ['code'] },
      { name: 'stale', expected: '', impact: ['code'] },
      { name: 'blind', expected: '', impact: ['code'] },
    ],
    evals: [
      { ...reading({ scenario: 'pass', fresh: true, verdict: { status: 'pass' } }), inSession: false },
      { ...reading({ scenario: 'fail', fresh: true, verdict: { status: 'fail' } }), inSession: false },
      { ...reading({ scenario: 'stale', fresh: false, verdict: { status: 'pass' } }), inSession: false },
    ],
  }]
  assert.deepEqual(sessionEvalSummary(nodes), {
    measured: 3, total: 4, pass: 1, fail: 1, review: 1, blind: 1, unknown: 1,
  })
})

test('projection cache coalesces a burst to one latest-generation build and publication', async () => {
  let builds = 0, publishes = 0
  const cache = new SessionEvalProjectionCache(async () => {
    builds++
    return { kind: 'stable', revision: `r${builds}`, summary: summary(builds) }
  }, () => { publishes++ }, 'epoch')
  const sessions = [{ id: 's', path: '/wt' }]

  assert.equal(cache.snapshot(sessions).get('s')?.phase, 'loading')
  await cache.idle()
  assert.equal(cache.get('s')?.phase, 'ready')
  assert.equal(builds, 1)
  for (let i = 0; i < 60; i++) cache.snapshot(sessions)
  await cache.idle()
  assert.equal(builds, 1, 'idle snapshots authorize zero additional computes')

  cache.invalidate({ id: 's' })
  cache.invalidate({ id: 's' })
  cache.invalidate({ id: 's' })
  const updating = cache.snapshot(sessions).get('s')!
  assert.equal(updating.phase, 'updating')
  assert.equal(updating.generation, 3)
  assert.equal(updating.lastKnown?.value.measured, 1)
  await cache.idle()

  assert.equal(builds, 2, 'three burst writes authorize only one F(inputs@g=3)')
  assert.equal(publishes, 2, 'one initial and one burst completion publication')
  assert.deepEqual(cache.get('s'), {
    epoch: 'epoch', generation: 3, phase: 'ready', revision: 'r2', value: summary(2),
  })
})

test('projection cache discards an old response after a newer generation and stays single-flight', async () => {
  const old = deferred<any>(), fresh = deferred<any>()
  let builds = 0, active = 0, maxActive = 0, publishes = 0
  const cache = new SessionEvalProjectionCache(async () => {
    builds++; active++; maxActive = Math.max(maxActive, active)
    const result = await (builds === 1 ? old.promise : fresh.promise)
    active--
    return result
  }, () => { publishes++ }, 'epoch')
  const sessions = [{ id: 's', path: '/wt' }]

  cache.snapshot(sessions)
  await Promise.resolve()
  cache.invalidate({ id: 's' })
  const updating = cache.snapshot(sessions).get('s')!
  assert.equal(updating.generation, 1)
  old.resolve({ kind: 'stable', revision: 'old', summary: summary(1) })
  await Promise.resolve()
  await Promise.resolve()
  fresh.resolve({ kind: 'stable', revision: 'new', summary: summary(2) })
  await cache.idle()

  assert.equal(maxActive, 1)
  assert.equal(publishes, 1, 'the discarded generation publishes nothing')
  assert.deepEqual(cache.get('s'), {
    epoch: 'epoch', generation: 1, phase: 'ready', revision: 'new', value: summary(2),
  })
})

test('observer holds fence in-flight work and resubscribe computes the missed window once', async () => {
  const stale = deferred<any>()
  let builds = 0
  let latest = 1
  const cache = new SessionEvalProjectionCache(async () => {
    builds++
    if (builds === 2) return stale.promise
    return { kind: 'stable', revision: `r${latest}`, summary: summary(latest) }
  }, () => {}, 'epoch')
  const sessions = [{ id: 's', path: '/wt' }]

  cache.snapshot(sessions)
  await cache.idle()
  cache.invalidate({ id: 's' })
  cache.snapshot(sessions)
  await Promise.resolve()

  assert.equal(cache.holdObserver('refs', 'all'), true)
  assert.equal(cache.holdObserver('worktree', { path: '/wt' }), true)
  latest = 3 // a direct edit in the interval where both observers are absent
  stale.resolve({ kind: 'stable', revision: 'stale', summary: summary(2) })
  await cache.idle()
  cache.snapshot(sessions)
  await cache.idle()
  assert.equal(builds, 2, 'an observer-held snapshot cannot authorize a replacement compute')
  assert.deepEqual(cache.get('s'), {
    epoch: 'epoch', generation: 3, phase: 'updating',
    lastKnown: { generation: 0, revision: 'r1', value: summary(1) },
  })

  assert.equal(cache.releaseObserver('worktree'), true)
  cache.snapshot(sessions)
  await cache.idle()
  assert.equal(builds, 2, 'restoring one observer cannot mask a second failed input axis')
  assert.equal(cache.releaseObserver('refs'), true)
  cache.snapshot(sessions)
  await cache.idle()

  assert.equal(builds, 3, 'the fully restored observer set authorizes one latest-window rescan')
  assert.deepEqual(cache.get('s'), {
    epoch: 'epoch', generation: 5, phase: 'ready', revision: 'r3', value: summary(3),
  })
})

test('cold scoped demand waits through composed observer holds, then returns the authoritative empty projection', async () => {
  let builds = 0
  const cache = new SessionEvalProjectionCache(async () => {
    builds++
    return { kind: 'stable', revision: 'empty-r1', summary: summary(0) }
  }, () => {}, 'epoch')
  const sessions = [{ id: 'new-session', path: '/wt/new-session' }]

  cache.holdObserver('refs', 'all')
  cache.holdObserver('worktree', { path: '/wt/new-session' })
  assert.equal(cache.snapshot(sessions).get('new-session')?.phase, 'updating')

  let settled = false
  const demand = cache.waitUntilObservable('new-session', '/wt/new-session', 1_000).then(async (observable) => {
    settled = true
    assert.equal(observable, true)
    cache.snapshot(sessions)
    await cache.idle()
    return cache.get('new-session')
  })
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(builds, 0, 'a held cold demand must not certify a projection')

  cache.releaseObserver('worktree')
  await Promise.resolve()
  assert.equal(settled, false, 'restoring one observer must not mask the remaining hold')
  assert.equal(builds, 0)

  cache.releaseObserver('refs')
  const projection = await demand
  assert.equal(builds, 1, 'recovery authorizes exactly one authoritative build')
  assert.deepEqual(projection, {
    epoch: 'epoch', generation: 2, phase: 'ready', revision: 'empty-r1', value: summary(0),
  })
})

test('projection cache batches initial misses into one publication', async () => {
  let builds = 0, publishes = 0
  const cache = new SessionEvalProjectionCache(async (id) => {
    builds++
    return { kind: 'stable', revision: `r-${id}`, summary: summary(1) }
  }, () => { publishes++ }, 'epoch')

  const rows = cache.snapshot([
    { id: 'a', path: '/wt/a' },
    { id: 'b', path: '/wt/b' },
    { id: 'c', path: '/wt/c' },
  ])
  assert.deepEqual([...rows.values()].map((row) => row.phase), ['loading', 'loading', 'loading'])
  await cache.idle()

  assert.equal(builds, 3, 'the one batch computes one lean projection per cold session')
  assert.equal(publishes, 1, 'the batch completion emits one canonical graph nudge, not N pushes')
})

test('offline history projections stay demand-only', async () => {
  let builds = 0
  const cache = new SessionEvalProjectionCache(async () => {
    builds++
    return { kind: 'stable', revision: `r${builds}`, summary: summary(1) }
  }, () => {}, 'epoch')

  const rows = cache.snapshot([
    { id: 'live', path: '/wt/live', liveness: 'online' },
    { id: 'offline', path: '/wt/offline', liveness: 'offline' },
  ])
  assert.deepEqual([...rows.values()].map((row) => row.phase), ['loading', 'loading'])
  await cache.idle()
  assert.equal(builds, 1, 'the graph precomputes the live toolbar summary only')
  assert.equal(cache.get('offline')?.phase, 'loading')
})

test('projection warmup can be disabled for plain graph reads', async () => {
  let builds = 0
  const cache = new SessionEvalProjectionCache(async () => {
    builds++
    return { kind: 'stable', revision: `r${builds}`, summary: summary(1) }
  }, () => {}, 'epoch', false)

  cache.snapshot([{ id: 'live', path: '/wt/live', liveness: 'online' }])
  await cache.idle()
  assert.equal(builds, 0, 'a plain graph read leaves live projections loading')
  cache.setPrecompute(true)
  await cache.idle()
  assert.equal(builds, 1, 'starting a delta era authorizes the current live projection')
})

test('projection queue never overlaps per-session history builds', async () => {
  let active = 0, maxActive = 0, builds = 0
  const cache = new SessionEvalProjectionCache(async () => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active--
    builds++
    return { kind: 'stable', revision: `r${builds}`, summary: summary(1) }
  }, () => {}, 'epoch')

  cache.snapshot(['a', 'b', 'c', 'd'].map((id) => ({ id, path: `/wt/${id}`, liveness: 'online' })))
  await cache.idle()
  assert.equal(builds, 4)
  assert.equal(maxActive, 1, 'the bounded runner keeps worktree history walks serial')
})

test('ending and reopening a delta era does not enqueue a running generation twice', async () => {
  const gate = deferred<any>()
  let builds = 0
  const cache = new SessionEvalProjectionCache(async () => {
    builds++
    return gate.promise
  }, () => {}, 'epoch', false)
  const sessions = [{ id: 's', path: '/wt/s', liveness: 'online' }]

  cache.snapshot(sessions)
  cache.setPrecompute(true)
  await Promise.resolve()
  assert.equal(builds, 1)
  cache.setPrecompute(false)
  cache.setPrecompute(true)
  await Promise.resolve()
  assert.equal(builds, 1, 'reconnect joins the in-flight generation instead of duplicating it')
  gate.resolve({ kind: 'stable', revision: 'r1', summary: summary(1) })
  await cache.idle()
  assert.equal(cache.get('s')?.phase, 'ready')
})

test('a selected demand jumps ahead of unrelated queued summaries without opening a second lane', async () => {
  const gates = new Map<string, ReturnType<typeof deferred<any>>>()
  const order: string[] = []
  let active = 0, maxActive = 0
  const cache = new SessionEvalProjectionCache(async (id) => {
    order.push(id)
    active++
    maxActive = Math.max(maxActive, active)
    const gate = deferred<any>()
    gates.set(id, gate)
    const result = await gate.promise
    active--
    return result
  }, () => {}, 'epoch')
  const sessions = Array.from({ length: 30 }, (_, i) => {
    const id = `s${i + 1}`
    return { id, path: `/wt/${id}`, liveness: 'online' }
  })
  cache.snapshot(sessions)
  await Promise.resolve()
  assert.deepEqual(order, ['s1'], 'the first summary owns the only running slot')

  const demand = cache.demand('s30', '/wt/s30', async () => {
    order.push('demand:s30')
    return 'selected'
  })
  gates.get('s1')!.resolve({ kind: 'stable', revision: 'r1', summary: summary(1) })
  for (let i = 0; i < 20 && order.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(order.slice(0, 2), ['s1', 'demand:s30'], 'the selected id runs before the remaining queue')
  assert.equal(await demand, 'selected')

  for (const id of ['s2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12', 's13', 's14', 's15', 's16', 's17', 's18', 's19', 's20', 's21', 's22', 's23', 's24', 's25', 's26', 's27', 's28', 's29']) {
    while (!gates.has(id)) await Promise.resolve()
    gates.get(id)!.resolve({ kind: 'stable', revision: `r-${id}`, summary: summary(1) })
    await Promise.resolve()
  }
  await cache.idle()
  assert.deepEqual(order, ['s1', 'demand:s30', ...Array.from({ length: 28 }, (_, i) => `s${i + 2}`)])
  assert.equal(maxActive, 1, 'demand priority stays inside the bounded queue')
})

test('a rejected demand frees the slot and lets ordinary summaries continue', async () => {
  const gates = new Map<string, ReturnType<typeof deferred<any>>>()
  const order: string[] = []
  const cache = new SessionEvalProjectionCache(async (id) => {
    order.push(id)
    const gate = deferred<any>()
    gates.set(id, gate)
    return gate.promise
  }, () => {}, 'epoch')
  cache.snapshot([
    { id: 's1', path: '/wt/s1', liveness: 'online' },
    { id: 's2', path: '/wt/s2', liveness: 'online' },
    { id: 's3', path: '/wt/s3', liveness: 'online' },
  ])
  await Promise.resolve()
  const demand = cache.demand('s3', '/wt/s3', async () => {
    order.push('demand:s3')
    throw new Error('selected demand failed')
  })
  gates.get('s1')!.resolve({ kind: 'stable', revision: 'r1', summary: summary(1) })
  await assert.rejects(demand, /selected demand failed/)
  while (!gates.has('s2')) await Promise.resolve()
  gates.get('s2')!.resolve({ kind: 'stable', revision: 'r2', summary: summary(1) })
  await cache.idle()
  assert.deepEqual(order, ['s1', 'demand:s3', 's2'])
})

test('a demand enqueued in the batch-finally gap is not lost', async () => {
  let demand!: Promise<string>
  let cache!: SessionEvalProjectionCache
  cache = new SessionEvalProjectionCache(async (id) => {
    if (id === 's1') {
      // Queue the demand from the same turn that resolves the only summary. Depending on promise reaction
      // ordering this lands between the batch body resolving and its finally callback, the lost-wakeup gap.
      queueMicrotask(() => { demand = cache.demand('s2', '/wt/s2', async () => 'settled') })
    }
    return { kind: 'stable', revision: `r-${id}`, summary: summary(1) }
  }, () => {}, 'epoch')
  cache.snapshot([{ id: 's1', path: '/wt/s1', liveness: 'online' }])
  await cache.idle()
  assert.equal(await demand, 'settled', 'the gap demand must wake a new or current batch')
})

test('content revision covers dirty source, index, rename, sidecar, remark, and main movement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-session-revision-'))
  const remarks = mkdtempSync(join(tmpdir(), 'spex-session-remarks-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const priorIssuesDir = process.env.SPEXCODE_ISSUES_DIR
  process.env.SPEXCODE_ISSUES_DIR = remarks
  try {
    git('init', '-b', 'main')
    git('config', 'user.email', 'eval@example.test')
    git('config', 'user.name', 'Eval Test')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, '.spec/n'), { recursive: true })
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 1\n')
    writeFileSync(join(root, '.spec/n/eval.md'), 'scenario contract\n')
    writeFileSync(join(root, '.spec/n/evals.ndjson'), '{"scenario":"s"}\n')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-q', '-b', 'node/test')

    const revisions = [await sessionEvalContentRevision(root)]
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 2\n')
    revisions.push(await sessionEvalContentRevision(root))
    git('add', 'src/a.ts')
    revisions.push(await sessionEvalContentRevision(root))
    renameSync(join(root, 'src/a.ts'), join(root, 'src/b.ts'))
    revisions.push(await sessionEvalContentRevision(root))
    writeFileSync(join(root, '.spec/n/evals.ndjson'), '{"scenario":"s","retracts":"old"}\n')
    revisions.push(await sessionEvalContentRevision(root))
    writeFileSync(join(remarks, 'freshness.md'), [
      '---', 'concern: eval: n · s', 'by: reviewer', 'status: open',
      'created: 2026-07-20T00:00:00.000Z', '---', '', 'freshness concern', '',
      '<!-- reply: reviewer @ 2026-07-20T00:00:00.000Z :: rid=r1 sha=abc -->',
      'needs another reading', '',
    ].join('\n'))
    revisions.push(await sessionEvalContentRevision(root))
    const tree = git('rev-parse', 'main^{tree}')
    const movedMain = git('commit-tree', tree, '-p', 'main', '-m', 'main move')
    git('update-ref', 'refs/heads/main', movedMain)
    revisions.push(await sessionEvalContentRevision(root))

    assert.equal(new Set(revisions).size, revisions.length)
  } finally {
    if (priorIssuesDir === undefined) delete process.env.SPEXCODE_ISSUES_DIR
    else process.env.SPEXCODE_ISSUES_DIR = priorIssuesDir
    rmSync(root, { recursive: true, force: true })
    rmSync(remarks, { recursive: true, force: true })
  }
})
