import { execFileSync } from 'node:child_process'

import {
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

function structuralCounterexample() {
  // R--h--vB and R--vA, followed by M(vA,vB). h is an anchor hit; vA/vB are versions.
  // Both parent states are identical whether h was a hit or not: (vA, empty) and (vB, empty).
  // If M selects vA, h must reappear because h is not reachable from vA. No join over only those
  // parent states can distinguish the two histories, so a single (v,D) is insufficient information.
  return {
    dag: 'R--h--vB; R--vA; M(vA,vB)',
    parentStates: ['(vA, empty)', '(vB, empty)'],
    selectedAtMerge: 'vA',
    requiredDebt: ['h'],
  }
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
const pathCommits = new Map()
function commitsFor(path) {
  const cached = pathCommits.get(path)
  if (cached) return cached
  const ordinary = didx.lazy
    ? git(['rev-list', '--no-merges', tip, '--', path]).trim().split('\n').filter(Boolean)
    : didx.fileCommits.get(path) ?? []
  const merges = didx.resolutionCommits?.get(path) ?? []
  const commits = [...new Set([...ordinary, ...merges])]
  pathCommits.set(path, commits)
  return commits
}

const checkpointAcks = (node) => didx.lazy
  ? didx.lazy.ackByNode.get(node) ?? []
  : [...didx.acks].filter(([, nodes]) => nodes.has(node)).map(([hash]) => hash)
const selfAcks = didx.lazy?.selfAcks ?? didx.selfAcks ?? new Map()
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
for (const spec of specs) {
  const versions = antichainByPath.get(spec.path) ?? []
  const selected = rowsFor(hidx, spec.path)[0]?.hash ?? ''
  if (!versions.length || !selected) continue
  if (process.env.SPEX_BRANCHY_ONLY === '1' && versions.length < 2) continue
  for (const entry of spec.codeScoped) {
    const extractor = extractorFor(registry, extOf(entry.path))
    if (!extractor || extractor.ready() !== true) continue
    const hits = await anchorHitCommits(root, commitsFor(entry.path), entry.path, entry.selectors, extractor)
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
    rawDifferingNodes: rawSemanticDifferences,
    differingNodes: semanticDifferences,
  },
  counterexample: structuralCounterexample(),
}, null, 2))
