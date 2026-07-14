#!/usr/bin/env node
// Deterministic pre-registration runner. Deliberately no model, network, or R0 adapter exists here.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..', '..')
const C0 = '038dce1f7e87b5ef3c8737daffb4fe929d1753a7'
const C_EVAL = '5723eaca1ba52eb60d28b818ddb4f77d758af01a'
const PROTOCOL_ID = 'content-recoverability:preregistered'
const SEGMENTER = 'seg-v2'
const SEED = sha256(`${PROTOCOL_ID}:${C0}:${C_EVAL}`)

const GENERATED = {
  frame: join(HERE, 'frame.json'),
  skeleton: join(HERE, 'units-skeleton.json'),
  segmentationAudit: join(HERE, 'segmentation-audit.json'),
  rewrites: join(HERE, 'rewrite-map.json'),
  controls: join(HERE, 'control-plan.json'),
  treeOnly: join(HERE, 'tree-only-ablation.json'),
  state: join(HERE, 'run-state.json'),
  manifest: join(HERE, 'freeze-manifest.json'),
  dry: join(HERE, 'runs', 'dry-report.json'),
}
const ANNOTATION_MANIFEST = join(HERE, 'annotation-freeze.json')
const ANNOTATION_ASSETS = [
  'annotation-feasibility-approval.json',
  'unit-cards.json',
  'fabricated-units.json',
  'tree-only-results.json',
  'style-probe.json',
  'judge-panel.json',
  'parent-dry-attestation.json',
  'annotation-state.json',
]
const MANUAL_ASSETS = [
  '.spec/spexcode/spec-eval/content-recoverability/spec.md',
  '.spec/spexcode/spec-eval/content-recoverability/eval.md',
  'docs/content-recoverability.md',
  'spec-eval/bench/reconstruction/recoverability/run.mjs',
  'spec-eval/bench/reconstruction/recoverability/schema.json',
  'spec-eval/bench/reconstruction/recoverability/taxonomy.json',
  'spec-eval/bench/reconstruction/recoverability/rubric.md',
  'spec-eval/bench/reconstruction/recoverability/unit-card.template.md',
  'spec-eval/bench/reconstruction/recoverability/segmentation-audit.md',
  'spec-eval/bench/reconstruction/recoverability/adversarial-critique-2.md',
  'spec-eval/bench/reconstruction/adversarial-critique.md',
  'spec-eval/bench/reconstruction/targets.json',
  'spec-eval/bench/reconstruction/run.ts',
  'docs/spec-reconstruction-bench.md',
]

const RULES = {
  moduleDescendantsMin: 2,
  moduleDescendantsMax: 8,
  moduleDepthMax: 2,
  moduleEligibleMin: 4,
  laterModuleBudgetMin: 5,
  laterModuleBudgetMax: 6,
  leafCalibrationCount: 2,
  taxonomyDevPoolNodes: 8,
  taxonomyDevPoolMinChars: 300,
  categoryKappaMin: 0.6,
  taxonomyRevisionLimit: 1,
  minCellClusters: 3,
  minCellUnits: 15,
  fabricatedRateMin: 0.10,
  fabricatedRateMax: 0.15,
  fabricatedRateTarget: 0.125,
  o0SelfRecallMin: 0.95,
  fabricatedFalseRecoveryMax: 0.10,
  latentRecoveryAuditAbove: 0.20,
  treeOnlyTriggerAt: 0.80,
  styleIdentityTriggerAbove: 0.70,
  fragmentAttachBelowChars: 24,
  segmenter: SEGMENTER,
}
const RESEARCH_CATEGORY = 'research-evidence'
const REQUIRED_TAXONOMY_PRECEDENCE = [
  'historical-incident',
  RESEARCH_CATEGORY,
  'design-rationale',
  'ownership-topology',
  'responsibility-boundary',
  'constraint-invariant',
  'operational-mechanism',
  'behavioral-contract',
]
const LEAF_CALIBRATION = [
  'spexcode/spec-cli/source-of-truth/spec-lint',
  'spexcode/spec-dashboard/dashboard-ui/mobile-ui',
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}
function rank(salt, value) {
  return sha256(`${SEED}:${salt}:${value}`)
}
function seededCompare(salt) {
  return (a, b) => rank(salt, a).localeCompare(rank(salt, b)) || a.localeCompare(b)
}
function rel(path) {
  return relative(REPO, path)
}
function readRepo(path) {
  return readFileSync(join(REPO, path))
}
function jsonRepo(path) {
  return JSON.parse(readRepo(path).toString('utf8'))
}
function hashAsset(path, role) {
  const bytes = readRepo(path)
  return { path, role, bytes: bytes.length, sha256: sha256(bytes) }
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8')
}

function makeC0Reader() {
  const audit = []
  const show = (path) => {
    audit.push({ ref: C0, path })
    try {
      return git(['show', `${C0}:${path}`])
    } catch {
      return null
    }
  }
  const list = (path) => {
    const pathspec = path || '.'
    audit.push({ ref: C0, path: `${pathspec} (ls-tree)` })
    return git(['ls-tree', '-r', '--name-only', C0, '--', pathspec]).split('\n').filter(Boolean)
  }
  return { audit, show, list }
}

function parseList(frontmatter, key) {
  const lines = frontmatter.split('\n')
  const at = lines.findIndex((line) => new RegExp(`^${key}:`).test(line))
  if (at < 0) return []
  const inline = lines[at].slice(lines[at].indexOf(':') + 1).trim()
  const clean = (value) => value.trim().replace(/^['"]|['"]$/g, '')
  if (inline) {
    if (inline.startsWith('[') && inline.endsWith(']')) {
      return inline.slice(1, -1).split(',').map(clean).filter(Boolean)
    }
    return [clean(inline)]
  }
  const values = []
  for (const line of lines.slice(at + 1)) {
    const match = line.match(/^\s+-\s+(.+)$/)
    if (!match) break
    values.push(clean(match[1]))
  }
  return values
}

function parseNode(raw) {
  let frontmatter = ''
  let body = raw
  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---\n', 4)
    if (end >= 0) {
      frontmatter = raw.slice(4, end)
      body = raw.slice(end + 5)
    }
  }
  const mentions = [...body.matchAll(/\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g)].map((match) => match[1].trim())
  return {
    code: parseList(frontmatter, 'code'),
    related: parseList(frontmatter, 'related'),
    mentions,
    prose: body.trim(),
  }
}

function globRegex(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') {
      source += '.*'
      i++
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

function resolveRef(rawRef, tracked) {
  const base = rawRef.split('#')[0].replace(/\/$/, '')
  const trackedSet = new Set(tracked)
  if (trackedSet.has(base)) return [base]
  if (/[*?]/.test(base)) {
    const matcher = globRegex(base)
    return tracked.filter((path) => matcher.test(path))
  }
  const prefix = `${base}/`
  return tracked.filter((path) => path.startsWith(prefix))
}

function hasHiddenSegment(relDir) {
  return relDir.split('/').some((segment) => segment.startsWith('.'))
}

function computeFrame(reader) {
  const targets = jsonRepo('spec-eval/bench/reconstruction/targets.json')
  if (targets.c0 !== C0 || targets.cEval !== C_EVAL) throw new Error('parent targets C0/C_eval no longer match this protocol')
  const packageRoots = targets.packagesRanked.map((row) => row.relDir).sort()
  const specPaths = reader.list('.spec').filter((path) => path.endsWith('/spec.md')).sort()
  const relDirs = specPaths.map((path) => path.slice('.spec/'.length, -'/spec.md'.length))
  const tracked = reader.list('').sort()
  const nodes = new Map()
  for (const relDir of relDirs) {
    const raw = reader.show(`.spec/${relDir}/spec.md`)
    if (raw === null) throw new Error(`missing C0 spec: ${relDir}`)
    nodes.set(relDir, parseNode(raw))
  }
  const descendants = (root) => relDirs.filter((path) => path.startsWith(`${root}/`))
  const directChildren = (root) => descendants(root).filter((path) => !path.slice(root.length + 1).includes('/'))
  const depthFrom = (root, path) => path.slice(root.length + 1).split('/').length
  const packageSizeGroups = new Map()
  for (const root of packageRoots) {
    const desc = descendants(root)
    const maxDepth = desc.length ? Math.max(...desc.map((path) => depthFrom(root, path))) : 0
    if (desc.length < RULES.moduleDescendantsMin || desc.length > RULES.moduleDescendantsMax || maxDepth > RULES.moduleDepthMax) continue
    const key = `${desc.length}:${maxDepth}`
    if (!packageSizeGroups.has(key)) packageSizeGroups.set(key, [])
    packageSizeGroups.get(key).push(root)
  }
  const candidates = []
  for (const root of relDirs.filter((path) => descendants(path).length > 0)) {
    const desc = descendants(root)
    const maxDepth = Math.max(...desc.map((path) => depthFrom(root, path)))
    const packageRoot = packageRoots.find((path) => root === path || root.startsWith(`${path}/`)) ?? null
    const kind = packageRoot === root ? 'size-matched-package' : packageRoot ? 'parent-subtree' : 'outside-package-roster'
    let exclusionReason = null
    if (hasHiddenSegment(root)) exclusionReason = 'hidden-path'
    else if (!packageRoot) exclusionReason = 'outside-frozen-package-roster'
    else if (desc.length < RULES.moduleDescendantsMin) exclusionReason = 'fewer-than-2-descendants'
    else if (desc.length > RULES.moduleDescendantsMax) exclusionReason = 'more-than-8-descendants'
    else if (maxDepth > RULES.moduleDepthMax) exclusionReason = 'depth-greater-than-2'
    else if (kind === 'size-matched-package') {
      const peers = packageSizeGroups.get(`${desc.length}:${maxDepth}`) ?? []
      if (peers.length < 2) exclusionReason = 'package-has-no-exact-size-match'
    }
    candidates.push({
      relDir: root,
      kind,
      packageRoot,
      descendantNodes: desc.length,
      totalNodes: desc.length + 1,
      directChildren: directChildren(root).length,
      maxDepth,
      status: exclusionReason ? 'excluded' : 'eligible',
      exclusionReason,
    })
  }
  const eligibleRoots = candidates.filter((row) => row.status === 'eligible').map((row) => row.relDir).sort()
  const overlapViolations = []
  for (const left of eligibleRoots) for (const right of eligibleRoots) {
    if (left !== right && right.startsWith(`${left}/`)) overlapViolations.push([left, right])
  }
  const idOwners = new Map()
  for (const relDir of relDirs) {
    const id = relDir.slice(relDir.lastIndexOf('/') + 1)
    if (!idOwners.has(id)) idOwners.set(id, [])
    idOwners.get(id).push(relDir)
  }
  const moduleCensus = []
  for (const root of eligibleRoots) {
    const memberPaths = [root, ...descendants(root)].sort()
    const memberSet = new Set(memberPaths)
    const memberIds = new Set(memberPaths.map((path) => path.slice(path.lastIndexOf('/') + 1)))
    const ownedRefs = new Set()
    const relatedRefs = new Set()
    const allRefs = new Set()
    let bodyChars = 0
    for (const path of memberPaths) {
      const node = nodes.get(path)
      bodyChars += node.prose.length
      node.code.forEach((ref) => { ownedRefs.add(ref); allRefs.add(ref) })
      node.related.forEach((ref) => { relatedRefs.add(ref); allRefs.add(ref) })
    }
    let inboundEdges = 0
    let outboundEdges = 0
    const inboundBreadcrumbs = []
    for (const [path, node] of nodes) {
      if (memberSet.has(path)) {
        for (const mention of node.mentions) if (idOwners.has(mention) && !memberIds.has(mention)) outboundEdges++
      } else {
        for (const mention of node.mentions) if (memberIds.has(mention)) {
          inboundEdges++
          inboundBreadcrumbs.push({ fromNode: path, mentionedId: mention })
        }
      }
    }
    const referencedFiles = new Set()
    const missingReferences = []
    for (const ref of [...allRefs].sort()) {
      const resolved = resolveRef(ref, tracked)
      if (!resolved.length) missingReferences.push(ref)
      resolved.forEach((path) => referencedFiles.add(path))
    }
    const ownedFiles = new Set()
    for (const ref of ownedRefs) resolveRef(ref, tracked).forEach((path) => ownedFiles.add(path))
    const externalRelatedRefs = [...relatedRefs].filter((ref) => resolveRef(ref, tracked).some((path) => !ownedFiles.has(path))).length
    let textLoc = 0
    const unreadableFiles = []
    for (const path of [...referencedFiles].sort()) {
      const content = reader.show(path)
      if (content === null) unreadableFiles.push(path)
      else textLoc += content === '' ? 0 : content.split('\n').length
    }
    const base = candidates.find((row) => row.relDir === root)
    moduleCensus.push({
      ...base,
      memberPaths,
      bodyChars,
      referencedFiles: referencedFiles.size,
      referencedTextLoc: textLoc,
      missingReferences,
      unreadableFiles,
      inboundEdges,
      inboundBreadcrumbs: inboundBreadcrumbs.sort((a, b) => a.fromNode.localeCompare(b.fromNode) || a.mentionedId.localeCompare(b.mentionedId)),
      outboundEdges,
      externalRelatedRefs,
      crossModuleCoupling: inboundEdges + outboundEdges + externalRelatedRefs,
      breadcrumbDensity: Number((inboundEdges / memberPaths.length).toFixed(4)),
      parentPilotTargetOverlap: targets.module.pair.some((target) => root === target.relDir),
      packageSizeGroup: base.kind === 'size-matched-package' ? `${base.descendantNodes}-descendants-depth-${base.maxDepth}` : null,
    })
  }
  const sampleNodes = new Set(moduleCensus.flatMap((module) => module.memberPaths))
  for (const leaf of LEAF_CALIBRATION) sampleNodes.add(leaf)
  const touchesSampleBranch = (path) => [...sampleNodes].some((sample) => sample === path || sample.startsWith(`${path}/`) || path.startsWith(`${sample}/`))
  const taxonomyDevPool = relDirs
    .filter((path) => !touchesSampleBranch(path) && !hasHiddenSegment(path) && nodes.get(path).prose.length >= RULES.taxonomyDevPoolMinChars)
    .sort(seededCompare('taxonomy-dev-pool'))
    .slice(0, RULES.taxonomyDevPoolNodes)
    .map((path) => ({ relDir: path, bodyChars: nodes.get(path).prose.length, bodySha256: sha256(nodes.get(path).prose) }))
  const leafCalibration = LEAF_CALIBRATION.map((path) => ({
    relDir: path,
    existsAtC0: nodes.has(path),
    bodyChars: nodes.get(path)?.prose.length ?? 0,
    archivedR0MayBeReadOnlyAfterAnnotationFreeze: true,
    runnerReadsArchivedR0: false,
    pooledWithModules: false,
  }))
  const auditViolations = reader.audit.filter((entry) => entry.ref !== C0 || /(^|\/)(runs|\.spec-recon)(\/|$)/.test(entry.path))
  const budgetWithinFrozenSurface = moduleCensus.length >= RULES.laterModuleBudgetMin && moduleCensus.length <= RULES.laterModuleBudgetMax
  return {
    v: 1,
    protocol: 'docs/content-recoverability.md',
    c0: C0,
    cEval: C_EVAL,
    seed: SEED,
    packageRosterSource: 'spec-eval/bench/reconstruction/targets.json#packagesRanked',
    rules: RULES,
    c0Nodes: relDirs.length,
    c0NodePaths: relDirs,
    candidates,
    eligibleModules: moduleCensus.length,
    modulePrimaryGo: moduleCensus.length >= RULES.moduleEligibleMin && overlapViolations.length === 0,
    overlapViolations,
    moduleCensus,
    censusStatement: 'All eligible modules enter; no module or unit sampling.',
    laterPilotBudget: {
      moduleReconstructions: moduleCensus.length,
      reusedLeafReconstructions: leafCalibration.length,
      budgetWithinFrozenSurface,
    },
    leafCalibration,
    taxonomyDevPool,
    taxonomyDevPoolStatement: 'Non-sample, non-sample-ancestor C0 nodes only; selected before sample labels and without R0.',
    sourceAudit: {
      reads: reader.audit.length,
      digest: sha256(reader.audit.map((entry) => `${entry.ref}:${entry.path}`).sort().join('\n')),
      violations: auditViolations,
    },
  }
}

function sentenceSplit(text) {
  const parts = []
  let start = 0
  const terminal = new Set(['.', '?', '!', '。', '？', '！'])
  const closing = new Set(['*', '_', '`', "'", '"', '”', '’', ')', ']', '}'])
  for (let index = 0; index < text.length; index++) {
    if (!terminal.has(text[index])) continue
    if (text[index] === '.') {
      const prefix = text.slice(Math.max(start, index - 5), index + 1)
      if (/\b(?:e\.g|i\.e|vs|etc)\.$/i.test(prefix) || /\d\.\d$/.test(text.slice(index - 1, index + 2))) continue
    }
    let end = index + 1
    while (end < text.length && closing.has(text[end])) end++
    if (end >= text.length || !/\s/.test(text[end])) continue
    let next = end
    while (next < text.length && /\s/.test(text[next])) next++
    if (next >= text.length) continue
    parts.push(text.slice(start, end).trim())
    start = next
    index = next - 1
  }
  parts.push(text.slice(start).trim())
  return parts.filter(Boolean).flatMap((part) => {
    const colon = part.search(/[:：]/)
    if (colon < 15 || colon > 180) return [part]
    const prefix = part.slice(0, colon + 1).trim()
    const branches = part.slice(colon + 1).split(';').map((branch) => branch.trim()).filter(Boolean)
    if (branches.length < 3 || branches.some((branch) => branch.length < 25)) return [part]
    return branches.map((branch) => `${prefix} ${branch.replace(/^else\s+/i, 'otherwise, ')}`)
  })
}

function startsAsContinuation(text) {
  const trimmed = text.trimStart()
  if (/^[a-z]/.test(trimmed)) return true
  const plain = trimmed.replace(/^[*_`'"([{]+/, '')
  return /^(?:and|or|but|because|which|并且?|以及|且|但|而)(?:\b|\s)/i.test(plain)
}

function segment(prose) {
  const emitted = []
  let paragraph = []
  let bullet = null
  let table = []
  let inFence = false
  let fencedBlocksExcluded = 0
  const emitText = (text) => emitted.push(...sentenceSplit(text.replace(/\s+/g, ' ').trim()))
  const flushParagraph = () => {
    if (!paragraph.length) return
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim()
    paragraph = []
    emitText(text)
  }
  const flushBullet = () => {
    if (bullet === null) return
    emitText(bullet)
    bullet = null
  }
  const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
  const flushTable = () => {
    if (!table.length) return
    const separatorAt = table.findIndex((row) => /^\|?[\s:|-]+\|?$/.test(row))
    if (separatorAt === 1) {
      const headers = cells(table[0])
      for (const row of table.slice(2)) {
        const values = cells(row)
        const statement = values.map((value, index) => {
          if (!value) return ''
          const header = headers[index] || `field-${index + 1}`
          return `${header.charAt(0).toUpperCase()}${header.slice(1)}: ${value}`
        }).filter(Boolean).join('; ')
        if (statement) emitted.push(statement)
      }
    } else {
      for (const row of table.filter((row) => !/^\|?[\s:|-]+\|?$/.test(row))) emitText(row)
    }
    table = []
  }
  const flushAll = () => {
    flushParagraph()
    flushBullet()
    flushTable()
  }
  for (const line of prose.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      flushAll()
      if (!inFence) fencedBlocksExcluded++
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^\s*#{1,6}\s/.test(line)) {
      flushAll()
      continue
    }
    if (!line.trim()) {
      flushAll()
      continue
    }
    if (/^\s*\|/.test(line)) {
      flushParagraph()
      flushBullet()
      table.push(line.trim())
      continue
    }
    flushTable()
    const bulletMatch = line.match(/^\s*(?:[-*+] |\d+[.)] )(.*)$/)
    if (bulletMatch) {
      flushParagraph()
      flushBullet()
      bullet = bulletMatch[1].replace(/\s+/g, ' ').trim()
      continue
    }
    if (/^\s{2,}\S/.test(line) && bullet !== null) {
      bullet = `${bullet} ${line.trim()}`.replace(/\s+/g, ' ')
      continue
    }
    flushBullet()
    paragraph.push(line.replace(/^\s*>\s?/, '').trim())
  }
  flushAll()
  const normalized = emitted.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const units = []
  for (let i = 0; i < normalized.length; i++) {
    const text = normalized[i]
    if ((text.length < 20 || startsAsContinuation(text)) && units.length) units[units.length - 1] = `${units[units.length - 1]} ${text}`
    else if ((text.length < 20 || startsAsContinuation(text)) && i + 1 < normalized.length) normalized[i + 1] = `${text} ${normalized[i + 1]}`
    else units.push(text)
  }
  return { units, fencedBlocksExcluded }
}

function computeSkeleton(reader, frame) {
  const specPaths = reader.list('.spec').filter((path) => path.endsWith('/spec.md')).sort()
  const relDirs = specPaths.map((path) => path.slice('.spec/'.length, -'/spec.md'.length))
  const clusters = []
  const collect = (cluster, scale) => {
    const sourceNodes = relDirs.filter((path) => path === cluster || path.startsWith(`${cluster}/`)).sort()
    const slotBySource = new Map([...sourceNodes].sort(seededCompare(`subject-slots:${cluster}`)).map((path, index) => [path, `component-${String(index + 1).padStart(2, '0')}`]))
    const units = []
    let ordinal = 0
    let fencedBlocksExcluded = 0
    for (const sourceNode of sourceNodes) {
      const raw = reader.show(`.spec/${sourceNode}/spec.md`)
      if (raw === null) throw new Error(`missing C0 spec while segmenting: ${sourceNode}`)
      const result = segment(parseNode(raw).prose)
      fencedBlocksExcluded += result.fencedBlocksExcluded
      for (const rawText of result.units) {
        const rawTextSha256 = sha256(rawText)
        const unitId = sha256(`${SEED}:${cluster}:${sourceNode}:${ordinal}:${rawText}`).slice(0, 16)
        units.push({ unitId, cluster, scale, sourceNode, subjectSlot: slotBySource.get(sourceNode), ordinal, rawText, rawTextSha256, chars: rawText.length })
        ordinal++
      }
    }
    clusters.push({ cluster, scale, sourceNodes, subjectSlots: Object.fromEntries([...slotBySource.entries()].sort(([a], [b]) => a.localeCompare(b))), unitCount: units.length, fencedBlocksExcluded, units })
  }
  for (const module of frame.moduleCensus) collect(module.relDir, 'module')
  for (const leaf of frame.leafCalibration) collect(leaf.relDir, 'leaf')
  return {
    v: 1,
    protocol: 'docs/content-recoverability.md',
    c0: C0,
    seed: SEED,
    segmenter: SEGMENTER,
    census: 'Every emitted unit in every sample node is retained; no unit sampling.',
    clusters,
  }
}

function unitGrainFlags(unit) {
  const flags = []
  if (unit.length < 20) flags.push('under-20-chars')
  if (unit.length > 600) flags.push('over-600-chars')
  if (/^\s*#{1,6}\s/.test(unit)) flags.push('heading')
  if (/^\s*\|/.test(unit)) flags.push('raw-table-row')
  if (startsAsContinuation(unit)) flags.push('dependent-start')
  return flags
}

function computeSegmentationAudit(reader, frame, skeleton, controls, taxonomy) {
  const devPool = frame.taxonomyDevPool.map(({ relDir }) => {
    const raw = reader.show(`.spec/${relDir}/spec.md`)
    if (raw === null) throw new Error(`missing dev-pool spec: ${relDir}`)
    const result = segment(parseNode(raw).prose)
    const units = result.units.map((text, ordinal) => ({ ordinal, chars: text.length, text, flags: unitGrainFlags(text) }))
    return { relDir, unitCount: units.length, fencedBlocksExcluded: result.fencedBlocksExcluded, units }
  })
  const sampleFlags = []
  for (const cluster of skeleton.clusters) for (const unit of cluster.units) {
    const flags = unitGrainFlags(unit.rawText)
    if (flags.length) sampleFlags.push({ unitId: unit.unitId, cluster: cluster.cluster, flags })
  }
  const devFlags = devPool.flatMap((node) => node.units.filter((unit) => unit.flags.length).map((unit) => ({ relDir: node.relDir, ordinal: unit.ordinal, flags: unit.flags })))
  const moduleCounts = skeleton.clusters.filter((cluster) => cluster.scale === 'module').map((cluster) => ({
    cluster: cluster.cluster,
    units: cluster.unitCount,
    suggestedRange: [60, 120],
    diagnostic: cluster.unitCount < 60 ? 'below-suggested' : cluster.unitCount > 120 ? 'above-suggested' : 'within-suggested',
  }))
  const leafCounts = skeleton.clusters.filter((cluster) => cluster.scale === 'leaf').map((cluster) => ({
    cluster: cluster.cluster,
    units: cluster.unitCount,
    suggestedRange: [20, 30],
    diagnostic: cluster.unitCount < 20 ? 'below-suggested' : cluster.unitCount > 30 ? 'above-suggested' : 'within-suggested',
  }))
  const realUnits = skeleton.clusters.reduce((sum, cluster) => sum + cluster.unitCount, 0)
  const fabricatedUnits = Object.values(controls.fabricatedByScale).reduce((sum, row) => sum + (row.fabricatedCount ?? 0), 0)
  return {
    v: 2,
    protocol: 'docs/content-recoverability.md',
    c0: C0,
    segmenter: SEGMENTER,
    validationSurface: 'deterministic non-sample, non-sample-ancestor taxonomy dev pool',
    mechanicalGate: {
      forbidden: ['under-20-chars', 'over-600-chars', 'heading', 'raw-table-row', 'dependent-start'],
      devPoolFailures: devFlags,
      sampleFailures: sampleFlags,
      passed: devFlags.length === 0 && sampleFlags.length === 0,
    },
    categoryBoundaryControl: {
      category: RESEARCH_CATEGORY,
      primaryEligible: taxonomy.categories.find((category) => category.id === RESEARCH_CATEGORY)?.primaryEligible ?? null,
      precedenceAfter: 'historical-incident',
      precedenceBefore: 'design-rationale',
      definition: 'Frozen experiment, benchmark, measurement, comparison, or systematic-observation result/conclusion; distinct from contract, rationale, mechanism, and incident.',
      sampleLabelsAssigned: 0,
      sparseFixture: { scale: 'module', clusters: 2, units: 8, expectedStatus: 'insufficient', rateForbidden: true },
    },
    moduleCounts,
    leafCounts,
    annotationBudget: {
      realUnitCards: realUnits,
      independentRealLabels: realUnits * 2,
      fabricatedUnits,
      independentFabricatedVerifications: fabricatedUnits * 2,
      minimumIndependentDecisionsBeforeAdjudication: realUnits * 2 + fabricatedUnits * 2,
      possibleAdjudications: realUnits,
      unitSampling: 0,
    },
    devPool,
  }
}

const REWRITE_RULES = [
  ['legacy-readings-ledger', /yatsu\.evals\.ndjson/gi, 'the evaluation readings ledger'],
  ['legacy-scenario-contract', /yatsu\.md/gi, 'the evaluation scenario contract'],
  ['legacy-needs-evaluation', /needs-yatsu-eval/gi, 'needs-evaluation'],
  ['legacy-evaluation-core', /yatsu-core/gi, 'the evaluation core'],
  ['legacy-evaluation-package', /spec-yatsu/gi, 'the evaluation package'],
  ['legacy-evaluation-term', /\byatsu\b/gi, 'evaluation'],
  ['legacy-plugin-config', /(^|[^\w])\.config(?=\/|\b)/g, '$1the plugin configuration surface'],
  ['wiki-component-anonymization', /\[\[[^\]\n]+\]\]/g, 'the referenced component'],
]
const LEGACY_TOKEN = /\byatsu\b|spec-yatsu|yatsu-core|yatsu\.md|yatsu\.evals\.ndjson|needs-yatsu-eval|(^|[^\w])\.config(?=\/|\b)/i

function rewriteText(rawText) {
  let text = rawText
  const appliedRules = []
  for (const [id, pattern, replacement] of REWRITE_RULES) {
    pattern.lastIndex = 0
    if (pattern.test(text)) {
      pattern.lastIndex = 0
      text = text.replace(pattern, replacement)
      appliedRules.push(id)
    }
  }
  return { rewriteText: text.replace(/\s+/g, ' ').trim(), appliedRules }
}

function computeRewrites(skeleton) {
  const rows = []
  const residualLegacy = []
  const byRewrite = new Map()
  for (const cluster of skeleton.clusters) for (const unit of cluster.units) {
    const rewritten = rewriteText(unit.rawText)
    const rewriteId = sha256(`${SEED}:rewrite:${unit.unitId}:${rewritten.rewriteText}`).slice(0, 16)
    const row = { unitId: unit.unitId, rawTextSha256: unit.rawTextSha256, rewriteId, rewriteText: rewritten.rewriteText, appliedRules: rewritten.appliedRules }
    rows.push(row)
    if (LEGACY_TOKEN.test(row.rewriteText)) residualLegacy.push(unit.unitId)
    if (!byRewrite.has(row.rewriteText)) byRewrite.set(row.rewriteText, new Set())
    byRewrite.get(row.rewriteText).add(row.rawTextSha256)
  }
  const collisions = [...byRewrite.entries()]
    .filter(([, rawHashes]) => rawHashes.size > 1)
    .map(([text, rawHashes]) => ({ rewriteTextSha256: sha256(text), distinctRawHashes: [...rawHashes].sort() }))
  return {
    v: 1,
    protocol: 'docs/content-recoverability.md',
    c0: C0,
    rules: REWRITE_RULES.map(([id, pattern, replacement]) => ({ id, pattern: pattern.source, flags: pattern.flags, replacement })),
    rows,
    uniqueness: { distinctRows: rows.length, collisions },
    residualLegacy,
  }
}

function fabricatedCount(realUnits) {
  let best = null
  for (let count = 1; count <= Math.max(1, Math.ceil(realUnits / 4)); count++) {
    const rate = count / (realUnits + count)
    if (rate < RULES.fabricatedRateMin || rate > RULES.fabricatedRateMax) continue
    const distance = Math.abs(rate - RULES.fabricatedRateTarget)
    if (!best || distance < best.distance || (distance === best.distance && count < best.count)) best = { count, rate, distance }
  }
  return best
}

function derangedSlots(sourceNodes, salt) {
  const ordered = [...sourceNodes].sort(seededCompare(salt))
  if (ordered.length < 2) return []
  return ordered.map((source, index) => ({ source, target: ordered[(index + 1) % ordered.length] }))
}

function allocateFabricated(clusters) {
  const realUnits = clusters.reduce((sum, cluster) => sum + cluster.unitCount, 0)
  const target = fabricatedCount(realUnits)
  if (!target) return { realUnits, fabricatedCount: null, rate: null, allocations: new Map() }
  const rows = clusters.map((cluster) => {
    const exact = target.count * cluster.unitCount / realUnits
    return { cluster: cluster.cluster, exact, count: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let remaining = target.count - rows.reduce((sum, row) => sum + row.count, 0)
  const remainderOrder = [...rows].sort((a, b) => b.remainder - a.remainder || seededCompare('fabricated-allocation')(a.cluster, b.cluster))
  for (let index = 0; index < remaining; index++) remainderOrder[index % remainderOrder.length].count++
  return { realUnits, fabricatedCount: target.count, rate: target.rate, allocations: new Map(rows.map((row) => [row.cluster, row.count])) }
}

function computeControls(frame, skeleton, taxonomy) {
  const moduleClusters = skeleton.clusters.filter((cluster) => cluster.scale === 'module')
  const leafClusters = skeleton.clusters.filter((cluster) => cluster.scale === 'leaf')
  const byScale = {
    module: allocateFabricated(moduleClusters),
    leaf: allocateFabricated(leafClusters),
  }
  const nearestDistractor = (cluster, pool) => pool
    .filter((candidate) => candidate.cluster !== cluster.cluster)
    .sort((a, b) => Math.abs(a.unitCount - cluster.unitCount) - Math.abs(b.unitCount - cluster.unitCount)
      || seededCompare(`distractor:${cluster.cluster}`)(a.cluster, b.cluster))[0]?.cluster ?? null
  const clusters = skeleton.clusters.map((cluster) => {
    const pool = cluster.scale === 'module' ? moduleClusters : leafClusters
    const fabricated = byScale[cluster.scale].allocations.get(cluster.cluster) ?? 0
    return {
      cluster: cluster.cluster,
      scale: cluster.scale,
      realUnits: cluster.unitCount,
      bundles: ['R0', 'O0-self', 'distractor', 'shuffled-original'],
      distractorCluster: nearestDistractor(cluster, pool),
      shuffledSlotMap: derangedSlots(cluster.sourceNodes, `shuffle-slots:${cluster.cluster}`),
      fabricatedCount: fabricated,
      fabricatedSlots: Array.from({ length: fabricated }, (_, index) => ({
        fabricatedId: sha256(`${SEED}:fabricated:${cluster.cluster}:${index}`).slice(0, 16),
        ordinal: index,
      })),
      treeOnly: cluster.scale === 'module' ? {
        input: 'retained external C0 tree and inbound breadcrumbs only; masked subtree and all code absent',
        output: 'deterministic topology/ownership claims only; zero paid/model calls',
        compare: 'full topology/ownership recovery divided by R0 full topology/ownership recovery',
        triggerAt: RULES.treeOnlyTriggerAt,
        response: 'scrub/stub inbound breadcrumbs and remeasure, or demote topology/ownership to secondary',
      } : null,
    }
  })
  return {
    v: 2,
    protocol: 'docs/content-recoverability.md',
    seed: SEED,
    frozenBeforeR0: true,
    blindVerdicts: ['full', 'partial', 'absent', 'contradicted'],
    primaryVerdict: 'full',
    thresholds: {
      o0SelfRecallMin: RULES.o0SelfRecallMin,
      fabricatedFalseRecoveryMax: RULES.fabricatedFalseRecoveryMax,
      latentRecoveryAuditAbove: RULES.latentRecoveryAuditAbove,
      treeOnlyTriggerAt: RULES.treeOnlyTriggerAt,
      styleIdentityTriggerAbove: RULES.styleIdentityTriggerAbove,
    },
    categoryControls: {
      requiredPrecedence: REQUIRED_TAXONOMY_PRECEDENCE,
      researchEvidence: {
        category: RESEARCH_CATEGORY,
        primaryEligible: taxonomy.categories.find((category) => category.id === RESEARCH_CATEGORY)?.primaryEligible ?? null,
        cannotFoldInto: ['design-rationale', 'operational-mechanism', 'historical-incident'],
        sparseFixture: { scale: 'module', clusters: 2, units: 8, expectedStatus: 'insufficient', rateForbidden: true },
      },
    },
    fabricatedByScale: Object.fromEntries(Object.entries(byScale).map(([scale, row]) => [scale, {
      realUnits: row.realUnits,
      fabricatedCount: row.fabricatedCount,
      fabricatedRateOfAllProbes: row.rate === null ? null : Number(row.rate.toFixed(6)),
      allocation: Object.fromEntries([...row.allocations.entries()].sort(([a], [b]) => a.localeCompare(b))),
    }])),
    moduleBreadcrumbDensity: Object.fromEntries(frame.moduleCensus.map((module) => [module.relDir, module.breadcrumbDensity])),
    clusters,
  }
}

function computeState(frame) {
  return {
    v: 1,
    protocol: 'docs/content-recoverability.md',
    phase: 'pre-registration',
    laterPilotBudget: frame.laterPilotBudget,
    effectiveModuleR0: 0,
    moduleR0Generated: 0,
    moduleR0Read: 0,
    paidRunsStarted: 0,
    networkCallsMade: 0,
    archivedLeafR0ReadByRunner: false,
    treeOnlyAblationsGenerated: frame.moduleCensus.length,
    treeOnlyModelCalls: 0,
    annotationFeasibilityApproved: false,
    annotationAssetsPresent: false,
    statement: 'This runner has no model, network, or reconstruction command. Counts describe this protocol commit.',
  }
}

function computeTreeOnly(frame) {
  const allC0Paths = frame.c0NodePaths
  const modules = frame.moduleCensus.map((module) => {
    const masked = new Set(module.memberPaths)
    const retainedTreePaths = allC0Paths.filter((path) => !masked.has(path)).sort()
    const inferredComponentIds = [...new Set(module.inboundBreadcrumbs.map((row) => row.mentionedId))].sort()
    return {
      cluster: module.relDir,
      input: {
        retainedTreePaths,
        inboundBreadcrumbs: module.inboundBreadcrumbs,
        codeVisible: false,
        maskedBodiesVisible: false,
      },
      deterministicClaims: {
        inferredComponentIds,
        targetOwnershipClaims: inferredComponentIds.map((componentId) => ({ componentId, claim: 'belongs-to-masked-target' })),
        internalParentChildClaims: [],
        responsibilityClaims: [],
      },
      breadcrumbDensity: module.breadcrumbDensity,
      modelCalls: 0,
      paidCalls: 0,
    }
  })
  return {
    v: 1,
    protocol: 'docs/content-recoverability.md',
    c0: C0,
    method: 'tree-only-v1: retained C0 node paths plus external inbound wiki mentions; emit only mechanically entailed component-existence and masked-target ownership claims',
    codeVisible: false,
    maskedBodiesVisible: false,
    modelCalls: 0,
    networkCalls: 0,
    modules,
  }
}

function buildFrozen() {
  const frameReader = makeC0Reader()
  const frame = computeFrame(frameReader)
  const skeletonReader = makeC0Reader()
  const skeleton = computeSkeleton(skeletonReader, frame)
  const taxonomy = jsonRepo('spec-eval/bench/reconstruction/recoverability/taxonomy.json')
  const schema = jsonRepo('spec-eval/bench/reconstruction/recoverability/schema.json')
  const rewrites = computeRewrites(skeleton)
  const controls = computeControls(frame, skeleton, taxonomy)
  const segmentationAudit = computeSegmentationAudit(makeC0Reader(), frame, skeleton, controls, taxonomy)
  const treeOnly = computeTreeOnly(frame)
  const state = computeState(frame)
  const violations = []
  const researchCategory = taxonomy.categories.find((category) => category.id === RESEARCH_CATEGORY)
  if (!researchCategory?.primaryEligible) violations.push('taxonomy must include primary research-evidence')
  if (JSON.stringify(taxonomy.assignmentPrecedence) !== JSON.stringify(REQUIRED_TAXONOMY_PRECEDENCE)) violations.push('taxonomy precedence must keep research-evidence after incident and before rationale')
  if (!schema.taxonomy?.primaryCategories?.includes(RESEARCH_CATEGORY) || schema.taxonomy?.secondaryOnlyCategories?.includes(RESEARCH_CATEGORY)) violations.push('schema must expose research-evidence as a primary category')
  if (!frame.modulePrimaryGo) violations.push(`module-primary NO-GO: eligible=${frame.eligibleModules}, overlaps=${frame.overlapViolations.length}`)
  if (!frame.laterPilotBudget.budgetWithinFrozenSurface) violations.push(`later module budget must be 5-6, got ${frame.eligibleModules}`)
  if (frame.leafCalibration.length !== RULES.leafCalibrationCount || frame.leafCalibration.some((leaf) => !leaf.existsAtC0)) violations.push('leaf calibration frame is incomplete')
  if (frame.taxonomyDevPool.length !== RULES.taxonomyDevPoolNodes) violations.push(`taxonomy dev pool expected ${RULES.taxonomyDevPoolNodes} nodes`)
  if (frame.sourceAudit.violations.length) violations.push('C0 source audit contains forbidden reads')
  if (rewrites.residualLegacy.length) violations.push(`rewrite residual legacy tokens: ${rewrites.residualLegacy.join(',')}`)
  if (rewrites.uniqueness.collisions.length) violations.push(`rewrite uniqueness collisions: ${rewrites.uniqueness.collisions.length}`)
  if (!segmentationAudit.mechanicalGate.passed) violations.push(`segmentation grain audit failed: dev=${segmentationAudit.mechanicalGate.devPoolFailures.length}, sample=${segmentationAudit.mechanicalGate.sampleFailures.length}`)
  for (const module of treeOnly.modules) {
    const census = frame.moduleCensus.find((row) => row.relDir === module.cluster)
    if (!census || module.input.retainedTreePaths.length !== frame.c0Nodes - census.totalNodes) violations.push(`tree-only retained tree is incomplete for ${module.cluster}`)
  }
  for (const cluster of controls.clusters) {
    if (!cluster.distractorCluster) violations.push(`no distractor for ${cluster.cluster}`)
    if (cluster.shuffledSlotMap.some((row) => row.source === row.target)) violations.push(`shuffle has fixed slot for ${cluster.cluster}`)
  }
  for (const [scale, row] of Object.entries(controls.fabricatedByScale)) if (row.fabricatedCount === null) violations.push(`no integer fabricated count in [10%,15%] for ${scale} scale`)
  const generatedBytes = {
    [rel(GENERATED.frame)]: stableJson(frame),
    [rel(GENERATED.skeleton)]: stableJson(skeleton),
    [rel(GENERATED.segmentationAudit)]: stableJson(segmentationAudit),
    [rel(GENERATED.rewrites)]: stableJson(rewrites),
    [rel(GENERATED.controls)]: stableJson(controls),
    [rel(GENERATED.treeOnly)]: stableJson(treeOnly),
    [rel(GENERATED.state)]: stableJson(state),
  }
  const assetRows = [
    ...MANUAL_ASSETS.map((path) => hashAsset(path, path.includes('adversarial-critique') ? 'frozen-critique-or-parent-input' : 'manual-protocol-input')),
    ...Object.entries(generatedBytes).map(([path, bytes]) => ({ path, role: 'deterministic-generated-output', bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) })),
  ].sort((a, b) => a.path.localeCompare(b.path))
  const protocolFreezeSha256 = sha256(stableJson(assetRows))
  const manifest = {
    v: 1,
    protocol: 'docs/content-recoverability.md',
    c0: C0,
    cEval: C_EVAL,
    seed: SEED,
    protocolFreezeSha256,
    assets: assetRows,
    writeOrder: ['eligibility/frame', 'segmentation/unit census', 'legacy rewrite', 'control plan', 'zero-R0 state', 'exact-byte manifest'],
    reconstructionPrecondition: 'This manifest AND a later annotation-freeze.json must both pass --check before any module R0.',
  }
  generatedBytes[rel(GENERATED.manifest)] = stableJson(manifest)
  return { frame, skeleton, segmentationAudit, rewrites, controls, treeOnly, state, manifest, generatedBytes, violations }
}

function writeFrozen() {
  const built = buildFrozen()
  if (built.violations.length) {
    built.violations.forEach((violation) => console.error(`freeze violation: ${violation}`))
    if (built.segmentationAudit && !built.segmentationAudit.mechanicalGate.passed) {
      for (const row of built.segmentationAudit.mechanicalGate.devPoolFailures) {
        const unit = built.segmentationAudit.devPool.find((node) => node.relDir === row.relDir)?.units.find((candidate) => candidate.ordinal === row.ordinal)
        console.error(`dev grain failure: ${row.relDir}#${row.ordinal} [${row.flags.join(',')}] ${JSON.stringify(unit?.text)}`)
      }
      const units = new Map(built.skeleton.clusters.flatMap((cluster) => cluster.units.map((unit) => [unit.unitId, unit])))
      for (const row of built.segmentationAudit.mechanicalGate.sampleFailures) console.error(`sample grain failure: ${row.unitId} [${row.flags.join(',')}] ${JSON.stringify(units.get(row.unitId)?.rawText)}`)
    }
    return 1
  }
  for (const [path, bytes] of Object.entries(built.generatedBytes)) writeFileSync(join(REPO, path), bytes)
  const moduleUnits = built.skeleton.clusters.filter((cluster) => cluster.scale === 'module').reduce((sum, cluster) => sum + cluster.unitCount, 0)
  const leafUnits = built.skeleton.clusters.filter((cluster) => cluster.scale === 'leaf').reduce((sum, cluster) => sum + cluster.unitCount, 0)
  console.log(`freeze write ok: modules=${built.frame.eligibleModules} moduleUnits=${moduleUnits} leaves=2 leafUnits=${leafUnits}`)
  console.log(`protocolFreezeSha256=${built.manifest.protocolFreezeSha256}`)
  console.log('effectiveModuleR0=0 paidRuns=0 networkCalls=0')
  return 0
}

function checkFrozen(quiet = false) {
  const built = buildFrozen()
  const failures = [...built.violations]
  for (const [path, expected] of Object.entries(built.generatedBytes)) {
    const full = join(REPO, path)
    if (!existsSync(full)) failures.push(`${path}: missing`)
    else if (!readFileSync(full).equals(Buffer.from(expected))) failures.push(`${path}: byte mismatch`)
  }
  if (failures.length) {
    if (!quiet) failures.forEach((failure) => console.error(`freeze check failed: ${failure}`))
    return { rc: 1, failures, built }
  }
  if (!quiet) {
    console.log(`freeze check ok: ${Object.keys(built.generatedBytes).length} files byte-stable`)
    console.log(`protocolFreezeSha256=${built.manifest.protocolFreezeSha256}`)
    console.log('effectiveModuleR0=0')
  }
  return { rc: 0, failures, built }
}

function cohenKappa(left, right) {
  if (left.length !== right.length || !left.length) return Number.NaN
  const labels = [...new Set([...left, ...right])]
  const observed = left.filter((label, index) => label === right[index]).length / left.length
  const expected = labels.reduce((sum, label) => {
    const lp = left.filter((value) => value === label).length / left.length
    const rp = right.filter((value) => value === label).length / right.length
    return sum + lp * rp
  }, 0)
  return expected === 1 ? 1 : (observed - expected) / (1 - expected)
}

function exactKeys(object, allowed, label, failures) {
  const extras = Object.keys(object).filter((key) => !allowed.includes(key))
  if (extras.length) failures.push(`${label}: unknown keys ${extras.join(',')}`)
}

function validateAnnotations(built) {
  const failures = []
  const missing = ANNOTATION_ASSETS.filter((path) => !existsSync(join(HERE, path)))
  if (missing.length) return { failures: missing.map((path) => `${path}: missing`), summary: null }
  const schema = jsonRepo('spec-eval/bench/reconstruction/recoverability/schema.json')
  const taxonomy = jsonRepo('spec-eval/bench/reconstruction/recoverability/taxonomy.json')
  const categoryIds = new Set(taxonomy.categories.map((category) => category.id))
  const feasibility = JSON.parse(readFileSync(join(HERE, 'annotation-feasibility-approval.json'), 'utf8'))
  const cards = JSON.parse(readFileSync(join(HERE, 'unit-cards.json'), 'utf8'))
  const fabricated = JSON.parse(readFileSync(join(HERE, 'fabricated-units.json'), 'utf8'))
  const treeOnly = JSON.parse(readFileSync(join(HERE, 'tree-only-results.json'), 'utf8'))
  const style = JSON.parse(readFileSync(join(HERE, 'style-probe.json'), 'utf8'))
  const panel = JSON.parse(readFileSync(join(HERE, 'judge-panel.json'), 'utf8'))
  const parentDry = JSON.parse(readFileSync(join(HERE, 'parent-dry-attestation.json'), 'utf8'))
  const state = JSON.parse(readFileSync(join(HERE, 'annotation-state.json'), 'utf8'))
  const skeletonUnits = built.skeleton.clusters.flatMap((cluster) => cluster.units)
  exactKeys(feasibility, schema.annotationFeasibilityApproval.keys, 'annotation feasibility approval', failures)
  if (feasibility.decision !== 'approve-full-census' || !feasibility.approvedBy || !feasibility.approvedAt) failures.push('annotation feasibility requires explicit human approve-full-census')
  if (feasibility.protocolFreezeSha256 !== built.manifest.protocolFreezeSha256) failures.push('annotation feasibility approval does not bind current protocol freeze')
  const frozenBurden = built.segmentationAudit.annotationBudget
  const moduleUnits = built.skeleton.clusters.filter((cluster) => cluster.scale === 'module').reduce((sum, cluster) => sum + cluster.unitCount, 0)
  if (feasibility.moduleUnits !== moduleUnits || feasibility.realUnitCards !== frozenBurden.realUnitCards || feasibility.minimumIndependentDecisions !== frozenBurden.minimumIndependentDecisionsBeforeAdjudication) failures.push('annotation feasibility approval counts do not match frozen census')
  const skeletonById = new Map(skeletonUnits.map((unit) => [unit.unitId, unit]))
  if (!Array.isArray(cards) || cards.length !== skeletonUnits.length) failures.push(`unit-cards: expected ${skeletonUnits.length} cards`)
  const seen = new Set()
  const left = []
  const right = []
  if (Array.isArray(cards)) for (const card of cards) {
    exactKeys(card, schema.unitCard.keys, `card ${card.unitId ?? '<missing>'}`, failures)
    const unit = skeletonById.get(card.unitId)
    if (!unit) failures.push(`card ${card.unitId}: not in skeleton`)
    if (seen.has(card.unitId)) failures.push(`card ${card.unitId}: duplicate`)
    seen.add(card.unitId)
    if (unit && (card.rawTextSha256 !== unit.rawTextSha256 || card.cluster !== unit.cluster || card.scale !== unit.scale || card.sourceNode !== unit.sourceNode || card.subjectSlot !== unit.subjectSlot || card.ordinal !== unit.ordinal)) failures.push(`card ${card.unitId}: skeleton binding mismatch`)
    if (!Array.isArray(card.labels) || card.labels.length !== 2 || card.labels[0]?.annotator === card.labels[1]?.annotator) failures.push(`card ${card.unitId}: requires two distinct annotators`)
    else {
      card.labels.forEach((label, index) => {
        exactKeys(label, schema.unitCard.labelKeys, `card ${card.unitId} label ${index}`, failures)
        if (!schema.unitCard.stratum.includes(label.stratum)) failures.push(`card ${card.unitId}: invalid stratum`)
        if (!categoryIds.has(label.taxonomy)) failures.push(`card ${card.unitId}: invalid taxonomy`)
        if (!schema.unitCard.structuralFacet.includes(label.structuralFacet)) failures.push(`card ${card.unitId}: invalid structural facet`)
        if (label.stratum === 'A-supported' && (!Array.isArray(label.evidenceRefs) || !label.evidenceRefs.length)) failures.push(`card ${card.unitId}: A label lacks C0 evidence`)
      })
      left.push(card.labels[0].taxonomy)
      right.push(card.labels[1].taxonomy)
    }
    if (!card.adjudication || !categoryIds.has(card.adjudication.taxonomy) || !schema.unitCard.stratum.includes(card.adjudication.stratum)) failures.push(`card ${card.unitId}: invalid adjudication`)
  }
  const categoryKappa = cohenKappa(left, right)
  if (!Number.isFinite(categoryKappa) || categoryKappa < RULES.categoryKappaMin) failures.push(`category kappa ${categoryKappa} below ${RULES.categoryKappaMin}`)
  if (state.taxonomyRevisionRound > RULES.taxonomyRevisionLimit) failures.push('taxonomy revision limit exceeded')
  if (state.moduleR0AtFreeze !== 0) failures.push('moduleR0AtFreeze must equal 0')
  if (state.phaseLeafR0ReadBeforeFreeze !== false) failures.push('phaseLeafR0ReadBeforeFreeze must equal false')
  const fabricatedPlan = new Map(built.controls.clusters.map((cluster) => [cluster.cluster, cluster.fabricatedCount]))
  if (!Array.isArray(fabricated)) failures.push('fabricated-units must be an array')
  else for (const [cluster, count] of fabricatedPlan) {
    const rows = fabricated.filter((row) => row.cluster === cluster)
    if (rows.length !== count) failures.push(`fabricated ${cluster}: expected ${count}, got ${rows.length}`)
    for (const row of rows) if (!Array.isArray(row.verifiers) || new Set(row.verifiers).size !== 2) failures.push(`fabricated ${row.fabricatedId}: requires two distinct verifiers`)
  }
  const moduleRoots = new Set(built.frame.moduleCensus.map((module) => module.relDir))
  if (!Array.isArray(treeOnly) || new Set(treeOnly.map((row) => row.cluster)).size !== moduleRoots.size || treeOnly.some((row) => !moduleRoots.has(row.cluster))) failures.push('tree-only-results must cover every module exactly once')
  if (typeof style.accuracy !== 'number' || style.accuracy > RULES.styleIdentityTriggerAbove) failures.push(`style identity accuracy must be <=${RULES.styleIdentityTriggerAbove}`)
  const humans = panel.judges?.filter((judge) => judge.kind === 'human') ?? []
  const models = panel.judges?.filter((judge) => judge.kind === 'model') ?? []
  if (humans.length < 1 || models.length < 2 || new Set(models.map((judge) => judge.family)).size < 2) failures.push('judge panel requires one human and two distinct model families')
  if (models.some((judge) => /openai|gpt-?5\.5/i.test(judge.family))) failures.push('constructor family appears in judge panel')
  if (parentDry.c0 !== C0 || parentDry.rc !== 0 || parentDry.networkCalls !== 0 || parentDry.modelCalls !== 0) failures.push('parent dry attestation invalid')
  return { failures, summary: { categoryKappa: Number(categoryKappa.toFixed(6)), taxonomyRevisionRound: state.taxonomyRevisionRound, moduleR0AtFreeze: state.moduleR0AtFreeze, phaseLeafR0ReadBeforeFreeze: state.phaseLeafR0ReadBeforeFreeze } }
}

function annotationManifest(built, summary) {
  const assets = ANNOTATION_ASSETS.map((path) => hashAsset(`spec-eval/bench/reconstruction/recoverability/${path}`, 'blind-pre-R0-annotation')).sort((a, b) => a.path.localeCompare(b.path))
  return {
    v: 1,
    protocolFreezeSha256: built.manifest.protocolFreezeSha256,
    assets,
    ...summary,
  }
}

function labelsCommand(flag) {
  const frozen = checkFrozen(true)
  if (frozen.rc !== 0) {
    frozen.failures.forEach((failure) => console.error(`labels blocked: protocol freeze ${failure}`))
    return 1
  }
  const validation = validateAnnotations(frozen.built)
  if (validation.failures.length) {
    validation.failures.forEach((failure) => console.error(`labels blocked: ${failure}`))
    return 1
  }
  const bytes = stableJson(annotationManifest(frozen.built, validation.summary))
  if (flag === '--write') {
    writeFileSync(ANNOTATION_MANIFEST, bytes)
    console.log(`labels freeze write ok: kappa=${validation.summary.categoryKappa} moduleR0AtFreeze=0`)
    return 0
  }
  if (!existsSync(ANNOTATION_MANIFEST) || !readFileSync(ANNOTATION_MANIFEST).equals(Buffer.from(bytes))) {
    console.error('labels check failed: annotation-freeze.json missing or byte mismatch')
    return 1
  }
  console.log(`labels check ok: ${ANNOTATION_ASSETS.length} assets byte-stable, moduleR0AtFreeze=0`)
  return 0
}

const PACKET_KEYS = ['v', 'packetId', 'statement', 'candidates']
const CANDIDATE_KEYS = ['candId', 'text']
const PACKET_FORBIDDEN = ['A-supported', 'B-latent', 'S-stale-contradicted', 'O0-self', 'R0', 'distractor', 'shuffled-original', 'taxonomy', 'constructorFamily', SEED]

function packetScan(packetBytes, labelMapBytes, knownNodeIds = []) {
  const failures = []
  let parsed
  try { parsed = JSON.parse(packetBytes) } catch { return ['packet invalid JSON'] }
  for (const packet of parsed.packets ?? []) {
    const packetExtras = Object.keys(packet).filter((key) => !PACKET_KEYS.includes(key))
    if (packetExtras.length) failures.push(`packet unknown keys ${packetExtras.join(',')}`)
    for (const candidate of packet.candidates ?? []) {
      const extras = Object.keys(candidate).filter((key) => !CANDIDATE_KEYS.includes(key))
      if (extras.length) failures.push(`candidate unknown keys ${extras.join(',')}`)
    }
  }
  for (const token of [...PACKET_FORBIDDEN, ...knownNodeIds]) if (token && packetBytes.includes(token)) failures.push(`packet leaks ${token}`)
  if (packetBytes.includes(labelMapBytes.trim())) failures.push('packet embeds label map')
  if (!packetBytes.includes(sha256(labelMapBytes))) failures.push('packet lacks label-map commitment')
  return failures
}

function makePacketFixture(kind) {
  const labelMap = stableJson({ p1: { c1: 'candidate-a', c2: 'candidate-b' } })
  const packet = {
    v: 1,
    packetId: 'p1',
    statement: 'The command leaves committed state unchanged after a rejected update.',
    candidates: [
      { candId: 'c1', text: 'A rejected update exits before committed state changes.' },
      { candId: 'c2', text: 'The palette cache is refreshed after a theme switch.' },
    ],
  }
  if (kind === 'negative') packet.arm = 'R0'
  const bytes = stableJson({ v: 1, packets: [packet], labelMapCommitment: sha256(labelMap) })
  return { bytes, labelMap }
}

function aggregateFixture(includeForbidden = false) {
  const rows = []
  const add = (cluster, scale, category, count, full) => {
    for (let index = 0; index < count; index++) rows.push({ cluster, scale, category, verdict: index < full ? 'full' : 'absent' })
  }
  add('m1', 'module', 'behavioral-contract', 6, 4)
  add('m2', 'module', 'behavioral-contract', 6, 3)
  add('m3', 'module', 'behavioral-contract', 6, 5)
  add('m1', 'module', 'design-rationale', 5, 2)
  add('m2', 'module', 'design-rationale', 5, 3)
  add('m1', 'module', RESEARCH_CATEGORY, 4, 2)
  add('m2', 'module', RESEARCH_CATEGORY, 4, 3)
  add('m1', 'module', 'historical-incident', 5, 3)
  add('m2', 'module', 'historical-incident', 5, 2)
  add('m3', 'module', 'historical-incident', 5, 4)
  add('l1', 'leaf', 'behavioral-contract', 10, 7)
  add('l2', 'leaf', 'behavioral-contract', 10, 8)
  const report = { scales: {} }
  for (const scale of ['module', 'leaf']) {
    const categories = {}
    for (const category of [...new Set(rows.filter((row) => row.scale === scale).map((row) => row.category))].sort()) {
      const categoryRows = rows.filter((row) => row.scale === scale && row.category === category)
      const clusters = [...new Set(categoryRows.map((row) => row.cluster))].sort()
      const base = { clusters: clusters.length, units: categoryRows.length }
      if (category === 'historical-incident') categories[category] = { ...base, status: 'secondary-only' }
      else if (clusters.length < RULES.minCellClusters || categoryRows.length < RULES.minCellUnits) categories[category] = { ...base, status: 'insufficient' }
      else {
        const perCluster = clusters.map((cluster) => {
          const clusterRows = categoryRows.filter((row) => row.cluster === cluster)
          const full = clusterRows.filter((row) => row.verdict === 'full').length
          return { cluster, full, units: clusterRows.length, rate: Number((full / clusterRows.length).toFixed(6)) }
        })
        const values = perCluster.map((row) => row.rate).sort((a, b) => a - b)
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length
        const median = values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2
        categories[category] = { ...base, status: 'descriptive', perCluster, macro: { mean: Number(mean.toFixed(6)), min: values[0], median: Number(median.toFixed(6)), max: values.at(-1) } }
      }
    }
    report.scales[scale] = { role: scale === 'module' ? 'primary' : 'calibration', categories }
  }
  if (includeForbidden) report.pooled = { rate: 1 }
  return report
}

function forbiddenAggregationKeys(value, at = '') {
  const forbidden = new Set(['pooled', 'overall', 'composite', 'scaleCurve', 'bootstrap', 'ci', 'significance', 'pValue'])
  const hits = []
  if (Array.isArray(value)) value.forEach((item, index) => hits.push(...forbiddenAggregationKeys(item, `${at}[${index}]`)))
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (forbidden.has(key)) hits.push(`${at}.${key}`)
    hits.push(...forbiddenAggregationKeys(item, `${at}.${key}`))
  }
  return hits
}

const EXPECTED_NEGATIVE_GATES = [
  'annotation-feasibility',
  'packet-blinding',
  'o0-self-recall',
  'fabricated-false-recovery',
  'latent-contamination-audit',
  'stale-recovery-bad-signal',
  'category-kappa',
  'style-identity',
  'tree-only-breadcrumb',
  'constructor-family-judge',
  'loo-category-order',
  'aggregation-shape',
]

function evaluateDryFixture(kind) {
  const negative = kind === 'negative'
  const packet = makePacketFixture(kind)
  const packetFailures = packetScan(packet.bytes, packet.labelMap, ['state-machine'])
  const metrics = negative ? {
    annotationFeasibilityApproved: false,
    o0SelfRecall: 0.90,
    fabricatedFalseRecovery: 0.20,
    latentRecovery: 0.30,
    staleRecovered: 2,
    categoryKappa: 0.40,
    styleIdentity: 0.80,
    treeOnlyToR0: 0.85,
    constructorFamilyJudge: true,
    looCategoryOrderReversal: true,
  } : {
    annotationFeasibilityApproved: true,
    o0SelfRecall: 0.96,
    fabricatedFalseRecovery: 0.08,
    latentRecovery: 0.18,
    staleRecovered: 0,
    categoryKappa: 0.72,
    styleIdentity: 0.68,
    treeOnlyToR0: 0.60,
    constructorFamilyJudge: false,
    looCategoryOrderReversal: false,
  }
  const aggregate = aggregateFixture(negative)
  const failures = []
  if (!metrics.annotationFeasibilityApproved) failures.push('annotation-feasibility')
  if (packetFailures.length) failures.push('packet-blinding')
  if (metrics.o0SelfRecall < RULES.o0SelfRecallMin) failures.push('o0-self-recall')
  if (metrics.fabricatedFalseRecovery > RULES.fabricatedFalseRecoveryMax) failures.push('fabricated-false-recovery')
  if (metrics.latentRecovery > RULES.latentRecoveryAuditAbove) failures.push('latent-contamination-audit')
  if (metrics.staleRecovered > 0) failures.push('stale-recovery-bad-signal')
  if (metrics.categoryKappa < RULES.categoryKappaMin) failures.push('category-kappa')
  if (metrics.styleIdentity > RULES.styleIdentityTriggerAbove) failures.push('style-identity')
  if (metrics.treeOnlyToR0 >= RULES.treeOnlyTriggerAt) failures.push('tree-only-breadcrumb')
  if (metrics.constructorFamilyJudge) failures.push('constructor-family-judge')
  if (metrics.looCategoryOrderReversal) failures.push('loo-category-order')
  if (forbiddenAggregationKeys(aggregate).length) failures.push('aggregation-shape')
  const insufficient = aggregate.scales.module.categories['design-rationale']
  const research = aggregate.scales.module.categories[RESEARCH_CATEGORY]
  const leaf = aggregate.scales.leaf.categories['behavioral-contract']
  const historical = aggregate.scales.module.categories['historical-incident']
  if (insufficient.status !== 'insufficient' || 'rate' in insufficient || research.status !== 'insufficient' || 'rate' in research || leaf.status !== 'insufficient' || historical.status !== 'secondary-only') failures.push('aggregation-shape')
  return { kind, admitted: failures.length === 0, failures: [...new Set(failures)], packetFailures, metrics, aggregate }
}

function dryCase(kind) {
  if (!['positive', 'negative'].includes(kind)) {
    console.error('dry --case requires positive or negative')
    return 2
  }
  const result = evaluateDryFixture(kind)
  console.log(`dry fixture ${kind}: ${result.admitted ? 'ADMITTED' : 'REJECTED'}`)
  console.log(`gates=${result.failures.length ? result.failures.join(',') : 'none'}`)
  console.log('modelCalls=0 networkCalls=0 effectiveModuleR0=0')
  return result.admitted ? 0 : 1
}

function dryAll() {
  const frozen = checkFrozen(true)
  const positive = evaluateDryFixture('positive')
  const negative = evaluateDryFixture('negative')
  const negativeComplete = EXPECTED_NEGATIVE_GATES.every((gate) => negative.failures.includes(gate))
  const failures = []
  if (frozen.rc !== 0) failures.push('freeze-check')
  if (!positive.admitted) failures.push('positive-fixture-rejected')
  if (negative.admitted || !negativeComplete) failures.push('negative-fixture-not-fully-rejected')
  const report = {
    v: 1,
    protocol: 'docs/content-recoverability.md',
    protocolFreezeSha256: frozen.built.manifest.protocolFreezeSha256,
    currentState: { effectiveModuleR0: 0, paidRuns: 0, networkCalls: 0, modelCalls: 0 },
    frozenCheck: { rc: frozen.rc, failures: frozen.failures },
    positive,
    negative,
    expectedNegativeGates: EXPECTED_NEGATIVE_GATES,
    negativeComplete,
    failures,
  }
  mkdirSync(dirname(GENERATED.dry), { recursive: true })
  writeFileSync(GENERATED.dry, stableJson(report))
  console.log(`dry oracle: positive=${positive.admitted ? 'admitted' : 'rejected'} negative=${negative.admitted ? 'admitted' : 'rejected'} negativeGates=${negative.failures.length}/${EXPECTED_NEGATIVE_GATES.length}`)
  console.log(`dry-report=${rel(GENERATED.dry)} sha256=${sha256(stableJson(report))}`)
  console.log('modelCalls=0 networkCalls=0 effectiveModuleR0=0')
  if (failures.length) {
    console.error(`dry oracle failed: ${failures.join(',')}`)
    return 1
  }
  console.log('dry oracle ok')
  return 0
}

function preflight() {
  console.log('reconstruction preflight is read-only and launches nothing')
  const frozen = checkFrozen(true)
  if (frozen.rc !== 0) {
    frozen.failures.forEach((failure) => console.error(`preflight blocked: protocol freeze ${failure}`))
    return 1
  }
  if (frozen.built.state.effectiveModuleR0 !== 0) {
    console.error('preflight blocked: effectiveModuleR0 must be 0 before annotation freeze')
    return 1
  }
  const labelsRc = labelsCommand('--check')
  if (labelsRc !== 0) {
    console.error('preflight blocked: blind dual-label/control freeze is incomplete; current effectiveModuleR0=0')
    return 1
  }
  console.log('preflight protocol gates ok; paid reconstruction still requires the parent runner reviewer authorization')
  return 0
}

function usage() {
  console.error('usage: run.mjs --write | --check | dry [--case positive|negative] | labels --write|--check | preflight')
  return 2
}

const args = process.argv.slice(2)
let rc
if (args[0] === '--write') rc = writeFrozen()
else if (args[0] === '--check') rc = checkFrozen().rc
else if (args[0] === 'dry' && args[1] === '--case') rc = dryCase(args[2])
else if (args[0] === 'dry' && args.length === 1) rc = dryAll()
else if (args[0] === 'labels' && ['--write', '--check'].includes(args[1])) rc = labelsCommand(args[1])
else if (args[0] === 'preflight') rc = preflight()
else rc = usage()
process.exit(rc)
