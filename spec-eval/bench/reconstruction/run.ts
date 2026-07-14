// spec-reconstruction-bench runner ([[spec-reconstruction-bench]]) — historical time-split, dry-oracle stage.
//
//   npx tsx spec-eval/bench/reconstruction/run.ts dry                    # default: snapshots + gates + twin; NO agent, NO network
//   npx tsx spec-eval/bench/reconstruction/run.ts select  --check|--write
//   npx tsx spec-eval/bench/reconstruction/run.ts episodes --check|--write
//   npx tsx spec-eval/bench/reconstruction/run.ts snapshot --scale leaf|module|whole [--target <relDir>]
//                                                 [--budget tracked-repo|code-only] [--out <dir>]
//
// Time-split (see docs/spec-reconstruction-bench.md and adversarial-critique.md, both frozen protocol
// assets): C_eval is pinned in targets.json; C0 derives from it (newest first-parent ancestor ≥21 days
// older). A snapshot is `git archive C0` (tracked files only, no .git), composed by ALLOWLIST
// (default-deny: anything outside the allowlist is stripped and recorded), explicit forbidden surfaces
// stripped with reasons, masked per scale, then gated: masked-spec leakage scan, future-leak canary
// (window added-lines must not appear in snapshot or prompt — generation phase only), paired-canary
// plant (clean build must NOT contain the plant; the dry leak-positive twin restores a forbidden
// surface WITH the plant and the gates must fire, proving detection power). The window's first-parent
// transitions freeze into episodes.json (the eligible future-task frame: semantic episodes with
// exclusion reasons and pre/migration/post epochs; primary pilot horizon = pre-migration only).
// Everything is deterministic — no timestamps, no randomness, no absolute paths in manifests — so
// double-builds must byte-match. This runner never launches an agent and never touches the network.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const TARGETS_PATH = join(HERE, 'targets.json')
const EPISODES_PATH = join(HERE, 'episodes.json')
const TASKS_PATH = join(HERE, 'tasks.json')
const RUNS_DIR = join(HERE, 'runs')

// ---- pre-registered rules (change = re-registration, declare in the commit reason) ----
const RULES = {
  c0MinAgeDays: 21,          // C0 = newest first-parent ancestor of cEval at least this much older
  leafStrata: 2,             // top-N packages by C0 subtree size, one leaf each (pilot: 2 leaves)
  leafMinBodyChars: 600,     // a leaf must have a substantive body at C0
  minFwdCommits: 2,          // window commits touching governed code (eligibility, git-only lower bound)
  moduleSubtreeMin: 4,       // module scale: bounded, pilot-sized subtrees, picked as a size-matched PAIR
  moduleSubtreeMax: 12,
  moduleMinLeaves: 3,
  shinglesPerFile: 12,       // masked-body leakage shingles sampled per masked .md (longest-first)
  shingleMinChars: 24,
  canaryCommits: 40,         // window commits sampled (sha-ascending) for the future-leak canary
  canaryPerCommit: 5,
  canaryMax: 200,
  echoListCap: 50,           // manifest lists at most this many in-code echoes (plus the total)
  subjectCap: 160,           // episode frame stores subjects truncated to this many chars
  // first tree-wide vocabulary/schema migration inside the window (yatsu→eval); the first-parent
  // episode containing it splits the frame into pre-migration / migration / post-migration epochs
  migrationMarker: '548a0386ab78d8c6f68cee43e2a905486b6a4d0e',
}

// ---- snapshot composition: allowlist (default-deny) + explicit forbidden surfaces ----
const ALLOWED_TOP_DIR = /^(\.github|\.spec|docs|scripts|extensions|spec-[a-z-]+)$/
const ALLOWED_ROOT_FILES = new Set(['package.json', 'package-lock.json', 'spexcode.json', '.gitignore', '.nvmrc', 'LICENSE'])
const ALLOWED_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'ndjson', 'md', 'html', 'css', 'sh', 'yml', 'yaml', 'png', 'svg', 'txt'])
const FORBIDDEN: { test: (rel: string) => boolean; reason: string }[] = [
  { test: (r) => /(^|\/)(CLAUDE|AGENTS)\.md$/.test(r), reason: 'harness-materialization' },
  { test: (r) => r.split('/').some((s) => s === '.claude' || s === '.codex'), reason: 'harness-state' },
  { test: (r) => r === 'README.md' || r === 'README.zh-CN.md', reason: 'root-narrative-mirror' },
  { test: (r) => r === 'docs/drift-anchor-benchmark.md' || r === 'docs/spec-reconstruction-bench.md', reason: 'spec-derived-report' },
  { test: (r) => r.startsWith('spec-eval/bench/'), reason: 'bench-frozen-data-mirror' },
  // both found BY the leakage scan on the whole-scale dry run — verbatim copies of .spec bodies:
  { test: (r) => r.startsWith('spec-cli/templates/spec/'), reason: 'plugin-seed-template-mirror' },
  { test: (r) => r === 'scripts/seed-spec-history.sh', reason: 'spec-seed-script-mirror' },
]
const CODE_ONLY_STRIP: { test: (rel: string) => boolean; reason: string }[] = [
  { test: (r) => r.startsWith('docs/'), reason: 'code-only:docs' },
  { test: (r) => r.endsWith('.md') && !r.startsWith('.spec/'), reason: 'code-only:markdown' },
  { test: (r) => /\.(test|spec)\.[cm]?[tj]sx?$/.test(r), reason: 'code-only:tests' },
  { test: (r) => r.split('/').some((s) => ['e2e', '__tests__', 'fixtures', '__snapshots__'].includes(s)), reason: 'code-only:test-dirs' },
]
const SOURCE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'])
const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webm', 'mp4', 'woff', 'woff2', 'ttf', 'eot', 'zip', 'pdf'])
// paired-canary plant: unique, WRONG, plausible — lives ONLY on the leak-positive twin's forbidden surface
const PLANT = 'SRB-LEAK-CANARY-9c41: on session-console reconnect the terminal MUST replay the last 400 scrollback lines twice in reverse order before accepting input.'

const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' })
}
function isAncestor(a: string, b: string): boolean {
  try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: ROOT }); return true } catch { return false }
}

// ---- spec tree at a commit ----
type Node = { relDir: string; id: string; parent: string | null; children: string[]; code: string[]; bodyChars: number }
function specTreeAt(commit: string): Map<string, Node> {
  const dirs = git(['ls-tree', '-r', '--name-only', commit, '--', '.spec']).split('\n')
    .filter((p) => p.endsWith('/spec.md')).map((p) => p.slice('.spec/'.length, -'/spec.md'.length))
  const set = new Set(dirs)
  const nodes = new Map<string, Node>()
  for (const relDir of dirs.sort()) {
    const raw = git(['show', `${commit}:.spec/${relDir}/spec.md`])
    const fmEnd = raw.startsWith('---\n') ? raw.indexOf('\n---\n', 4) : -1
    const fm = fmEnd >= 0 ? raw.slice(4, fmEnd) : ''
    const body = fmEnd >= 0 ? raw.slice(fmEnd + 5) : raw
    const code: string[] = []
    let inCode = false
    for (const line of fm.split('\n')) {
      if (/^code:\s*$/.test(line)) { inCode = true; continue }
      if (inCode) { const m = line.match(/^\s+-\s+(.+?)\s*$/); if (m) { code.push(m[1].split('#')[0]); continue } inCode = false }
      const one = line.match(/^code:\s*\[(.*)\]\s*$/)
      if (one) for (const e of one[1].split(',')) if (e.trim()) code.push(e.trim().split('#')[0])
    }
    let parent: string | null = null
    for (let d = relDir; d.includes('/');) { d = d.slice(0, d.lastIndexOf('/')); if (set.has(d)) { parent = d; break } }
    nodes.set(relDir, { relDir, id: relDir.slice(relDir.lastIndexOf('/') + 1), parent, children: [], code, bodyChars: body.trim().length })
  }
  for (const n of nodes.values()) if (n.parent) nodes.get(n.parent)!.children.push(n.relDir)
  return nodes
}
const subtreeOf = (nodes: Map<string, Node>, relDir: string): string[] =>
  [relDir, ...nodes.get(relDir)!.children.flatMap((c) => subtreeOf(nodes, c))]

// ---- selection (deterministic from cEval alone) ----
function deriveC0(cEval: string): { c0: string; c0Date: string } {
  // calendar-day rule: C0 = the newest first-parent ancestor whose committer UTC calendar day is at
  // least c0MinAgeDays before cEval's — day granularity, so the pick is stable under time-of-day noise
  const cEvalDate = new Date(git(['log', '-1', '--format=%cI', cEval]).trim())
  const cutoffDay = new Date(cEvalDate.getTime() - RULES.c0MinAgeDays * 86400_000).toISOString().slice(0, 10)
  for (const line of git(['log', '--first-parent', '--format=%H %cI', cEval]).split('\n')) {
    const [h, d] = line.split(' ')
    if (h && new Date(d).toISOString().slice(0, 10) <= cutoffDay) return { c0: h, c0Date: d }
  }
  throw new Error('no first-parent ancestor old enough for C0')
}
const fwd = (c0: string, cEval: string, paths: string[]) =>
  paths.length ? parseInt(git(['rev-list', '--no-merges', '--count', `${c0}..${cEval}`, '--', ...paths]).trim(), 10) : 0

function computeSelection(cEval: string) {
  const { c0, c0Date } = deriveC0(cEval)
  const nodes = specTreeAt(c0)
  const salt = (s: string) => sha256(`${c0}:${cEval}:${s}`)
  const root = [...nodes.values()].find((n) => !n.parent)
  if (!root) throw new Error('no root spec node at C0')
  const packages = root.children.filter((c) => /^spec-/.test(nodes.get(c)!.id))
  const ranked = packages.map((p) => ({ relDir: p, id: nodes.get(p)!.id, nodes: subtreeOf(nodes, p).length }))
    .sort((a, b) => b.nodes - a.nodes || (a.id < b.id ? -1 : 1))

  const leafEligible = (n: Node) =>
    n.children.length === 0 && n.code.length > 0 && n.bodyChars >= RULES.leafMinBodyChars &&
    n.parent !== null && nodes.get(n.parent)!.children.length >= 2 && fwd(c0, cEval, n.code) >= RULES.minFwdCommits
  const leaf = ranked.slice(0, RULES.leafStrata).map((s) => {
    const pool = subtreeOf(nodes, s.relDir).map((r) => nodes.get(r)!).filter(leafEligible)
    if (!pool.length) throw new Error(`no eligible leaf in stratum ${s.id}`)
    const pick = pool.sort((a, b) => (salt(a.relDir) < salt(b.relDir) ? -1 : 1))[0]
    return { stratum: s.id, relDir: pick.relDir, id: pick.id, code: pick.code, bodyChars: pick.bodyChars, fwdCommits: fwd(c0, cEval, pick.code) }
  })

  // module scale: a size-matched PAIR from all internal non-package nodes with a pilot-sized subtree
  const pool = [...nodes.values()].filter((n) => {
    if (!n.parent || n.children.length === 0 || packages.includes(n.relDir)) return false
    const sub = subtreeOf(nodes, n.relDir)
    if (sub.length < RULES.moduleSubtreeMin || sub.length > RULES.moduleSubtreeMax) return false
    if (sub.filter((r) => nodes.get(r)!.children.length === 0).length < RULES.moduleMinLeaves) return false
    return fwd(c0, cEval, [...new Set(sub.flatMap((r) => nodes.get(r)!.code))]) >= RULES.minFwdCommits
  })
  if (pool.length < 2) throw new Error(`module pool has ${pool.length} nodes — need a pair`)
  let best: [Node, Node] | null = null
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const [a, b] = [pool[i], pool[j]]
    const d = Math.abs(subtreeOf(nodes, a.relDir).length - subtreeOf(nodes, b.relDir).length)
    const key = (x: [Node, Node]) => Math.abs(subtreeOf(nodes, x[0].relDir).length - subtreeOf(nodes, x[1].relDir).length)
    const tie = (x: [Node, Node]) => salt([x[0].relDir, x[1].relDir].sort().join('|'))
    if (!best || d < key(best) || (d === key(best) && tie([a, b]) < tie(best))) best = [a, b]
  }
  const modEntry = (n: Node) => {
    const sub = subtreeOf(nodes, n.relDir)
    return {
      relDir: n.relDir, id: n.id, subtreeNodes: sub.length,
      subtreeLeaves: sub.filter((r) => nodes.get(r)!.children.length === 0).length,
      fwdCommits: fwd(c0, cEval, [...new Set(sub.flatMap((r) => nodes.get(r)!.code))]),
    }
  }
  const modules = best!.map(modEntry).sort((a, b) => (a.relDir < b.relDir ? -1 : 1))

  return {
    v: 2,
    protocol: 'docs/spec-reconstruction-bench.md',
    critique: 'spec-eval/bench/reconstruction/adversarial-critique.md',
    estimands: {
      leaf: 'body-completion (parent/siblings/id kept — NOT discovery)',
      module: 'ontology-completion (external tree kept — subtree topology + content)',
      whole: 'coarse-discovery (root/package/module only; N=1, descriptive case study)',
    },
    rules: RULES,
    cEval, c0, c0Date,
    windowNonMergeCommits: parseInt(git(['rev-list', '--no-merges', '--count', `${c0}..${cEval}`]).trim(), 10),
    windowFirstParentTransitions: parseInt(git(['rev-list', '--first-parent', '--count', `${c0}..${cEval}`]).trim(), 10),
    specNodesAtC0: nodes.size,
    packagesRanked: ranked,
    leaf,
    module: { pair: modules, sizeDelta: Math.abs(modules[0].subtreeNodes - modules[1].subtreeNodes), poolSize: pool.length },
    whole: { maskedNodes: nodes.size },
    episodes: 'episodes.json',
  }
}

// ---- episode frame (the eligible future-task frame, frozen) ----
function computeEpisodes(c0: string, cEval: string) {
  const raw = git(['log', '--first-parent', '--reverse', '-M', '--name-status',
    '--format=%x01%H%x02%P%x02%cI%x02%s', `${c0}..${cEval}`])
  const blocks = raw.split('\x01').filter((b) => b.trim())
  const eps = blocks.map((b) => {
    const nl = b.indexOf('\n')
    const head = (nl >= 0 ? b.slice(0, nl) : b).split('\x02')
    const changes = (nl >= 0 ? b.slice(nl + 1) : '').split('\n').filter((l) => /^[A-Z]/.test(l))
      .map((l) => { const t = l.split('\t'); return { status: t[0], path: t[t.length - 1] } })
    return { sha: head[0], merge: head[1].split(' ').length > 1, date: head[2], subject: head[3].slice(0, RULES.subjectCap), changes }
  })
  // epoch boundary: first first-parent transition whose ancestry contains the migration marker
  const marker = RULES.migrationMarker
  let boundary = -1
  if (isAncestor(marker, cEval) && !isAncestor(marker, c0)) {
    let lo = 0, hi = eps.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (isAncestor(marker, eps[mid].sha)) hi = mid; else lo = mid + 1 }
    boundary = lo
  }
  const rows = eps.map((e, i) => {
    const paths = e.changes.map((c) => c.path)
    const all = (f: (p: string) => boolean) => paths.length > 0 && paths.every(f)
    let excludeReason: string | null = null
    if (paths.length === 0) excludeReason = 'empty'
    else if (all((p) => /\.ndjson$/.test(p))) excludeReason = 'measure-only'
    else if (all((p) => p.startsWith('.spec/'))) excludeReason = 'spec-only'
    else if (e.changes.every((c) => c.status === 'R100')) excludeReason = 'rename-only'
    else if (all((p) => /(^|\/)package(-lock)?\.json$/.test(p))) excludeReason = 'dependency-only'
    else if (/^Revert\b/.test(e.subject)) excludeReason = 'revert'
    const epoch = boundary < 0
      ? (isAncestor(marker, c0) ? 'post-migration' : 'pre-migration')
      : i < boundary ? 'pre-migration' : i === boundary ? 'migration' : 'post-migration'
    return { sha: e.sha, merge: e.merge, date: e.date, subject: e.subject, files: paths.length, epoch, ...(excludeReason ? { excludeReason } : { eligible: true }) }
  })
  const count = (f: (r: any) => boolean) => rows.filter(f).length
  if (!rows.some((r) => r.merge && r.files > 0)) throw new Error('sanity: no merge episode carries a first-parent diff — git too old for --diff-merges=first-parent?')
  return {
    v: 1, c0, cEval, migrationMarker: marker,
    migrationEpisode: boundary >= 0 ? rows[boundary].sha : null,
    primaryHorizonEnd: boundary > 0 ? rows[boundary - 1].sha : boundary === 0 ? null : rows[rows.length - 1].sha,
    counts: {
      total: rows.length, eligible: count((r) => r.eligible),
      byEpoch: { 'pre-migration': count((r) => r.epoch === 'pre-migration'), migration: count((r) => r.epoch === 'migration'), 'post-migration': count((r) => r.epoch === 'post-migration') },
      eligiblePreMigration: count((r) => r.eligible && r.epoch === 'pre-migration'),
      byReason: ['empty', 'measure-only', 'spec-only', 'rename-only', 'dependency-only', 'revert']
        .reduce((o: any, k) => { o[k] = count((r) => r.excludeReason === k); return o }, {}),
    },
    episodes: rows,
  }
}

// ---- future-task selection (deterministic, per leaf) ----
// Reuses the SAME window/eligibility/epoch logic as computeEpisodes (kept as an independent walk so the
// frozen episodes.json byte-reproduction is never at risk), then picks, per leaf, ONE eligible
// pre-migration episode that actually touched that leaf's governed code — the leaf's frozen future task.
// The pre-state is the episode's first parent (the mainline commit an executor would start from). The
// sanitized behavioral request + hidden acceptance are authored, frozen assets in task-cards.json; this
// selection never reads O0 (the masked leaf body), only the episode's real code diff.
function eligiblePreMigrationEpisodes(c0: string, cEval: string) {
  const raw = git(['log', '--first-parent', '--reverse', '-M', '--name-status',
    '--format=%x01%H%x02%P%x02%cI%x02%s', `${c0}..${cEval}`])
  const eps = raw.split('\x01').filter((b) => b.trim()).map((b) => {
    const nl = b.indexOf('\n')
    const head = (nl >= 0 ? b.slice(0, nl) : b).split('\x02')
    const changes = (nl >= 0 ? b.slice(nl + 1) : '').split('\n').filter((l) => /^[A-Z]/.test(l))
      .map((l) => { const t = l.split('\t'); return { status: t[0], path: t[t.length - 1] } })
    return { sha: head[0], parents: head[1].split(' '), date: head[2], subject: head[3].slice(0, RULES.subjectCap), changes }
  })
  const marker = RULES.migrationMarker
  let boundary = -1
  if (isAncestor(marker, cEval) && !isAncestor(marker, c0)) {
    let lo = 0, hi = eps.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (isAncestor(marker, eps[mid].sha)) hi = mid; else lo = mid + 1 }
    boundary = lo
  }
  return eps.map((e, i) => {
    const paths = e.changes.map((c) => c.path)
    const all = (f: (p: string) => boolean) => paths.length > 0 && paths.every(f)
    let excl: string | null = null
    if (paths.length === 0) excl = 'empty'
    else if (all((p) => /\.ndjson$/.test(p))) excl = 'measure-only'
    else if (all((p) => p.startsWith('.spec/'))) excl = 'spec-only'
    else if (e.changes.every((c) => c.status === 'R100')) excl = 'rename-only'
    else if (all((p) => /(^|\/)package(-lock)?\.json$/.test(p))) excl = 'dependency-only'
    else if (/^Revert\b/.test(e.subject)) excl = 'revert'
    const epoch = boundary < 0 ? (isAncestor(marker, c0) ? 'post-migration' : 'pre-migration')
      : i < boundary ? 'pre-migration' : i === boundary ? 'migration' : 'post-migration'
    return { ...e, paths, epoch, eligible: !excl }
  }).filter((e) => e.eligible && e.epoch === 'pre-migration')
}

function computeTasks(cEval: string) {
  const sel = JSON.parse(readFileSync(TARGETS_PATH, 'utf8'))
  const { c0 } = sel
  const pool = eligiblePreMigrationEpisodes(c0, cEval)   // already first-parent ASCENDING (git --reverse)
  // manual escape-hatch exclusions (things the mechanical checks below can't see); default empty.
  const exclPath = join(HERE, 'task-exclusions.json')
  const manual: { relDir: string; episodeSha: string; reason: string }[] = existsSync(exclPath) ? JSON.parse(readFileSync(exclPath, 'utf8')) : []
  // counterbalanced arm schedule (§11): the three arms must NOT always run O0→R0→N0 — a fixed order
  // confounds arm with sequence (rate-limit/time-of-day drift). Freeze a per-leaf rotation by index.
  const ARMS = ['O0', 'R0', 'N0']
  const armOrderFor = (i: number) => ARMS.map((_, k) => ARMS[(k + i) % ARMS.length])
  const leaves = sel.leaf.map((leaf: any, i: number) => {
    const code: string[] = leaf.code
    const manualShas = new Set(manual.filter((x) => x.relDir === leaf.relDir).map((x) => x.episodeSha))
    const cands = pool.filter((e) => e.paths.some((p) => code.includes(p)))
    // Earliest candidate passing BOTH mechanical, result-independent checks (run before any arm):
    //  (a) replay: the governed-file change must not depend on a NEW sibling module created in the same
    //      episode (else a fresh executor at pre-state can't attempt it without authoring that module);
    //  (b) scope-self-containment: the episode must not change NON-governed SOURCE files (added/modified/
    //      deleted) — else the episode's real subject lives outside the governed set, a faithful impl would
    //      look like a scope violation, and a regex scorer could reward a wrong impl. Reasons frozen inline.
    const excluded: { episodeSha: string; reason: string }[] = []
    let pick: any = null
    for (const e of cands) {
      if (manualShas.has(e.sha)) { excluded.push({ episodeSha: e.sha, reason: `manual: ${manual.find((x) => x.relDir === leaf.relDir && x.episodeSha === e.sha)!.reason}` }); continue }
      const preState = git(['rev-parse', `${e.sha}^1`]).trim()
      const dep = newSiblingDep(e.sha, preState, code)
      if (dep.length) { excluded.push({ episodeSha: e.sha, reason: `depends-on-new-sibling-module: ${dep.join(', ')}` }); continue }
      const nonGov = e.paths.filter((p: string) => SOURCE_EXT.has(extOf(p)) && !code.includes(p))
      if (nonGov.length) { excluded.push({ episodeSha: e.sha, reason: `scope-not-self-contained: non-governed source changed: ${nonGov.slice(0, 6).join(', ')}${nonGov.length > 6 ? ` +${nonGov.length - 6}` : ''}` }); continue }
      pick = e; break
    }
    if (!pick) throw new Error(`no replayable & scope-self-contained pre-migration episode for leaf ${leaf.id} (${excluded.length} excluded)`)
    const preState = git(['rev-parse', `${pick.sha}^1`]).trim()
    return {
      stratum: leaf.stratum, relDir: leaf.relDir, id: leaf.id, leafCode: code,
      candidateCount: cands.length, excluded, armOrder: armOrderFor(i),
      episode: { sha: pick.sha, date: pick.date, subject: pick.subject, files: pick.paths.length,
        changedSource: pick.paths.filter((p: string) => SOURCE_EXT.has(extOf(p))).sort(),
        changedLeafFiles: pick.paths.filter((p: string) => code.includes(p)).sort() },
      preState,
    }
  })
  // bind the authored task cards to this freeze: hash the cards file (if present) so `tasks --check`
  // fails if the cards change without re-registration. Two-pass on first authoring (null until cards land).
  const cardsPath = join(HERE, 'task-cards.json')
  const cardsSha256 = existsSync(cardsPath) ? sha256(readFileSync(cardsPath)) : null
  // (6) order-balanced schedule: 2 leaves give only 2 blocks, which cannot balance an arm across all 3
  // positions. Freeze a THIRD block — a REPEAT of a mechanically pre-registered target (the first leaf in
  // id order) — carrying the third rotation, so across the 3 blocks each arm sits in each position exactly
  // once (a Latin square). This is an ORDER-BALANCED pilot only; it makes NO significance claim.
  const ROT = [['O0', 'R0', 'N0'], ['R0', 'N0', 'O0'], ['N0', 'O0', 'R0']]
  const repeatTarget = [...leaves].sort((a: any, b: any) => (a.id < b.id ? -1 : 1))[0]   // deterministic pre-registration
  const blocks = [
    { block: 0, leafId: leaves[0].id, relDir: leaves[0].relDir, armOrder: ROT[0], repeat: false },
    { block: 1, leafId: leaves[1].id, relDir: leaves[1].relDir, armOrder: ROT[1], repeat: false },
    { block: 2, leafId: repeatTarget.id, relDir: repeatTarget.relDir, armOrder: ROT[2], repeat: true },
  ]
  return { v: 3, c0, cEval, protocol: 'docs/spec-reconstruction-bench.md', cards: 'task-cards.json', cardsSha256, orderBalanced: true, significanceClaim: false, leaves, blocks }
}

// mechanical replay check: relative imports added to the leaf's governed files in this episode that
// resolve to NO file at pre-state (i.e. a sibling module created in the same episode). Returns the
// unresolved import specifiers; empty = replayable. Deterministic, never looks at arm results.
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']
function existsAt(commit: string, path: string): boolean {
  try { execFileSync('git', ['cat-file', '-e', `${commit}:${path}`], { cwd: ROOT, stdio: 'ignore' }); return true } catch { return false }
}
function newSiblingDep(episodeSha: string, preState: string, leafCode: string[]): string[] {
  const unresolved: string[] = []
  for (const file of leafCode) {
    if (!/\.[cm]?[tj]sx?$/.test(file)) continue
    let content = ''
    try { content = git(['show', `${episodeSha}:${file}`]) } catch { continue }
    const dir = file.slice(0, file.lastIndexOf('/'))
    for (const m of content.matchAll(/(?:import|export)[^'"]*from\s*['"](\.[^'"]+)['"]/g)) {
      const spec = m[1]
      // resolve relative to the importing file's dir, normalize ../ and ./
      const parts = (dir + '/' + spec).split('/'); const norm: string[] = []
      for (const p of parts) { if (p === '.' || p === '') continue; if (p === '..') norm.pop(); else norm.push(p) }
      const base = norm.join('/')
      // TS/ESM convention: an import specifier may carry a .js extension that resolves to a .ts source
      // (./git.js → git.ts). Resolve against the STEM (specifier ext stripped) across the ext table,
      // and also try the literal path.
      const stem = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/, '')
      const resolved = existsAt(preState, base) || RESOLVE_EXT.some((ext) => existsAt(preState, stem + ext))
      if (!resolved) unresolved.push(spec)
    }
  }
  return [...new Set(unresolved)]
}


// ---- snapshot ----
function walk(dir: string, base = dir): { rel: string; symlink: boolean }[] {
  const out: { rel: string; symlink: boolean }[] = []
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name)
    if (e.isDirectory() && !e.isSymbolicLink()) out.push(...walk(p, base))
    else out.push({ rel: relative(base, p), symlink: e.isSymbolicLink() })
  }
  return out
}
const extOf = (p: string) => { const b = p.slice(p.lastIndexOf('/') + 1); const d = b.lastIndexOf('.'); return d > 0 ? b.slice(d + 1).toLowerCase() : '' }
const isText = (abs: string, rel: string) => !BINARY_EXT.has(extOf(rel)) && !readFileSync(abs).subarray(0, 4096).includes(0)
function allowlisted(rel: string): boolean {
  if (!rel.includes('/')) return ALLOWED_ROOT_FILES.has(rel)
  const top = rel.slice(0, rel.indexOf('/'))
  if (!ALLOWED_TOP_DIR.test(top)) return false
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  return ALLOWED_EXT.has(extOf(rel)) || base === '.gitignore' || base === '.gitkeep'
}
function shinglesFromMd(raw: string): string[] {
  const lines = [...new Set(raw.split('\n').map(norm).filter((l) => l.length >= RULES.shingleMinChars))]
  return lines.sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, RULES.shinglesPerFile)
}
let canaryCache: { key: string; shingles: string[] } | null = null
function canaryShingles(c0: string, cEval: string, c0Corpus: string): string[] {
  const key = `${c0}:${cEval}`
  if (canaryCache?.key === key) return canaryCache.shingles
  const shas = git(['rev-list', '--no-merges', `${c0}..${cEval}`]).split('\n').filter(Boolean).sort().slice(0, RULES.canaryCommits)
  const out: string[] = []
  for (const sha of shas) {
    if (out.length >= RULES.canaryMax) break
    let took = 0
    for (const line of git(['show', sha, '--format=', '--unified=0', '--no-color']).split('\n')) {
      if (took >= RULES.canaryPerCommit || out.length >= RULES.canaryMax) break
      if (!line.startsWith('+') || line.startsWith('+++')) continue
      const n = norm(line.slice(1))
      if (n.length >= RULES.shingleMinChars && !out.includes(n) && !c0Corpus.includes(n)) { out.push(n); took++ }
    }
  }
  canaryCache = { key, shingles: out }
  return out
}

type Scale = 'leaf' | 'module' | 'whole'
type Budget = 'tracked-repo' | 'code-only'
function buildSnapshot(sel: any, scale: Scale, targetRelDir: string | null, outDir: string, budget: Budget = 'tracked-repo', plantLeak = false) {
  const { c0, cEval } = sel
  rmSync(outDir, { recursive: true, force: true })
  const snap = join(outDir, 'snapshot')
  mkdirSync(snap, { recursive: true })
  const tar = join(outDir, 'c0.tar')
  git(['archive', '--format=tar', '-o', tar, c0])
  execFileSync('tar', ['-xf', tar, '-C', snap])
  rmSync(tar)

  // full-tree C0 corpus (pre-strip) — the canary's "did this line exist at C0" reference
  const allFiles = walk(snap)
  let c0Corpus = ''
  for (const f of allFiles) if (!f.symlink && isText(join(snap, f.rel), f.rel)) c0Corpus += norm(readFileSync(join(snap, f.rel), 'utf8')) + '\n'

  // compose by allowlist: explicit forbidden surfaces first (reason recorded), then default-deny
  const stripped: { path: string; reason: string }[] = []
  for (const f of allFiles) {
    const fb = FORBIDDEN.find((x) => x.test(f.rel))
    const co = budget === 'code-only' ? CODE_ONLY_STRIP.find((x) => x.test(f.rel)) : undefined
    const reason = fb ? fb.reason : !allowlisted(f.rel) ? 'default-deny' : co ? co.reason : f.symlink ? 'symlink' : null
    if (reason) { rmSync(join(snap, f.rel), { force: true }); stripped.push({ path: f.rel, reason }) }
  }

  // mask per scale
  const maskedDirs = scale === 'whole' ? ['.spec'] : [`.spec/${targetRelDir}`]
  const maskedFiles = git(['ls-tree', '-r', '--name-only', c0, '--', ...maskedDirs]).split('\n').filter(Boolean)
  for (const d of maskedDirs) rmSync(join(snap, d), { recursive: true, force: true })

  // leak-positive twin: restore ONE forbidden surface (the masked spec.md) with the plant appended
  if (plantLeak) {
    const specPath = scale === 'whole' ? maskedFiles.find((f) => f.endsWith('/spec.md'))! : `.spec/${targetRelDir}/spec.md`
    mkdirSync(dirname(join(snap, specPath)), { recursive: true })
    writeFileSync(join(snap, specPath), git(['show', `${c0}:${specPath}`]) + `\n${PLANT}\n`)
  }

  const shingleMap = maskedFiles.filter((f) => f.endsWith('.md'))
    .map((file) => ({ file, shingles: shinglesFromMd(git(['show', `${c0}:${file}`])) }))
  const prompt = renderPrompt(scale, targetRelDir, budget)
  writeFileSync(join(outDir, 'PROMPT.md'), prompt)

  // scan what remains
  const remaining = walk(snap)
  const fileText = new Map<string, string>()
  let corpus = ''
  for (const f of remaining) if (!f.symlink && isText(join(snap, f.rel), f.rel)) { const t = norm(readFileSync(join(snap, f.rel), 'utf8')); fileText.set(f.rel, t); corpus += t + '\n' }
  const violations: any[] = [], echoes: any[] = []
  for (const { file, shingles } of shingleMap) for (const s of shingles) {
    if (!corpus.includes(s)) continue
    const hits = [...fileText.entries()].filter(([, t]) => t.includes(s)).map(([r]) => r)
    const v = hits.filter((h) => !SOURCE_EXT.has(extOf(h)))
    const e = hits.filter((h) => SOURCE_EXT.has(extOf(h)))
    if (v.length) violations.push({ shingle: s, from: file, hits: v })
    if (e.length) echoes.push({ shingle: s, from: file, hits: e })
  }
  const canary = canaryShingles(c0, cEval, c0Corpus)
  const promptNorm = norm(prompt)
  const manifest = {
    v: 2, bench: 'spec-reconstruction-bench', scale, target: targetRelDir, budget, c0, cEval,
    protocol: 'docs/spec-reconstruction-bench.md',
    files: remaining.length,
    treeHash: sha256(remaining.map((f) => `${f.rel}\0${f.symlink ? 'symlink' : sha256(readFileSync(join(snap, f.rel)))}`).join('\n')),
    symlinks: remaining.filter((f) => f.symlink).map((f) => f.rel),
    masked: { dirs: maskedDirs, files: maskedFiles.length, list: maskedFiles },
    stripped: { count: stripped.length, byReason: stripped.reduce((o: any, s) => { o[s.reason] = (o[s.reason] ?? 0) + 1; return o }, {}), list: stripped },
    leakage: { shinglesScanned: shingleMap.reduce((a, b) => a + b.shingles.length, 0), violations, echoTotal: echoes.length, echoes: echoes.slice(0, RULES.echoListCap) },
    canary: { shingles: canary.length, hits: canary.filter((s) => corpus.includes(s) || promptNorm.includes(s)) },
    plant: { planted: plantLeak, detected: corpus.includes(norm(PLANT)) },
    prompt: { sha256: sha256(prompt), maskedShingleLeaks: shingleMap.flatMap(({ file, shingles }) => shingles.filter((s) => promptNorm.includes(s)).map((s) => ({ shingle: s, from: file }))) },
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

function renderPrompt(scale: Scale, targetRelDir: string | null, budget: Budget): string {
  const evidence = budget === 'code-only'
    ? 'Evidence budget: PRODUCTION CODE ONLY — tests, docs and reports have been removed from this snapshot.'
    : 'Evidence budget: everything in this snapshot is fair evidence — code, tests, docs, configs.'
  const common = `# Spec reconstruction task

You are working in a snapshot of a TypeScript/React monorepo (a spec-driven dev tool: CLI backend,
web dashboard, sibling packages). The snapshot has no git history and no network access; judge only
from the files present. ${evidence}

This project documents intent as "spec nodes": a directory tree under \`.spec/\`, each node a directory
holding a \`spec.md\`. Format: YAML frontmatter (\`title\`, one-line \`desc\`, \`code:\` — a YAML list of
repo paths this node is source of truth for; \`related:\` — paths it references), then a Markdown body
stating the node's PRESENT intent at contract altitude: what the area guarantees and why, its
invariants and outward behaviour — not a code walkthrough. Parent nodes scope their children;
siblings border each other. Write clear, specific contracts a maintainer could steer future changes by.

Write your reconstruction under \`.spec-recon/\` at the snapshot root, mirroring the \`.spec/\` layout
(one directory per node, each with a spec.md). Do not modify any other file.
`
  if (scale === 'leaf') return common + `
## Your task (leaf body completion)

The node directory \`.spec/${targetRelDir}/\` is missing from this snapshot; its parent and sibling
nodes are present. Study the surrounding spec tree and the code, decide which source files this
missing node governs, and write \`.spec-recon/${targetRelDir}/spec.md\` — frontmatter (including your
best \`code:\`/\`related:\` attribution) plus a contract-altitude body.
`
  if (scale === 'module') return common + `
## Your task (module ontology completion)

The subtree \`.spec/${targetRelDir}/\` (a module node and all of its descendants) is missing from this
snapshot; the rest of the spec tree is present. Reconstruct the module under
\`.spec-recon/${targetRelDir}/\`: the module node's spec.md plus whatever child nodes you judge the
area needs — the topology (how many children, their boundaries, their code ownership) is yours to
decide from the code.
`
  return common + `
## Your task (whole-tree coarse discovery)

This snapshot has NO \`.spec/\` tree at all. Reconstruct the top of one under \`.spec-recon/\`: a root
project node, one child node per package, and one level of module nodes below the packages where the
code warrants them (at most 3 levels deep in total). Do not write leaf nodes below module level —
this scale is judged on root/package/module intent only.
`
}

// ---- executor pre-state snapshot (paid-pilot forward-task stage) ----
// Archives an arbitrary commit (an episode's pre-state), applies the SAME allowlist + forbidden strip as
// the generation snapshot, and removes the ENTIRE .spec tree (no intervening spec leaks into the forward
// task). Optionally injects one neutral-projection bundle at `.spec-context/<rel>` — the arm's ONLY spec
// context (N0 = no bundle). No masked-shingle/future-canary gate here: the pre-state archive is
// structurally free of the episode's own and later changes, and the forward task prompt may legitimately
// carry new requirements (§4). The governed files MUST be present (else the task can't be attempted).
export function buildExecSnapshot(commit: string, outDir: string, governed: string[], bundle?: { rel: string; text: string }) {
  rmSync(outDir, { recursive: true, force: true })
  const snap = join(outDir, 'snapshot')
  mkdirSync(snap, { recursive: true })
  const tar = join(outDir, 'pre.tar')
  git(['archive', '--format=tar', '-o', tar, commit])
  execFileSync('tar', ['-xf', tar, '-C', snap]); rmSync(tar)

  // remove the ENTIRE .spec tree first (dir and all) so no intervening spec — not even empty dir names — leaks
  rmSync(join(snap, '.spec'), { recursive: true, force: true })

  const all = walk(snap)
  const stripped: { path: string; reason: string }[] = []
  for (const f of all) {
    const fb = FORBIDDEN.find((x) => x.test(f.rel))
    const reason = fb ? fb.reason : !allowlisted(f.rel) ? 'default-deny' : f.symlink ? 'symlink' : null
    if (reason) { rmSync(join(snap, f.rel), { force: true }); stripped.push({ path: f.rel, reason }) }
  }
  if (bundle) {
    const p = join(snap, '.spec-context', bundle.rel)
    mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bundle.text)
  }
  const missing = governed.filter((g) => !existsSync(join(snap, g)))
  const remaining = walk(snap)
  const manifest = {
    v: 1, bench: 'spec-reconstruction-bench', stage: 'exec-snapshot', commit, governed,
    files: remaining.length,
    treeHash: sha256(remaining.map((f) => `${f.rel}\0${f.symlink ? 'symlink' : sha256(readFileSync(join(snap, f.rel)))}`).join('\n')),
    strippedAllSpec: !remaining.some((f) => f.rel.startsWith('.spec/')),
    bundleInjected: bundle ? `.spec-context/${bundle.rel}` : null,
    governedPresent: missing.length === 0, missingGoverned: missing,
    stripped: { count: stripped.length, byReason: stripped.reduce((o: any, s) => { o[s.reason] = (o[s.reason] ?? 0) + 1; return o }, {}) },
  }
  writeFileSync(join(outDir, 'exec-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

// ---- gates ----
type Gate = { name: string; ok: boolean; detail: string }
function gatesFor(scale: Scale, targetRelDir: string | null, outDir: string, m: any, m2: any | null): Gate[] {
  const snap = join(outDir, 'snapshot')
  const files = walk(snap)
  const rels = files.map((f) => f.rel)
  const g: Gate[] = []
  g.push({ name: 'no-git', ok: !rels.some((f) => f === '.git' || f.startsWith('.git/')), detail: 'no git history in snapshot' })
  g.push({ name: 'no-symlink', ok: !files.some((f) => f.symlink), detail: 'no symlink escapes the snapshot' })
  g.push({ name: 'allowlist', ok: rels.every((r) => allowlisted(r)), detail: 'every remaining file matches the allowlist (default-deny held)' })
  let maskOk = true, maskDetail = ''
  if (scale === 'whole') { maskOk = !rels.some((f) => f.startsWith('.spec/')); maskDetail = 'no .spec file remains' }
  else {
    const gone = !rels.some((f) => f.startsWith(`.spec/${targetRelDir}/`))
    const parentRel = targetRelDir!.slice(0, targetRelDir!.lastIndexOf('/'))
    const parentPresent = existsSync(join(snap, '.spec', parentRel, 'spec.md'))
    const sibling = rels.some((f) => f.startsWith(`.spec/${parentRel}/`) && !f.startsWith(`.spec/${targetRelDir}/`) && f.endsWith('/spec.md') && f !== `.spec/${parentRel}/spec.md`)
    maskOk = gone && parentPresent && (scale === 'module' || sibling)
    maskDetail = `target gone=${gone} parent=${parentPresent} sibling=${sibling}`
  }
  g.push({ name: 'mask', ok: maskOk, detail: maskDetail })
  g.push({ name: 'forbidden-strip', ok: !rels.some((r) => FORBIDDEN.some((x) => x.test(r))), detail: 'no forbidden surface remains' })
  g.push({ name: 'leakage', ok: m.leakage.violations.length === 0, detail: `${m.leakage.violations.length} violations, ${m.leakage.echoTotal} in-code echoes (informational)` })
  g.push({ name: 'future-canary', ok: m.canary.hits.length === 0, detail: `${m.canary.shingles} window shingles, ${m.canary.hits.length} hits (generation phase only)` })
  g.push({ name: 'plant-absent', ok: !m.plant.detected, detail: 'paired-canary plant not present in clean snapshot' })
  g.push({ name: 'prompt-clean', ok: m.prompt.maskedShingleLeaks.length === 0, detail: 'prompt embeds no masked-body shingle' })
  if (m2) g.push({ name: 'determinism', ok: JSON.stringify(m) === JSON.stringify(m2), detail: 'double-build manifests byte-identical' })
  return g
}

// ---- commands ----
function cmdTasks(write: boolean, sel: any) {
  const tasks = computeTasks(sel.cEval)
  const rendered = JSON.stringify(tasks, null, 2) + '\n'
  if (write) { writeFileSync(TASKS_PATH, rendered); console.log(`tasks.json written: ${tasks.leaves.length} leaf future tasks (${tasks.leaves.map((l: any) => `${l.id}→${l.episode.sha.slice(0, 8)}`).join(', ')})`); return tasks }
  if (!existsSync(TASKS_PATH)) { console.error('tasks.json missing — run tasks --write first'); process.exit(1) }
  if (readFileSync(TASKS_PATH, 'utf8') !== rendered) { console.error('TASK FRAME MISMATCH: committed tasks.json does not reproduce'); process.exit(1) }
  console.log(`task-frame-frozen ✓  ${tasks.leaves.length} leaf future tasks: ${tasks.leaves.map((l: any) => `${l.id}→${l.episode.sha.slice(0, 8)} (${l.candidateCount} cands, preState ${l.preState.slice(0, 8)})`).join('; ')}`)
  return tasks
}

function cmdSelect(write: boolean) {
  const cEval = existsSync(TARGETS_PATH) ? JSON.parse(readFileSync(TARGETS_PATH, 'utf8')).cEval : git(['merge-base', 'HEAD', 'main']).trim()
  const sel = computeSelection(cEval)
  const rendered = JSON.stringify(sel, null, 2) + '\n'
  if (write) { writeFileSync(TARGETS_PATH, rendered); console.log(`targets.json written (c0=${sel.c0.slice(0, 8)} cEval=${cEval.slice(0, 8)})`); return sel }
  if (!existsSync(TARGETS_PATH)) { console.error('targets.json missing — run select --write first'); process.exit(1) }
  if (readFileSync(TARGETS_PATH, 'utf8') !== rendered) { console.error('SELECTION MISMATCH: committed targets.json does not reproduce from its pinned cEval'); process.exit(1) }
  console.log(`selection-frozen ✓  c0=${sel.c0.slice(0, 8)} cEval=${sel.cEval.slice(0, 8)} — ${sel.leaf.length} leaves, module pair (${sel.module.pair.map((m: any) => m.id).join(', ')}, Δ=${sel.module.sizeDelta}), whole`)
  return sel
}
function cmdEpisodes(write: boolean, sel: any) {
  const ep = computeEpisodes(sel.c0, sel.cEval)
  const rendered = JSON.stringify(ep, null, 2) + '\n'
  if (write) { writeFileSync(EPISODES_PATH, rendered); console.log(`episodes.json written: ${ep.counts.total} first-parent episodes, ${ep.counts.eligible} eligible (${ep.counts.eligiblePreMigration} pre-migration = primary horizon)`); return ep }
  if (!existsSync(EPISODES_PATH)) { console.error('episodes.json missing — run episodes --write first'); process.exit(1) }
  if (readFileSync(EPISODES_PATH, 'utf8') !== rendered) { console.error('EPISODE FRAME MISMATCH: committed episodes.json does not reproduce'); process.exit(1) }
  console.log(`episode-frame-frozen ✓  ${ep.counts.total} episodes (${ep.counts.byEpoch['pre-migration']} pre / ${ep.counts.byEpoch.migration} migration / ${ep.counts.byEpoch['post-migration']} post), ${ep.counts.eligible} eligible, primary horizon ${ep.counts.eligiblePreMigration}`)
  return ep
}

function cmdDry() {
  console.log('spec-reconstruction-bench dry-oracle — snapshots + gates + leak-positive twin; NO agent launch, NO network, NO scoring, NO arm verdicts.')
  const sel = cmdSelect(false)
  cmdEpisodes(false, sel)
  const runs: { scale: Scale; target: string | null; budget: Budget }[] = [
    ...sel.leaf.map((l: any) => ({ scale: 'leaf' as Scale, target: l.relDir, budget: 'tracked-repo' as Budget })),
    ...sel.module.pair.map((m: any) => ({ scale: 'module' as Scale, target: m.relDir, budget: 'tracked-repo' as Budget })),
    { scale: 'whole', target: null, budget: 'tracked-repo' },
    { scale: 'module', target: sel.module.pair[0].relDir, budget: 'code-only' }, // negative-control budget
  ]
  let allOk = true
  const report: any[] = []
  for (const r of runs) {
    const slug = `${r.scale}-${r.target ? r.target.split('/').pop() : 'all'}${r.budget === 'code-only' ? '-code-only' : ''}`
    const outDir = join(RUNS_DIR, 'dry', slug)
    const m = buildSnapshot(sel, r.scale, r.target, outDir, r.budget)
    const twin = mkdtempSync(join(tmpdir(), 'srb-'))
    const m2 = buildSnapshot(sel, r.scale, r.target, twin, r.budget)
    rmSync(twin, { recursive: true, force: true })
    const gates = gatesFor(r.scale, r.target, outDir, m, m2)
    if (r.budget === 'code-only') gates.push({
      name: 'budget-strip', ok: !walk(join(outDir, 'snapshot')).some((f) => (f.rel.endsWith('.md') && !f.rel.startsWith('.spec/')) || /\.(test|spec)\.[cm]?[tj]sx?$/.test(f.rel)),
      detail: 'code-only budget: no docs/tests remain outside .spec',
    })
    const ok = gates.every((x) => x.ok)
    allOk &&= ok
    console.log(`\n[${slug}]  files=${m.files} masked=${m.masked.files} stripped=${m.stripped.count} treeHash=${m.treeHash.slice(0, 12)}`)
    for (const x of gates) console.log(`  ${x.ok ? '✓' : '✗'} ${x.name} — ${x.detail}`)
    report.push({ run: slug, manifest: m, gates })
  }
  // leak-positive twin: restore one forbidden surface WITH the plant — the gates MUST fire
  const twinDir = join(RUNS_DIR, 'dry', 'leak-positive-twin')
  const mt = buildSnapshot(sel, 'leaf', sel.leaf[0].relDir, twinDir, 'tracked-repo', true)
  const tGates = gatesFor('leaf', sel.leaf[0].relDir, twinDir, mt, null)
  const fired = { mask: !tGates.find((x) => x.name === 'mask')!.ok, leakage: !tGates.find((x) => x.name === 'leakage')!.ok, plant: mt.plant.detected }
  const twinOk = fired.mask && fired.leakage && fired.plant
  allOk &&= twinOk
  console.log(`\n[leak-positive-twin]  ${twinOk ? '✓' : '✗'} detection power — mask fired=${fired.mask} leakage fired=${fired.leakage} plant detected=${fired.plant} (all three MUST be true)`)
  report.push({ run: 'leak-positive-twin', manifest: mt, expectFired: fired, ok: twinOk })
  writeFileSync(join(RUNS_DIR, 'dry', 'dry-report.json'), JSON.stringify({ v: 2, cEval: sel.cEval, c0: sel.c0, runs: report }, null, 2) + '\n')
  console.log(`\n${allOk ? 'all gates passed ✓' : 'GATES BROKEN ✗'}  (report: spec-eval/bench/reconstruction/runs/dry/dry-report.json)`)
  if (!allOk) process.exit(1)
}

// ---- main ----
const argv = process.argv.slice(2)
const cmd = argv[0] ?? 'dry'
const flag = (n: string) => argv.includes(n)
const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
if (cmd === 'select') cmdSelect(flag('--write'))
else if (cmd === 'episodes') cmdEpisodes(flag('--write'), JSON.parse(readFileSync(TARGETS_PATH, 'utf8')))
else if (cmd === 'tasks') cmdTasks(flag('--write'), JSON.parse(readFileSync(TARGETS_PATH, 'utf8')))
else if (cmd === 'snapshot') {
  const sel = JSON.parse(readFileSync(TARGETS_PATH, 'utf8'))
  const scale = opt('--scale') as Scale
  const target = opt('--target') ?? (scale === 'leaf' ? sel.leaf[0].relDir : scale === 'module' ? sel.module.pair[0].relDir : null)
  const budget = (opt('--budget') ?? 'tracked-repo') as Budget
  const out = opt('--out') ?? join(RUNS_DIR, `${scale}-${target ? target.split('/').pop() : 'all'}`)
  const m = buildSnapshot(sel, scale, target, out, budget)
  console.log(JSON.stringify({ out: relative(ROOT, out), files: m.files, treeHash: m.treeHash, violations: m.leakage.violations.length, canaryHits: m.canary.hits.length }, null, 2))
} else if (cmd === 'exec-snapshot') {
  const commit = opt('--commit')!
  const out = opt('--out')!
  const governed = (opt('--governed') ?? '').split(',').filter(Boolean)
  const bundleRel = opt('--bundle-rel'); const bundleFile = opt('--bundle-file')
  const bundle = bundleRel && bundleFile ? { rel: bundleRel, text: readFileSync(bundleFile, 'utf8') } : undefined
  const m = buildExecSnapshot(commit, out, governed, bundle)
  console.log(JSON.stringify({ out: relative(ROOT, out), files: m.files, treeHash: m.treeHash, strippedAllSpec: m.strippedAllSpec, governedPresent: m.governedPresent, bundle: m.bundleInjected }, null, 2))
} else if (cmd === 'dry') cmdDry()
else if (cmd === 'pilot') {
  // paid pilot orchestration lives in pilot.mjs (isolated executor + preflight + phase schedules).
  // Phases only change scheduling — the frozen selection/episodes/gates above are reused unchanged.
  await import('./pilot.mjs')
} else { console.error('usage: run.ts [dry | select --check|--write | episodes --check|--write | snapshot --scale leaf|module|whole [--target <relDir>] [--budget tracked-repo|code-only] [--out <dir>] | pilot preflight|verify-model]'); process.exit(1) }
