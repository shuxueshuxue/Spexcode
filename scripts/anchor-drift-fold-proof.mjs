import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import {
  driftFor,
  driftIndex,
  historyIndex,
  rowsFor,
} from '../spec-cli/src/git.ts'
import {
  anchorHitCommits,
  extOf,
  extractorFor,
  extractors,
} from '../spec-cli/src/anchors.ts'
import { loadSpecs } from '../spec-cli/src/specs.ts'

const root = process.argv[2] || process.cwd()
const requestedTip = process.argv[3] || 'HEAD'
const git = (args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
  maxBuffer: 1 << 30,
})
const tip = git(['rev-parse', `${requestedTip}^{commit}`]).trim()

function commitGraph() {
  const newest = git(['rev-list', '--parents', '--topo-order', tip]).trim().split('\n').filter(Boolean)
  const parents = new Map()
  for (const line of newest) {
    const [hash, ...ps] = line.split(' ')
    parents.set(hash, ps)
  }
  const oldest = [...newest].reverse().map((line) => line.split(' ')[0])
  const slot = new Map(oldest.map((hash, i) => [hash, i]))
  const words = Math.ceil(oldest.length / 32)
  const ancestors = new Map()
  for (const hash of oldest) {
    const bits = new Uint32Array(words)
    for (const parent of parents.get(hash) ?? []) {
      const inherited = ancestors.get(parent)
      if (inherited) for (let i = 0; i < words; i++) bits[i] |= inherited[i]
    }
    const i = slot.get(hash)
    bits[i >>> 5] |= 1 << (i & 31)
    ancestors.set(hash, bits)
  }
  const isAncestor = (older, newer) => {
    const i = slot.get(older)
    const bits = ancestors.get(newer)
    return i !== undefined && bits !== undefined && (bits[i >>> 5] & (1 << (i & 31))) !== 0
  }
  return { commits: oldest, isAncestor }
}

function maximalAntichain(events, isAncestor) {
  return events.filter((candidate) => !events.some((other) =>
    candidate !== other && isAncestor(candidate, other)))
}

async function structuralCounterexample() {
  const cli = fileURLToPath(new URL('../spec-cli/bin/spex.mjs', import.meta.url))
  const hostTypescript = createRequire(import.meta.url).resolve('typescript')
  const hostNodeModules = dirname(dirname(dirname(hostTypescript)))
  const roots = []
  const body = (a, b) => `---\ntitle: n1\nstatus: active\ndesc: counterexample node\ncode:\n  - src/a.ts#f\n---\n# n1\n\nA=${a}\n${'stable\n'.repeat(20)}B=${b}\n`
  const run = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const dated = (root, date, ...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim()
  const lint = (root, home, tip) => {
    const result = spawnSync(process.execPath, [cli, 'spec', 'lint', '--pending', tip], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 30,
      env: { ...process.env, HOME: home },
    })
    assert.equal(result.error, undefined, `counterexample lint failed to start: ${result.error?.message}`)
    return `${result.stdout || ''}${result.stderr || ''}`
  }
  const anchorErrors = (output) => output.split('\n').filter((line) =>
    line.replace(/\x1b\[[0-9;]*m/g, '').includes('anchor-drift:')).length

  const build = (withHit) => {
    const root = mkdtempSync(join(tmpdir(), `spex-fold-counterexample-${withHit ? 'hit' : 'control'}-`))
    roots.push(root)
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, '.spec', 'proj', 'n1'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"private":true}\n')
    writeFileSync(join(root, 'spexcode.json'), '{"lint":{"governedRoots":["src"],"sourceExtensions":["ts"]}}\n')
    writeFileSync(join(root, 'src', 'a.ts'), 'export function f(): number {\n  return 1\n}\nexport function g(): number {\n  return 2\n}\n')
    writeFileSync(join(root, '.spec', 'proj', 'n1', 'spec.md'), body(0, 0))
    run(root, 'init', '-q', '-b', 'main')
    run(root, 'config', 'user.email', 'test@example.com')
    run(root, 'config', 'user.name', 'test')
    run(root, 'add', '.')
    dated(root, '2000-01-01T00:00:00Z', 'commit', '-qm', 'R')
    const R = run(root, 'rev-parse', 'HEAD')

    run(root, 'switch', '-qc', 'version-a')
    writeFileSync(join(root, '.spec', 'proj', 'n1', 'spec.md'), body(1, 0))
    run(root, 'add', '.spec/proj/n1/spec.md')
    dated(root, '2025-01-01T00:00:00Z', 'commit', '-qm', 'version A')
    const versionA = run(root, 'rev-parse', 'HEAD')

    run(root, 'switch', '-qc', 'version-b', 'main')
    if (withHit) {
      writeFileSync(join(root, 'src', 'a.ts'), 'export function f(): number {\n  const probe = 0\n  return 1\n}\nexport function g(): number {\n  return 2\n}\n')
      run(root, 'add', 'src/a.ts')
      dated(root, '2001-01-01T00:00:00Z', 'commit', '-qm', 'h touch anchored symbol f')
    }
    writeFileSync(join(root, '.spec', 'proj', 'n1', 'spec.md'), body(0, 1))
    run(root, 'add', '.spec/proj/n1/spec.md')
    dated(root, '2002-01-01T00:00:00Z', 'commit', '-qm', 'version B')
    const versionB = run(root, 'rev-parse', 'HEAD')
    const hit = withHit ? run(root, 'rev-list', '--reverse', `${R}..${versionB}`, '--', 'src/a.ts').split('\n').find(Boolean) : ''

    run(root, 'switch', '-q', 'version-a')
    run(root, 'merge', '--no-ff', '-q', '-m', 'M merge vA vB', 'version-b')
    const merge = run(root, 'rev-parse', 'HEAD')
    return { root, R, versionA, versionB, merge, hit }
  }

  try {
    const results = {}
    for (const withHit of [true, false]) {
      const fixture = build(withHit)
      const home = mkdtempSync(join(tmpdir(), 'spex-fold-counterexample-home-'))
      roots.push(home)
      symlinkSync(hostNodeModules, join(fixture.root, 'node_modules'))
      assert.doesNotThrow(() => createRequire(join(fixture.root, 'package.json')).resolve('typescript'),
        'counterexample fixture must expose the host TypeScript extractor')
      const parentA = lint(fixture.root, home, fixture.versionA)
      const parentB = lint(fixture.root, home, fixture.versionB)
      const merged = lint(fixture.root, home, fixture.merge)
      const hidx = await historyIndex(fixture.root, fixture.merge)
      const rows = rowsFor(hidx, '.spec/proj/n1/spec.md')
      assert.equal(rows[0]?.hash, fixture.versionA, 'full-history walk must select vA')
      assert.ok(rows.some((row) => row.hash === fixture.versionB), 'vB must remain in the version history')
      assert.ok(!rows.some((row) => row.hash === fixture.merge), 'mixed-only clean merge must not become a version')
      const didx = await driftIndex(fixture.root, fixture.merge)
      assert.equal(driftFor(didx, fixture.versionA, 'src/a.ts'), withHit ? 1 : 0)
      assert.equal(driftFor(didx, fixture.versionB, 'src/a.ts'), 0)
      assert.equal(anchorErrors(parentA), 0, 'A parent must be anchor-clean')
      assert.equal(anchorErrors(parentB), 0, 'B parent must be anchor-clean')
      assert.equal(anchorErrors(merged), withHit ? 1 : 0,
        `merge verdict must expose exactly the hit; output=${merged}`)
      results[withHit ? 'withHit' : 'control'] = {
        parentAnchorErrors: [anchorErrors(parentA), anchorErrors(parentB)],
        mergeAnchorErrors: anchorErrors(merged),
        selectedVersion: rows[0].hash.slice(0, 8),
        hit: fixture.hit ? fixture.hit.slice(0, 8) : null,
      }
    }
    return { dag: 'R--vA; R--h--vB; M(vA,vB)', results }
  } finally {
    for (const path of roots) rmSync(path, { recursive: true, force: true })
  }
}

if (process.env.SPEX_COUNTEREXAMPLE_ONLY === '1') {
  console.log(JSON.stringify(await structuralCounterexample(), null, 2))
  process.exit(0)
}

const { isAncestor } = commitGraph()
const [hidx, didx] = await Promise.all([historyIndex(root, tip), driftIndex(root, tip)])
const paths = git(['ls-tree', '-r', '-z', '--name-only', tip, '--', '.spec'])
  .split('\0').filter((path) => path.endsWith('/spec.md'))
const walk = git(['log', '--full-history', '--date-order', '--no-diff-merges', '--format=%H', tip, '--', '.spec'])
  .trim().split('\n').filter(Boolean)
const rank = new Map(walk.map((hash, i) => [hash, i]))

const antichainByPath = new Map()
let versionMatches = 0
const versionMismatches = []
const branchyVersions = []
for (const path of paths) {
  const rows = rowsFor(hidx, path)
  const antichain = maximalAntichain(rows.map((row) => row.hash), isAncestor)
  antichainByPath.set(path, antichain)
  const selected = [...antichain].sort((a, b) =>
    (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER))[0] ?? ''
  const oracle = rows[0]?.hash ?? ''
  if (selected === oracle) versionMatches++
  else versionMismatches.push({ path, fold: selected, oracle })
  if (antichain.length > 1) branchyVersions.push({ path, versions: antichain })
}

const specs = await loadSpecs(root, { tip, history: hidx, drift: didx })
const registry = extractors(root)
const pathEvents = new Map()
function eventsFor(path) {
  const cached = pathEvents.get(path)
  if (cached) return cached
  const events = [...(didx.fileEvents.get(path) ?? []), ...(didx.resolutionEvents?.get(path) ?? [])]
  pathEvents.set(path, events)
  return events
}
const commitsFor = (path) => [...new Set(eventsFor(path).map((event) => event.commit))]

const checkpointAcks = (node) => [...didx.acks].filter(([, nodes]) => nodes.has(node)).map(([hash]) => hash)
const selfAcks = didx.selfAcks ?? new Map()
const clearedFor = (commit, version, node) => isAncestor(commit, version)
  || selfAcks.get(commit)?.has(node)
  || checkpointAcks(node).some((ack) => !isAncestor(ack, version) && isAncestor(commit, ack))

if (process.env.SPEX_FOLD_FAST === '1') {
  let scopedCodeMiss = 'warn'
  try {
    const settings = JSON.parse(git(['show', `${tip}:spexcode.json`]))
    scopedCodeMiss = settings?.lint?.scopedCodeMiss ?? 'warn'
  } catch { /* absent settings use the product default */ }
  const findings = new Set()
  let relatedDrift = 0
  for (const spec of specs) {
    const version = rowsFor(hidx, spec.path)[0]?.hash ?? ''
    if (!version) continue
    const scopedCode = new Set(spec.codeScoped.map((entry) => entry.path))
    for (const path of spec.code) {
      const debt = commitsFor(path).some((commit) => !clearedFor(commit, version, spec.id))
      if (debt && !(scopedCodeMiss === 'ignore' && scopedCode.has(path)))
        findings.add(`drift|${spec.id}|${path}`)
    }
    const scopedRelated = new Set(spec.relatedScoped.map((entry) => entry.path))
    for (const path of spec.related) {
      if (scopedRelated.has(path)) continue
      if (commitsFor(path).some((commit) => !clearedFor(commit, version, spec.id))) relatedDrift++
    }
  }
  if (relatedDrift) findings.add(`related-drift||${relatedDrift}`)
  console.log(JSON.stringify({
    tip,
    versionMatches,
    versionMismatches: versionMismatches.length,
    findings: [...findings].sort(),
  }))
  process.exit(0)
}

let totalHits = 0
let totalSelectedDebt = 0
let totalLenientDebt = 0
let totalStrictDebt = 0
let totalSelectedDebtAfterAck = 0
let totalLenientDebtAfterAck = 0
let totalStrictDebtAfterAck = 0
const semanticDifferences = []
const rawSemanticDifferences = []
const hitRecords = []
for (const spec of specs) {
  const versions = antichainByPath.get(spec.path) ?? []
  const selected = rowsFor(hidx, spec.path)[0]?.hash ?? ''
  if (!versions.length || !selected) continue
  if (process.env.SPEX_BRANCHY_ONLY === '1' && versions.length < 2) continue
  for (const entry of spec.codeScoped) {
    const extractor = extractorFor(registry, extOf(entry.path))
    if (!extractor || extractor.ready() !== true) continue
    const hits = await anchorHitCommits(root, eventsFor(entry.path), entry.selectors, registry)
    for (const hit of hits) hitRecords.push({ node: spec.id, path: entry.path, commit: hit.commit, selectors: hit.selectors })
    const selectedDebt = hits.filter((hit) => !isAncestor(hit.commit, selected))
    const lenientDebt = hits.filter((hit) => versions.every((version) => !isAncestor(hit.commit, version)))
    const strictDebt = hits.filter((hit) => versions.some((version) => !isAncestor(hit.commit, version)))
    const selectedAfterAck = hits.filter((hit) => !clearedFor(hit.commit, selected, spec.id))
    const lenientAfterAck = hits.filter((hit) => versions.every((version) => !clearedFor(hit.commit, version, spec.id)))
    const strictAfterAck = hits.filter((hit) => versions.some((version) => !clearedFor(hit.commit, version, spec.id)))
    totalHits += hits.length
    totalSelectedDebt += selectedDebt.length
    totalLenientDebt += lenientDebt.length
    totalStrictDebt += strictDebt.length
    totalSelectedDebtAfterAck += selectedAfterAck.length
    totalLenientDebtAfterAck += lenientAfterAck.length
    totalStrictDebtAfterAck += strictAfterAck.length
    if (lenientDebt.length !== strictDebt.length) rawSemanticDifferences.push({
      node: spec.id,
      path: entry.path,
      versions: versions.map((hash) => hash.slice(0, 8)),
      lenient: lenientDebt.map((hit) => hit.commit.slice(0, 8)),
      strict: strictDebt.map((hit) => hit.commit.slice(0, 8)),
    })
    if (lenientAfterAck.length !== strictAfterAck.length) {
      semanticDifferences.push({
        node: spec.id,
        path: entry.path,
        versions: versions.map((hash) => hash.slice(0, 8)),
        lenientBeforeAck: lenientDebt.map((hit) => hit.commit.slice(0, 8)),
        strictBeforeAck: strictDebt.map((hit) => hit.commit.slice(0, 8)),
        lenientAfterAck: lenientAfterAck.map((hit) => hit.commit.slice(0, 8)),
        strictAfterAck: strictAfterAck.map((hit) => hit.commit.slice(0, 8)),
      })
    }
  }
}

// The proof derives and retains every hit identity from the complete drift event index. Project that set
// onto the first-parent points only for the growth measurement; do not re-run a path-limited `git log`
// at each point, because history simplification is exactly the 749-vs-757 measurement bug this proof guards.
const firstParent = git(['rev-list', '--first-parent', '--reverse', tip]).trim().split('\n').filter(Boolean)
const countMemo = new Map()
const reachableCount = (hash) => {
  const hit = countMemo.get(hash)
  if (hit !== undefined) return hit
  const count = Number(git(['rev-list', '--count', hash]).trim())
  countMemo.set(hash, count)
  return count
}
const pointNear = (target) => {
  let lo = 0, hi = firstParent.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (reachableCount(firstParent[mid]) < target) lo = mid + 1
    else hi = mid
  }
  const candidates = [firstParent[lo], firstParent[Math.max(0, lo - 1)]]
  return candidates.sort((a, b) => Math.abs(reachableCount(a) - target) - Math.abs(reachableCount(b) - target))[0]
}
const growth = [1000, 2500, 4200].map((target) => {
  const point = pointNear(target)
  return {
    target,
    commit: point,
    depth: reachableCount(point),
    rawHitEntries: hitRecords.filter((hit) => isAncestor(hit.commit, point)).length,
  }
})

console.log(JSON.stringify({
  tip,
  commits: git(['rev-list', '--count', tip]).trim(),
  nodes: paths.length,
  versionFold: {
    matches: versionMatches,
    mismatches: versionMismatches.length,
    samples: versionMismatches.slice(0, 5),
  },
  versionAntichains: {
    branchyNodes: branchyVersions.length,
    maxWidth: Math.max(0, ...branchyVersions.map((entry) => entry.versions.length)),
    nodes: branchyVersions.map((entry) => ({
      path: entry.path,
      versions: entry.versions.map((hash) => hash.slice(0, 8)),
    })),
  },
  anchorHitsBeforeAck: {
    retainedState: totalHits,
    selectedWalkDebt: totalSelectedDebt,
    lenientAntichainDebt: totalLenientDebt,
    strictAntichainDebt: totalStrictDebt,
    selectedWalkDebtAfterAck: totalSelectedDebtAfterAck,
    lenientAntichainDebtAfterAck: totalLenientDebtAfterAck,
    strictAntichainDebtAfterAck: totalStrictDebtAfterAck,
    growth,
    rawDifferingNodes: rawSemanticDifferences,
    differingNodes: semanticDifferences,
  },
  counterexample: await structuralCounterexample(),
}, null, 2))
