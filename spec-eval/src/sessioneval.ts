import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { git, gitA, repoRoot, driftIndex, historyIndex, type ReviewDiffFile } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { mainBranch } from '../../spec-cli/src/layout.js'
import { reviewPayload } from '../../spec-cli/src/sessions.js'
import { loadEvalRemarkTracks } from '../../spec-cli/src/issues.js'
import { evalTimeline, evalContext, readBlobByHash, type EvalEntry, type EvalTimeline, type ScenarioInfo } from './evaltab.js'
import { isUiPath } from './cli.js'
import { parseScenarios, scenarioHash, type Scenario } from './scenarios.js'

// ---- the model ----

type ScoreState = 'pass' | 'fail' | 'stalePass' | 'staleFail' | 'empty' | null

export type ScenarioImpactReason = 'code' | 'contract' | 'measurement'
export type SessionScenarioInfo = ScenarioInfo & { impact: ScenarioImpactReason[] }

// The ONE session-scope predicate. Declared scenarios come from the current worktree; impact is orthogonal
// to freshness and is derived only from the scenario's own code axis, its semantic contract at merge-base,
// or a reading this session owns. Consumers receive the selected set and never repeat these tests.
export function selectImpactedScenarios(
  current: Scenario[],
  base: Scenario[],
  nodeCode: string[],
  changedPaths: ReadonlySet<string>,
  evalFileChanged: boolean,
  measuredBySession: ReadonlySet<string>,
): { scenario: Scenario; impact: ScenarioImpactReason[] }[] {
  const baseByName = new Map(base.map((scenario) => [scenario.name, scenario]))
  return current.flatMap((scenario) => {
    const impact: ScenarioImpactReason[] = []
    const codeAxis = scenario.code?.length ? scenario.code : nodeCode
    if ([...changedPaths].some((path) => codeClaims(codeAxis, path))) impact.push('code')
    const prior = baseByName.get(scenario.name)
    if (evalFileChanged && (!prior || scenarioHash(prior) !== scenarioHash(scenario))) impact.push('contract')
    if (measuredBySession.has(scenario.name)) impact.push('measurement')
    return impact.length ? [{ scenario, impact }] : []
  })
}

export function unknownCoveragePaths(
  nodeCode: string[],
  changedPaths: ReadonlySet<string>,
): string[] {
  return [...changedPaths].filter((path) => (
    isUiPath(path)
    && codeClaims(nodeCode, path)
  ))
}

export function sessionEvalNodeCandidate(
  current: Scenario[],
  nodeCode: string[],
  evalPath: string,
  sidecarPath: string,
  changedPaths: ReadonlySet<string>,
  dirtyPaths: ReadonlySet<string>,
): boolean {
  if (changedPaths.has(evalPath) || changedPaths.has(sidecarPath) || dirtyPaths.has(sidecarPath)) return true
  return current.some((scenario) => {
    const codeAxis = scenario.code?.length ? scenario.code : nodeCode
    return [...changedPaths].some((path) => codeClaims(codeAxis, path))
  })
}

type SessionEvalReading = EvalEntry & { inSession: boolean }

export function scopeSessionScenarioRows(
  current: Scenario[],
  base: Scenario[],
  scenarioInfo: ScenarioInfo[],
  nodeCode: string[],
  changedPaths: ReadonlySet<string>,
  evalFileChanged: boolean,
  evals: SessionEvalReading[],
): { scenarios: SessionScenarioInfo[]; evals: SessionEvalReading[] } {
  const measured = new Set(evals.filter((reading) => reading.inSession).map((reading) => reading.scenario))
  const selected = selectImpactedScenarios(current, base, nodeCode, changedPaths, evalFileChanged, measured)
  const infoByName = new Map(scenarioInfo.map((scenario) => [scenario.name, scenario]))
  const scenarios: SessionScenarioInfo[] = selected.map(({ scenario, impact }) => ({
    ...(infoByName.get(scenario.name) ?? {
      name: scenario.name, expected: scenario.expected,
      ...(scenario.tags?.length ? { tags: scenario.tags } : {}),
      ...(scenario.test ? { test: scenario.test } : {}),
      ...(scenario.code?.length ? { code: scenario.code } : {}),
    }),
    impact,
  }))
  const names = new Set(scenarios.map((scenario) => scenario.name))
  return { scenarios, evals: evals.filter((reading) => names.has(reading.scenario)) }
}

export function completeExportNodeIds(
  changedNodeIds: Iterable<string>,
  scopedNodeIds: Iterable<string>,
): string[] {
  return [...new Set([...changedNodeIds, ...scopedNodeIds])]
}

export function mergeBasePath(path: string, oldPaths: ReadonlyMap<string, string>): string {
  return oldPaths.get(path) ?? path
}

// one eval reading rendered for the export: the latest measurement of one scenario, with its evidence
// resolved to inline bytes (an image data-URI, or transcript text) so the document is self-contained.
export type ExportReading = {
  scenario: string
  expected: string
  impact: ScenarioImpactReason[]
  verdict?: EvalEntry['verdict']
  fresh: boolean
  staleAxes: string[]
  score: ScoreState
  // legacy instrument tag ('manual@1') — present on old readings only.
  evaluator?: string
  ts: string
  evidence:
    | { kind: 'image'; dataUri: string }
    | { kind: 'video'; dataUri: string }
    | { kind: 'transcript'; text: string }
    | { kind: 'data'; text: string }
    | { kind: 'miss' }
    | { kind: 'none' }
}

export type ExportUnmeasured = {
  scenario: string
  expected: string
  impact: ScenarioImpactReason[]
}

// patch ''/old·new null = nothing to show (added → no old, deleted → no new), past the enrichment cap (omitted), or too large (truncated)
export type ExportFile = ReviewDiffFile & {
  patch: string
  oldText: string | null
  newText: string | null
  truncated: boolean
  omitted: boolean
}

// one changed spec node: its diff slice (the files this node owns that the session touched) joined with its
// measured loss (latest reading per scenario). A frontend node with no eval.md is an honest blind spot.
export type ExportNode = {
  id: string
  title: string
  hue: number
  desc: string
  files: ExportFile[]
  additions: number
  deletions: number
  hasEvalFile: boolean
  uncoveredFrontend: boolean
  affectedScenarios: number
  score: ScoreState
  readings: ExportReading[]
  unmeasured: ExportUnmeasured[]
}

export type ExportGate = { label: string; ok: boolean; detail: string }

export type ExportModel = {
  id: string
  node: string | null
  branch: string | null
  title: string                  // DERIVED headline (the node, else the branch) — no agent-authored claim
  generatedAt: string
  ahead: number
  dirtyNonRuntime: number
  gates: ExportGate[]
  score: { passed: number; total: number; fresh: number }   // the eval summary across all nodes
  nodes: ExportNode[]
  otherFiles: ExportFile[]        // changed files no spec node claims
}

// null when no session has that id (route → 404).
export async function buildExportModel(id: string): Promise<ExportModel | null> {
  const payload = await reviewPayload(id)
  if (!payload) return null
  // root EVERYTHING at the SESSION's worktree — readings, freshness, AND the spec tree itself. The
  // worktree's .spec is the branch's pending proposal ([[source-of-truth]]): a node the branch ADDED
  // exists only there, so a trunk-rooted loadSpecs would silently drop it from the model (the 0fca
  // family's node-existence layer). No worktree → the backend checkout, unchanged.
  const wtPath = worktreePathForBranch(payload.branch)
  const ctxRoot = wtPath ?? repoRoot()
  const specs = await loadSpecs(ctxRoot)
  const specById = new Map(specs.map((s) => [s.id, s]))
  const [didx, hidx] = await Promise.all([driftIndex(ctxRoot), historyIndex(ctxRoot)])
  const ctx = await evalContext(ctxRoot, specs, didx, hidx)

  const changedPaths = new Set(payload.diff.map((file) => file.path))
  const oldPaths = new Map(payload.diff.flatMap((file) => file.oldPath ? [[file.path, file.oldPath] as const] : []))

  // enrich each changed file with its unified diff + full before/after content (derived from the session
  // worktree at the merge-base ↔ HEAD), so the proof can drill summary → diff → whole-file comparison with no
  // extra fetch. Capped at MAX_ENRICHED_FILES so a huge changeset can't bloat the page; the rest keep their
  // row but say so (omitted), never silently blank.
  const [base, shaRows, dirtyState] = wtPath ? await Promise.all([
    gitA(['-C', wtPath, 'merge-base', mainBranch(), 'HEAD']).then((out) => out.trim()),
    gitA(['-C', wtPath, 'rev-list', `${mainBranch()}..HEAD`]),
    worktreeDirtyState(wtPath),
  ]) : ['', '', { paths: new Set<string>(), oldPaths: new Map<string, string>() }] as const
  const dirtyPaths = dirtyState.paths
  for (const path of dirtyPaths) changedPaths.add(path)
  for (const [path, oldPath] of dirtyState.oldPaths) if (!oldPaths.has(path)) oldPaths.set(path, oldPath)
  const shas = new Set(shaRows.split('\n').filter(Boolean))
  const scopedNodes = await sessionScopeNodes(id, ctx, changedPaths, dirtyPaths, oldPaths, base, shas)
  const enriched = new Map<string, ExportFile>()
  let budget = MAX_ENRICHED_FILES
  for (const f of payload.diff) {
    if (wtPath && base && budget > 0) { enriched.set(f.path, await enrichFile(wtPath, base, f)); budget-- }
    else enriched.set(f.path, { ...f, patch: '', oldText: null, newText: null, truncated: false, omitted: !!(wtPath && base) })
  }

  // group the session's real changes (merge-base diff) by the spec node that owns each file.
  const byNode = new Map<string, ExportFile[]>()
  const otherFiles: ExportFile[] = []
  for (const f of payload.diff) {
    const nid = nodeForFile(f.path, specs, payload.node)
    const pf = enriched.get(f.path)!
    if (nid) { const arr = byNode.get(nid) ?? []; arr.push(pf); byNode.set(nid, arr) }
    else otherFiles.push(pf)
  }
  const nodes: ExportNode[] = []
  let passed = 0, total = 0, fresh = 0
  const scopedById = new Map(scopedNodes.map((node) => [node.id, node]))
  const evalById = new Map(ctx.ynodes.map((node) => [node.id, node]))
  const nodeIds = completeExportNodeIds(byNode.keys(), scopedById.keys())
  for (const id of nodeIds) {
    const scoped = scopedById.get(id)
    const spec = specById.get(id)!
    const files = byNode.get(id) ?? []
    const projection = scoped ? scopedScenarioReadings(scoped.scenarios, scoped.evals) : { latest: [], unmeasured: [] }
    const impactByName = new Map(scoped?.scenarios.map((scenario) => [scenario.name, scenario.impact]) ?? [])
    const readings = await Promise.all(projection.latest.map((reading) => toExportReading(reading, impactByName.get(reading.scenario) ?? [])))
    const unmeasured = projection.unmeasured.map((scenario) => ({
      scenario: scenario.name,
      expected: scenario.expected,
      impact: scenario.impact,
    }))
    total += scoped?.scenarios.length ?? 0
    for (const r of projection.latest) {
      if (r.fresh) fresh++
      if (r.fresh && r.verdict?.status === 'pass') passed++
    }
    nodes.push({
      id,
      title: scoped?.title ?? spec.title,
      hue: scoped?.hue ?? spec.hue,
      desc: scoped?.desc ?? spec.desc,
      files,
      additions: files.reduce((a, f) => a + f.additions, 0),
      deletions: files.reduce((a, f) => a + f.deletions, 0),
      hasEvalFile: scoped?.hasEvalFile ?? evalById.has(id),
      uncoveredFrontend: scoped?.uncoveredFrontend ?? false,
      affectedScenarios: scoped?.scenarios.length ?? 0,
      score: nodeScore(scoped?.hasEvalFile ?? evalById.has(id), projection.latest, scoped?.scenarios.length ?? 0),
      readings,
      unmeasured,
    })
  }
  // affected scenarios first, then by amount changed — review work leads while every changed file remains.
  nodes.sort((a, b) => (b.affectedScenarios - a.affectedScenarios) || ((b.additions + b.deletions) - (a.additions + a.deletions)))

  // the headline is DERIVED — the node the session is on, else its branch, else the id. No agent claim.
  const primary = payload.node && specById.has(payload.node) ? specById.get(payload.node)!.title : null
  const title = primary || payload.node || payload.branch || id.slice(0, 8)

  return {
    id,
    node: payload.node,
    branch: payload.branch,
    title,
    generatedAt: new Date().toISOString(),
    ahead: payload.ahead,
    dirtyNonRuntime: payload.dirtyNonRuntime,
    gates: gateRows(payload),
    score: { passed, total, fresh },
    nodes,
    otherFiles,
  }
}

// the gate checklist, derived from the cockpit payload's gates (the SAME numbers `spex session review` prints).
function gateRows(p: NonNullable<Awaited<ReturnType<typeof reviewPayload>>>): ExportGate[] {
  const g = p.gates
  return [
    { label: 'lint', ok: g.lint.errorCount === 0, detail: `${g.lint.errorCount} error(s), ${g.lint.warningCount} warning(s)` },
    { label: 'merge', ok: !g.conflictsWithMain, detail: g.conflictsWithMain ? 'conflicts with main' : 'no conflict' },
    { label: 'ahead', ok: p.ahead > 0, detail: `${p.ahead} commit(s) ahead of main` },
    { label: 'committed', ok: p.dirtyNonRuntime === 0, detail: p.dirtyNonRuntime === 0 ? 'nothing uncommitted' : `${p.dirtyNonRuntime} uncommitted file(s)` },
  ]
}

// gitA returns '' for a missing path — exactly the added/deleted (and best-effort rename) side; each side capped to MAX_FILE_BYTES
const MAX_ENRICHED_FILES = 60
const MAX_FILE_BYTES = 200_000
async function enrichFile(wtPath: string, base: string, f: ReviewDiffFile): Promise<ExportFile> {
  const run = (args: string[]) => gitA(['-C', wtPath, '-c', 'core.quotePath=false', ...args])
  const paths = f.oldPath ? [f.oldPath, f.path] : [f.path]
  const [patchRaw, oldRaw, newRaw] = await Promise.all([
    run(['diff', '-M', `${base}..HEAD`, '--', ...paths]),
    f.status === 'added' ? Promise.resolve('') : run(['show', `${base}:${f.oldPath ?? f.path}`]),
    f.status === 'deleted' ? Promise.resolve('') : run(['show', `HEAD:${f.path}`]),
  ])
  const cap = (s: string) => (s.length > MAX_FILE_BYTES ? { text: s.slice(0, MAX_FILE_BYTES), cut: true } : { text: s, cut: false })
  const p = cap(patchRaw), o = cap(oldRaw), nw = cap(newRaw)
  return {
    ...f,
    patch: p.text,
    oldText: f.status === 'added' ? null : o.text,
    newText: f.status === 'deleted' ? null : nw.text,
    truncated: p.cut || o.cut || nw.cut,
    omitted: false,
  }
}

// resolve a reading's evidence to inline bytes so the proof is a self-contained file: an image → a base64
// data-URI; a transcript → its text; the cache miss / no-capture states pass through. the eval cache owns the bytes
// (the content-addressed cache) — the proof only asks for them by hash.
async function toExportReading(r: EvalEntry, impact: ScenarioImpactReason[]): Promise<ExportReading> {
  const base = {
    scenario: r.scenario, expected: r.expected, impact, verdict: r.verdict, fresh: r.fresh,
    staleAxes: r.staleAxes, score: readingScore(r), evaluator: r.evaluator, ts: r.ts,
  }
  if (r.blobState !== 'present' || !r.blob) return { ...base, evidence: { kind: r.blobState === 'miss' ? 'miss' : 'none' } }
  const blob = readBlobByHash(r.blob)
  if (!blob.ok) return { ...base, evidence: { kind: 'miss' } }
  if (blob.mime.startsWith('image/')) return { ...base, evidence: { kind: 'image', dataUri: `data:${blob.mime};base64,${blob.bytes.toString('base64')}` } }
  if (blob.mime.startsWith('video/')) return { ...base, evidence: { kind: 'video', dataUri: `data:${blob.mime};base64,${blob.bytes.toString('base64')}` } }
  // structured data ([[evidence-kind-taxonomy]]): pretty-print so the self-contained proof shows a
  // validatable data block, not one flat line; invalid JSON falls back to the raw bytes rather than hiding.
  if (blob.mime.startsWith('application/json')) {
    let text = blob.bytes.toString('utf8')
    try { text = JSON.stringify(JSON.parse(text), null, 2) } catch { /* keep raw — invalid JSON still shows */ }
    return { ...base, evidence: { kind: 'data', text } }
  }
  return { ...base, evidence: { kind: 'transcript', text: blob.bytes.toString('utf8') } }
}

// the latest reading per scenario from a newest-first timeline (first seen wins) — the eval tab / score
// badge convention, so the proof shows each scenario's CURRENT loss, not its whole history.
function latestPerScenario(readings: EvalEntry[]): EvalEntry[] {
  const seen = new Set<string>()
  const out: EvalEntry[] = []
  for (const r of readings) if (!seen.has(r.scenario)) { seen.add(r.scenario); out.push(r) }
  return out
}

export function scopedScenarioReadings(
  scenarios: SessionScenarioInfo[],
  readings: EvalEntry[],
): { latest: EvalEntry[]; unmeasured: SessionScenarioInfo[] } {
  const latestByName = new Map(latestPerScenario(readings).map((reading) => [reading.scenario, reading]))
  const latest: EvalEntry[] = []
  const unmeasured: SessionScenarioInfo[] = []
  for (const scenario of scenarios) {
    const reading = latestByName.get(scenario.name)
    if (reading) latest.push(reading)
    else unmeasured.push(scenario)
  }
  return { latest, unmeasured }
}

// the DECLARED scenarios' latest reading — the SAME declared-bounded computation every other eval face reads
// (score.jsx's scenarioStates for the node badge and the eval tab). A reading whose scenario is no longer in
// eval.md is residual: the append-only sidecar still carries it, but it is not current loss, so it must not
// become a proof reading card, a passed/total tick, or a node score. The proof was the one face driven by the
// readings that happen to exist rather than the scenarios that are declared — this bounds it like the rest, so
// a retired scenario's stale reading can't make the proof disagree with the dashboard (phantom card, off ribbon).
export function declaredLatest(tl: EvalTimeline): EvalEntry[] {
  const declared = new Set(tl.scenarios.map((s) => s.name))
  return latestPerScenario(tl.readings).filter((r) => declared.has(r.scenario))
}

// ---- scoring (mirrors the dashboard's score.jsx vocabulary, on the EvalEntry shape) ----

const verdictMark = (r: { verdict?: EvalEntry['verdict'] }) =>
  r.verdict?.status === 'pass' ? 'check' : r.verdict?.status === 'fail' ? 'cross' : null

function readingScore(r: EvalEntry): ScoreState {
  const m = verdictMark(r)
  if (!m) return 'empty'
  if (!r.fresh) return m === 'cross' ? 'staleFail' : 'stalePass'
  return m === 'cross' ? 'fail' : 'pass'
}

// worst-first aggregate over the latest reading per scenario: any fresh fail → fail; else any stale → grey
// (✗ if any stale last-failed, else ✓); else any unscored scenario → empty; else every scenario fresh-passes.
export function nodeScore(hasEvalFile: boolean, latest: EvalEntry[], affectedScenarios = latest.length): ScoreState {
  if (!hasEvalFile) return null
  if (!affectedScenarios || !latest.length) return 'empty'
  if (latest.some((r) => r.fresh && verdictMark(r) === 'cross')) return 'fail'
  const stale = latest.filter((r) => !r.fresh && verdictMark(r))
  if (stale.length) return stale.some((r) => verdictMark(r) === 'cross') ? 'staleFail' : 'stalePass'
  if (latest.length < affectedScenarios || latest.some((r) => !verdictMark(r))) return 'empty'
  return 'pass'
}

// ---- file → node mapping ----

// which spec node owns a changed file: a file inside a node's directory (its spec.md / eval.md / sidecar)
// belongs to the NEAREST such node; otherwise the node whose governed `code:` claims it (exact path,
// directory prefix, or `*` glob — the same matching `spex eval lint --changed` uses). A shared file is
// governed by MANY nodes (ordinary composition); when the session has a primary node that also governs it,
// attribute it THERE so a node/<id> session's stake in cli.ts/index.ts groups under its own node, not
// whichever sibling sorts first.
// null = unclaimed.
function nodeForFile(file: string, specs: Awaited<ReturnType<typeof loadSpecs>>, primary: string | null): string | null {
  let best: string | null = null, bestLen = -1
  for (const s of specs) {
    const dir = dirname(s.path)
    if ((file === dir || file.startsWith(dir + '/')) && dir.length > bestLen) { best = s.id; bestLen = dir.length }
  }
  if (best) return best
  if (primary) { const ps = specs.find((s) => s.id === primary); if (ps && codeClaims(ps.code, file)) return primary }
  for (const s of specs) if (codeClaims(s.code, file)) return s.id
  return null
}

function codeClaims(code: string[], file: string): boolean {
  return code.some((cf) => {
    if (cf === file) return true
    const dir = cf.replace(/\/+$/, '') + '/'
    if (file.startsWith(dir)) return true
    if (cf.includes('*')) return new RegExp('^' + cf.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(file)
    return false
  })
}

// ---- worktree resolution (no sessions.ts edit: read git's own worktree list) ----

// the worktree path whose checked-out branch matches — so the eval context is rooted at the SESSION's
// worktree (its readings + git freshness), not the backend's checkout. `git worktree list --porcelain` emits
// `worktree <path>` then `branch refs/heads/<b>`.
function worktreePathForBranch(branch: string | null): string | null {
  if (!branch) return null
  let out = ''
  try { out = git(['worktree', 'list', '--porcelain']) } catch { return null }
  let curPath: string | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) curPath = line.slice('worktree '.length)
    else if (line.startsWith('branch ') && line.slice('branch '.length) === `refs/heads/${branch}`) return curPath
  }
  return null
}

export function parsePorcelainPaths(out: string): Set<string> {
  const paths = new Set<string>()
  const records = out.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const status = record.slice(0, 2)
    const path = record.slice(3)
    if (path) paths.add(path)
    if ((status.includes('R') || status.includes('C')) && records[i + 1]) paths.add(records[++i])
  }
  return paths
}

export function parsePorcelainRenames(out: string): Map<string, string> {
  const renames = new Map<string, string>()
  const records = out.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const status = record.slice(0, 2)
    const path = record.slice(3)
    if ((status.includes('R') || status.includes('C')) && records[i + 1]) renames.set(path, records[++i])
  }
  return renames
}

async function worktreeDirtyState(wtPath: string): Promise<{ paths: Set<string>; oldPaths: Map<string, string> }> {
  const out = await gitA(['-C', wtPath, '-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  return { paths: parsePorcelainPaths(out), oldPaths: parsePorcelainRenames(out) }
}

// ---- the renderer ----

// escape interpolated text for HTML (the proof inlines derived data — file paths, scenarios, expected — so
// every value is escaped; there is no agent-authored markdown to render).
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SCORE_GLYPH: Record<string, string> = { pass: '✓', fail: '✗', stalePass: '✓', staleFail: '✗', empty: '' }
function scoreBadge(state: ScoreState, title?: string): string {
  if (!state) return ''
  return `<span class="score ${state}" title="${esc(title ?? state)}">${SCORE_GLYPH[state] ?? ''}</span>`
}
function verdictBadge(v: EvalEntry['verdict']): string {
  if (!v) return `<span class="verdict legacy">legacy</span>`
  if (v.status === 'pass') return `<span class="verdict pass">✓ pass</span>`
  if (v.status === 'fail') return `<span class="verdict fail">✗ fail</span>`
  return `<span class="verdict note" title="${esc(v.note ?? '')}">≈ note</span>`
}

function renderReading(r: ExportReading): string {
  const ev = r.evidence
  const body =
    ev.kind === 'image' ? `<img class="shot" src="${ev.dataUri}" alt="${esc(r.scenario)}">`
    : ev.kind === 'video' ? `<video class="shot" src="${ev.dataUri}" controls preload="metadata"></video>`
    : ev.kind === 'transcript' ? `<pre class="transcript">${esc(ev.text)}</pre>`
    : ev.kind === 'data' ? `<pre class="transcript data">${esc(ev.text)}</pre>`
    : ev.kind === 'miss' ? `<div class="noev">⌀ miss original file — the evidence bytes were pruned</div>`
    : `<div class="noev">attested without a capture</div>`
  const stale = r.fresh ? '' : `<span class="stale" title="${esc(r.staleAxes.join(', '))} changed since this eval">stale</span>`
  const note = r.verdict?.note ? `<div class="rnote"><b>note</b> ${esc(r.verdict.note)}</div>` : ''
  return `<div class="eval-entry">
    <div class="rhead">
      ${scoreBadge(r.score, r.fresh ? undefined : `stale: ${r.staleAxes.join(', ')}`)}
      <span class="scenario">${esc(r.scenario)}</span>
      <span class="impact">${esc(r.impact.join(' + '))}</span>
      ${verdictBadge(r.verdict)}
      ${stale}
      <span class="rmeta">${r.evaluator ? `${esc(r.evaluator)} · ` : ''}${esc(r.ts)}</span>
    </div>
    ${r.expected ? `<div class="expected"><b>expected</b> ${esc(r.expected)}</div>` : ''}
    ${note}
    <figure class="evidence">${body}</figure>
  </div>`
}

function renderUnmeasured(scenario: ExportUnmeasured): string {
  return `<div class="eval-entry unmeasured">
    <div class="rhead">
      ${scoreBadge('empty', 'unmeasured')}
      <span class="scenario">${esc(scenario.scenario)}</span>
      <span class="impact">${esc(scenario.impact.join(' + '))}</span>
      <span class="verdict legacy">unmeasured</span>
    </div>
    ${scenario.expected ? `<div class="expected"><b>expected</b> ${esc(scenario.expected)}</div>` : ''}
  </div>`
}

// each diff line is its own block so a long diff scrolls inside its box
function renderPatch(patch: string): string {
  return patch.split('\n').map((ln) => {
    const cls = /^@@/.test(ln) ? 'h'
      : /^(diff |index |--- |\+\+\+ |rename |similarity |new file|deleted file|old mode|new mode|Binary )/.test(ln) ? 'm'
      : ln[0] === '+' ? 'a' : ln[0] === '-' ? 'd' : ''
    return `<span class="dl ${cls}">${esc(ln) || ' '}</span>`
  }).join('')
}

function renderFile(f: ExportFile): string {
  const row = `<span class="fstatus ${esc(f.status)}">${esc(f.status)}</span> <span class="fpath">${esc(f.path)}</span> <span class="fnum"><span class="add">+${f.additions}</span> <span class="del">−${f.deletions}</span></span>`
  if (f.omitted) return `<div class="file flat"><div class="frow">${row}<span class="note">diff omitted — large changeset</span></div></div>`
  if (!f.patch && f.oldText == null && f.newText == null) return `<div class="file flat"><div class="frow">${row}</div></div>`
  const side = (label: string, text: string | null, absent: string) =>
    `<div class="side"><div class="side-h">${label}</div><pre>${text == null ? `<span class="abs">${absent}</span>` : (esc(text) || '<span class="abs">(empty)</span>')}</pre></div>`
  const cmp = (f.oldText != null || f.newText != null)
    ? `<details class="fullfile"><summary>full file · original ↔ new</summary><div class="cmp">${side('original (merge-base)', f.oldText, '— added —')}${side('new (HEAD)', f.newText, '— deleted —')}</div></details>`
    : ''
  return `<details class="file"><summary>${row}${f.truncated ? '<span class="note">truncated</span>' : ''}</summary>
    <div class="file-body">${f.patch ? `<div class="patch">${renderPatch(f.patch)}</div>` : '<div class="note">no textual diff</div>'}${cmp}</div></details>`
}

function renderNode(n: ExportNode): string {
  const stat = `<span class="diffstat"><span class="add">+${n.additions}</span> <span class="del">−${n.deletions}</span> · ${n.files.length} file(s)</span>`
  const fileList = n.files.length ? `<div class="files">${n.files.map(renderFile).join('')}</div>` : ''
  let proof: string
  if (n.affectedScenarios) proof = [...n.unmeasured.map(renderUnmeasured), ...n.readings.map(renderReading)].join('')
  else if (n.uncoveredFrontend) proof = `<div class="blindspot">⚠ a frontend node with no eval.md — its loss is unmeasured. Give it a scenario so this change can be verified.</div>`
  else if (n.hasEvalFile) proof = `<div class="noev">no declared scenario is affected by this worktree</div>`
  else proof = `<div class="noev">no measurable surface (no eval.md)</div>`
  return `<article class="node" style="--hue:${n.hue}">
    <div class="nhead">
      <span class="huedot"></span>
      <span class="ntitle">${esc(n.title)}</span>
      <span class="nid">${esc(n.id)}</span>
      ${scoreBadge(n.score, n.score ?? undefined)}
      ${stat}
    </div>
    ${n.desc ? `<div class="ndesc">${esc(n.desc)}</div>` : ''}
    ${fileList}
    <div class="eval-list">${proof}</div>
  </article>`
}

export function renderExportHtml(m: ExportModel): string {
  const idShort = m.id.slice(0, 8)
  const ribbon = [
    ...m.gates.map((g) => `<span class="chip ${g.ok ? 'ok' : 'bad'}" title="${esc(g.detail)}">${g.ok ? '✓' : '✗'} ${esc(g.label)}</span>`),
    m.score.total ? `<span class="chip ${m.score.passed === m.score.total ? 'ok' : 'warn'}" title="affected scenarios fresh-passing; ${m.score.fresh}/${m.score.total} have a fresh reading">★ ${m.score.passed}/${m.score.total} passing</span>` : `<span class="chip warn" title="no scenario is affected by this worktree">★ no affected scenarios</span>`,
  ].join('')
  const gates = m.gates.map((g) => `<li class="${g.ok ? 'ok' : 'bad'}"><span class="gmark">${g.ok ? '✓' : '✗'}</span><span class="glabel">${esc(g.label)}</span><span class="gdetail">${esc(g.detail)}</span></li>`).join('')
  const otherBlock = m.otherFiles.length
    ? `<article class="node other"><div class="nhead"><span class="ntitle">other files</span><span class="nid">unclaimed by any node</span></div>
       <div class="files">${m.otherFiles.map(renderFile).join('')}</div></article>`
    : ''
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>evals · ${esc(m.title)}</title>
<style>${STYLE}</style>
</head><body>
<main class="evals">
  <header class="masthead">
    <div class="eyebrow">SpexCode · session eval export</div>
    <h1 class="claim">${esc(m.title)}</h1>
    <div class="meta">session <code>${esc(idShort)}</code>${m.branch ? ` · <code>${esc(m.branch)}</code>` : ''}${m.node ? ` · node <code>${esc(m.node)}</code>` : ''} · ${m.ahead} commit(s) · ${m.nodes.length} node(s) · <span class="ts">${esc(m.generatedAt)}</span></div>
    <div class="ribbon">${ribbon}</div>
  </header>
  <section class="evidence-section">
    <h2>Evidence — measured loss</h2>
    ${m.nodes.map(renderNode).join('')}
    ${otherBlock}
  </section>
  <section class="gates-section">
    <h2>Merge gates</h2>
    <ul class="gates">${gates}</ul>
  </section>
  <footer>Generated by <code>spex eval ls --session ${esc(idShort)} --export</code> — the optimizer's measured loss, presented for the merge decision. A spec is the loss; commits are the optimizer; eval keeps the score.</footer>
</main>
</body></html>`
}

// the document's inline stylesheet — dark, matching the board's palette and the eval score colours, so the
// proof reads as one surface with the dashboard. Self-contained (no external font/asset).
const STYLE = `
:root{--bg:#0b0e14;--panel:#11161f;--panel2:#0e131b;--ink:#c9d4e3;--dim:#7c899c;--line:#1e2733;--accent:#4cc2a0;--green:#3fb950;--red:#f85149;--grey:#6e7b8c;--amber:#d29922}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
code{background:#0006;padding:.05em .35em;border-radius:4px;font-size:.88em;color:#aee1d2}
.evals{max-width:920px;margin:0 auto;padding:40px 24px 80px}
.masthead{padding:30px 30px 26px;border:1px solid var(--line);border-radius:16px;background:radial-gradient(1200px 240px at 0% 0%,#16352c66,transparent),linear-gradient(160deg,#141b26,#0d121a);box-shadow:0 20px 60px -30px #000}
.eyebrow{font:600 11px/1 ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}
.claim{margin:14px 0 10px;font-size:30px;line-height:1.2;font-weight:700;color:#eef3fa;letter-spacing:-.01em}
.meta{color:var(--dim);font-size:13px}
.meta code{background:#0008;color:#9fb3c8}
.ribbon{margin-top:18px;display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:.4em;font:600 12px/1 ui-monospace,monospace;padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:#0c1118}
.chip.ok{color:var(--green);border-color:#1c3a26}
.chip.bad{color:var(--red);border-color:#3a1f1f}
.chip.warn{color:var(--amber);border-color:#3a3320}
h2{margin:42px 0 16px;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);font-weight:700}
.node{margin:14px 0;padding:18px 20px;border:1px solid var(--line);border-radius:12px;background:var(--panel);border-left:3px solid hsl(var(--hue,210),55%,55%)}
.node.other{border-left-color:var(--grey)}
.nhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.huedot{width:11px;height:11px;border-radius:3px;background:hsl(var(--hue,210),60%,55%);flex:none}
.ntitle{font-weight:700;color:#e7eef7;font-size:16px}
.nid{font:12px/1 ui-monospace,monospace;color:var(--dim)}
.ndesc{margin:8px 0 4px;color:var(--dim);font-size:13px}
.diffstat{margin-left:auto;font:12px/1 ui-monospace,monospace;color:var(--dim)}
.add{color:var(--green)}.del{color:var(--red)}
.files{margin:12px 0 0;border-top:1px solid var(--line)}
.file{border-bottom:1px solid #0c1117}
.file>summary,.frow{display:flex;align-items:center;gap:10px;padding:6px 2px;font:12px/1.4 ui-monospace,monospace}
.file>summary{cursor:pointer;list-style:none}
.file>summary::-webkit-details-marker{display:none}
.file>summary::before{content:'▸ ';color:var(--dim)}
.file[open]>summary::before{content:'▾ '}
.file.flat .frow{padding-left:14px}
.fstatus{flex:none;width:84px;color:var(--dim);text-transform:uppercase;font-size:10px;letter-spacing:.06em}
.fstatus.added{color:var(--green)}.fstatus.deleted{color:var(--red)}.fstatus.modified{color:var(--amber)}
.fpath{color:#aebccd;overflow:hidden;text-overflow:ellipsis}.fnum{margin-left:auto;flex:none}
.note{color:var(--dim);font-style:italic;font-size:11px;margin-left:8px}
.file-body{padding:2px 0 12px 14px}
.patch{font:12px/1.5 ui-monospace,monospace;background:#05080d;border:1px solid var(--line);border-radius:8px;overflow:auto;max-height:480px;white-space:pre}
.dl{display:block;padding:0 10px;min-height:1.5em}
.dl.a{background:#11331f;color:#86e2ad}.dl.d{background:#3a1616;color:#f3a3a0}.dl.h{color:#74a6f7;background:#0c1830}.dl.m{color:var(--dim)}
.fullfile{margin-top:10px}
.fullfile>summary{cursor:pointer;color:var(--accent);font:600 11px/1 ui-monospace,monospace;padding:6px 0}
.cmp{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.side{flex:1;min-width:300px}
.side-h{font:600 10px/1 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);padding:0 0 6px}
.side pre{margin:0;padding:10px 12px;background:#05080d;border:1px solid var(--line);border-radius:8px;max-height:440px;overflow:auto;font:11px/1.5 ui-monospace,monospace;color:#aebccd;white-space:pre}
.abs{color:var(--dim);font-style:italic}
.eval-list{margin-top:8px}
.eval-entry{margin-top:14px;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)}
.rhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.scenario{font-weight:600;color:#dde7f1}
.impact{font:600 10px/1 ui-monospace,monospace;color:var(--accent)}
.rmeta{margin-left:auto;font:11px/1 ui-monospace,monospace;color:var(--dim)}
.verdict{font:600 11px/1 ui-monospace,monospace;padding:3px 8px;border-radius:6px;border:1px solid var(--line)}
.verdict.pass{color:var(--green);border-color:#1c3a26}.verdict.fail{color:var(--red);border-color:#3a1f1f}
.verdict.note{color:var(--amber)}.verdict.legacy{color:var(--grey)}
.stale{font:600 10px/1 ui-monospace,monospace;color:var(--amber);border:1px solid #3a3320;border-radius:6px;padding:3px 7px}
.score{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:2px solid var(--grey);font-size:11px;font-weight:700;flex:none}
.score.pass{border-color:var(--green);color:var(--green)}
.score.fail{border-color:var(--red);color:var(--red)}
.score.stalePass,.score.staleFail{border-color:var(--grey);color:var(--grey)}
.score.empty{border-style:dashed}
.expected{margin:10px 0 0;color:var(--dim);font-size:13px}.expected b{color:#9fb3c8;font-weight:600}
.rnote{margin:8px 0 0;color:var(--amber);font-size:13px}.rnote b{font-weight:600}
.evidence{margin:12px 0 0}
.shot{max-width:100%;border:1px solid var(--line);border-radius:8px;box-shadow:0 14px 40px -24px #000;display:block}
.transcript{max-height:420px;overflow:auto;margin:0;padding:12px 14px;background:#05080d;border:1px solid var(--line);border-radius:8px;font-size:12px;color:#9fdcc6;white-space:pre-wrap;word-break:break-word}
.transcript.data{color:#cbb6ff;border-left:3px solid #6b46c1}
.noev,.blindspot{margin-top:10px;padding:10px 12px;border-radius:8px;font-size:13px;color:var(--dim);background:#0a0e15;border:1px dashed var(--line)}
.blindspot{color:var(--amber);border-color:#3a3320}
.gates{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.gates li{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--panel)}
.gates li:last-child{border-bottom:0}
.gmark{font-weight:700}.gates li.ok .gmark{color:var(--green)}.gates li.bad .gmark{color:var(--red)}
.glabel{font-weight:600;width:120px;color:#dbe6f2}.gdetail{color:var(--dim);font:12px/1 ui-monospace,monospace}
footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);color:var(--dim);font-size:12px;text-align:center}
`

// ---- the session EVAL model ([[session-eval]]'s interactive face) ----
// The lean, TIERED counterpart of buildExportModel: the same worktree-rooted marshaling, but rows only —
// no diff enrichment, no inlined evidence bytes (the dashboard's Eval tab rides the shared eval
// components: blobs stream lazily from /api/evidence on open). Each reading carries `inSession`
// (this session filed it, or its codeSha is one of the branch's own commits — a diagnostic session
// that changed no code still owns the readings it filed at the merge-base) so the tab can lead with
// what THIS session measured, ✦-marked, over the inherited baseline.
export type SessionEvalNode = {
  id: string
  title: string
  hue: number
  desc: string
  hasEvalFile: boolean
  uncoveredFrontend: boolean
  // Changed frontend code that no declared scenario covers. This is node-level UNKNOWN coverage, never a
  // synthetic scenario: it stays outside scenario totals and filters while remaining visible to consumers.
  unknownCoverage: string[]
  // Already scoped by selectImpactedScenarios. Consumers must not infer impact from node membership,
  // freshness, or the full eval.md again.
  scenarios: SessionScenarioInfo[]
  // each reading carries the trunk eval-concern thread for its (node, scenario) ([[remark-teeth]] / directive
  // 3): the server-side join (attached by evalTimeline as `EvalEntry.thread`), so the session tab's event
  // detail reads the comment/remark track directly instead of re-matching a concern key client-side. Absent
  // until the pair has its first remark.
  evals: (EvalEntry & { inSession: boolean })[]
}
export type SessionEvals = {
  id: string
  node: string | null
  branch: string | null
  title: string
  ahead: number
  dirtyNonRuntime: number
  gates: ExportGate[]
  nodes: SessionEvalNode[]
  summary: SessionEvalSummary
  evalRevision: SessionEvalRevision
}

export type SessionEvalSummary = {
  measured: number
  total: number
  pass: number
  fail: number
  review: number
  blind: number
  unknown: number
}

export type SessionEvalRevision = {
  epoch: string
  generation: number
  content: string
}

export type SessionEvalProjection = {
  epoch: string
  generation: number
  phase: 'loading' | 'updating' | 'ready' | 'error'
  revision?: string
  value?: SessionEvalSummary
  lastKnown?: { generation: number; revision: string; value: SessionEvalSummary }
}

export class SessionEvalUnavailableError extends Error {
  override name = 'SessionEvalUnavailableError'
}

// The one count projection over the already-affected rows. This is the backend source both the graph
// glance and the demand full model carry; consumers never repeat impact selection or score classification.
export function sessionEvalSummary(nodes: SessionEvalNode[]): SessionEvalSummary {
  let total = 0, measured = 0, pass = 0, fail = 0, unknown = 0
  for (const node of nodes) {
    total += node.scenarios.length
    unknown += node.unknownCoverage.length
    const latest = new Map(latestPerScenario(node.evals).map((reading) => [reading.scenario, reading]))
    for (const scenario of node.scenarios) {
      const reading = latest.get(scenario.name)
      if (!reading) continue
      measured++
      if (reading.fresh && reading.verdict?.status === 'pass') pass++
      else if (reading.fresh && reading.verdict?.status === 'fail') fail++
    }
  }
  return {
    measured,
    total,
    pass,
    fail,
    review: measured - pass - fail,
    blind: Math.max(0, total - measured),
    unknown,
  }
}

async function sessionScopeNodes(
  id: string,
  ctx: Awaited<ReturnType<typeof evalContext>>,
  changedPaths: ReadonlySet<string>,
  dirtyPaths: ReadonlySet<string>,
  oldPaths: ReadonlyMap<string, string>,
  base: string,
  shas: ReadonlySet<string>,
  latestOnly = false,
): Promise<SessionEvalNode[]> {
  const evalById = new Map(ctx.ynodes.map((node) => [node.id, node]))
  const nodes: SessionEvalNode[] = []

  for (const spec of ctx.specs) {
    const evalNode = evalById.get(spec.id)
    const current = evalNode?.scenarios ?? []
    // Unknown means the node has no measurement contract at all. A node that has eval.md is known even
    // when individual scenarios narrow their code axes; partial scenario ownership is not a synthetic gap.
    const unknownCoverage = evalNode ? [] : unknownCoveragePaths(spec.code, changedPaths)

    if (!evalNode) {
      if (unknownCoverage.length) {
        nodes.push({
          id: spec.id, title: spec.title, hue: spec.hue, desc: spec.desc,
          hasEvalFile: false, uncoveredFrontend: true, unknownCoverage,
          scenarios: [], evals: [],
        })
      }
      continue
    }

    const evalFileChanged = changedPaths.has(evalNode.evalPath)
    const sidecarPath = relative(ctx.root, evalNode.sidecarPath)
    if (!sessionEvalNodeCandidate(current, spec.code, evalNode.evalPath, sidecarPath, changedPaths, dirtyPaths)) continue

    const timeline = await evalTimeline(spec.id, ctx)
    // A reading is this session's own when the session filed it OR its anchor is a branch commit. This is
    // the same marker the UI and CLI render; measurement impact consumes that marker instead of inventing
    // another attribution rule.
    const evals = timeline.readings.map((reading) => ({
      ...reading,
      inSession: reading.by === id || shas.has(reading.codeSha),
    }))
    const baseEvalPath = mergeBasePath(evalNode.evalPath, oldPaths)
    const baseHasEval = evalFileChanged && base
      ? (await gitA(['-C', ctx.root, 'ls-tree', '--name-only', base, '--', baseEvalPath])).trim() !== ''
      : false
    const baseScenarios = baseHasEval
      ? parseScenarios(await gitA(['-C', ctx.root, 'show', `${base}:${baseEvalPath}`]))
      : []
    const scoped = scopeSessionScenarioRows(current, baseScenarios, timeline.scenarios, spec.code, changedPaths, evalFileChanged, evals)
    if (!scoped.scenarios.length && !unknownCoverage.length) continue

    nodes.push({
      id: spec.id, title: spec.title, hue: spec.hue, desc: spec.desc,
      hasEvalFile: timeline.hasEvalFile,
      uncoveredFrontend: !timeline.hasEvalFile && unknownCoverage.length > 0,
      unknownCoverage,
      scenarios: scoped.scenarios,
      // Preserve the whole A/B history for selected scenarios. Fresh, stale, legacy and missing remain
      // honest downstream states; impact selection never removes a row because its reading is stale.
      evals: latestOnly ? latestPerScenario(scoped.evals) as (EvalEntry & { inSession: boolean })[] : scoped.evals,
    })
  }

  return nodes
}

type ReviewPayloadValue = NonNullable<Awaited<ReturnType<typeof reviewPayload>>>
type SessionEvalModel = Omit<SessionEvals, 'summary' | 'evalRevision'>

async function buildSessionEvalModel(
  id: string,
  payload: ReviewPayloadValue,
  wtPath: string | null,
  latestOnly: boolean,
): Promise<SessionEvalModel> {
  // spec tree from the session worktree, same root as readings/indexes — a branch-NEW node must exist
  // in this model or the Eval tab/deep link can never reach its readings (see buildExportModel above).
  const ctxRoot = wtPath ?? repoRoot()
  const specs = await loadSpecs(ctxRoot)
  const specById = new Map(specs.map((s) => [s.id, s]))
  const [didx, hidx] = await Promise.all([driftIndex(ctxRoot), historyIndex(ctxRoot)])
  const ctx = await evalContext(ctxRoot, specs, didx, hidx)
  const changedPaths = new Set(payload.diff.map((file) => file.path))
  const oldPaths = new Map(payload.diff.flatMap((file) => file.oldPath ? [[file.path, file.oldPath] as const] : []))
  const [base, shaRows, dirtyState] = wtPath ? await Promise.all([
    gitA(['-C', wtPath, 'merge-base', mainBranch(), 'HEAD']).then((out) => out.trim()),
    gitA(['-C', wtPath, 'rev-list', `${mainBranch()}..HEAD`]),
    worktreeDirtyState(wtPath),
  ]) : ['', '', { paths: new Set<string>(), oldPaths: new Map<string, string>() }] as const
  const dirtyPaths = dirtyState.paths
  // A session evaluation is the proposal as it exists now, not only its committed slice. A dirty source,
  // staged rename, draft eval.md, or uncommitted sidecar therefore enters the SAME affected selector.
  for (const path of dirtyPaths) changedPaths.add(path)
  for (const [path, oldPath] of dirtyState.oldPaths) if (!oldPaths.has(path)) oldPaths.set(path, oldPath)
  // this session's own commits — the membership test behind `inSession` and measurement impact
  const shas = new Set(shaRows.split('\n').filter(Boolean))
  const nodes = await sessionScopeNodes(id, ctx, changedPaths, dirtyPaths, oldPaths, base, shas, latestOnly)
  // nodes with in-session measurements lead, then the most-measured — the session's own evidence first.
  nodes.sort((a, b) => (b.evals.filter((e) => e.inSession).length - a.evals.filter((e) => e.inSession).length)
    || (b.scenarios.length - a.scenarios.length) || (b.unknownCoverage.length - a.unknownCoverage.length))

  const primary = payload.node && specById.has(payload.node) ? specById.get(payload.node)!.title : null
  return {
    id,
    node: payload.node,
    branch: payload.branch,
    title: primary || payload.node || payload.branch || id.slice(0, 8),
    ahead: payload.ahead,
    dirtyNonRuntime: payload.dirtyNonRuntime,
    gates: gateRows(payload),
    nodes,
  }
}

function untrackedPaths(status: string): string[] {
  const out: string[] = []
  const records = status.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const code = record.slice(0, 2)
    const path = record.slice(3)
    if (code === '??' && path) out.push(path)
    if ((code.includes('R') || code.includes('C')) && records[i + 1]) i++
  }
  return out.sort()
}

// One content fingerprint over every axis that can alter the scoped summary. Committed declarations,
// sidecars and governed code are covered by HEAD; the moving comparison base by the base ref;
// index/worktree/rename content by the HEAD-relative binary diff; untracked bytes are folded explicitly.
// Remark tracks are folded directly as well as through main: the disposable plain-file issue store used by
// controlled runs has no ref move, but it is still the same freshness input and must obey the same fence.
export async function sessionEvalContentRevision(wtPath: string): Promise<string> {
  const base = mainBranch()
  const [mainSha, headSha, mergeBase, status, dirtyDiff] = await Promise.all([
    gitA(['-C', wtPath, 'rev-parse', base]).then((out) => out.trim()),
    gitA(['-C', wtPath, 'rev-parse', 'HEAD']).then((out) => out.trim()),
    gitA(['-C', wtPath, 'merge-base', base, 'HEAD']).then((out) => out.trim()),
    gitA(['-C', wtPath, '-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
    gitA(['-C', wtPath, 'diff', 'HEAD', '--binary', '--no-ext-diff', '--']),
  ])
  const untracked = await Promise.all(untrackedPaths(status).map(async (path) => {
    try {
      const bytes = await readFile(join(wtPath, path))
      return `${path}\0${createHash('sha256').update(bytes).digest('hex')}`
    } catch {
      return `${path}\0<gone>`
    }
  }))
  const remarks = [...loadEvalRemarkTracks()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, track]) => [key, track.thread])
  return createHash('sha256')
    .update([mainSha, headSha, mergeBase, status, dirtyDiff, ...untracked, JSON.stringify(remarks)].join('\0'))
    .digest('hex')
}

type SummaryBuildResult =
  | { kind: 'stable'; revision: string; summary: SessionEvalSummary }
  | { kind: 'unstable' }
  | { kind: 'missing' }

export type SessionEvalSummaryBuilder = (id: string, path: string) => Promise<SummaryBuildResult>

type ProjectionEntry = {
  id: string
  path: string
  generation: number
  phase: SessionEvalProjection['phase']
  current?: { generation: number; revision: string; value: SessionEvalSummary }
  scheduled: number | null
  running: number | null
  observerHolds: Set<string>
}

type ProjectionTarget = 'all' | { id?: string; path?: string }

// Pure generation coordinator around an injected stable builder. Snapshot construction only serializes
// entries and authorizes the newest dirty generations; the async batch runs after that snapshot has captured
// `updating(lastKnown)`, then emits one completion nudge for all stable/error results in the batch.
export class SessionEvalProjectionCache {
  readonly epoch: string
  private readonly entries = new Map<string, ProjectionEntry>()
  private readonly observerHolds = new Map<string, ProjectionTarget>()
  private readonly observerWaiters = new Set<() => void>()
  private batch: Promise<void> | null = null
  private notify: () => void

  constructor(private readonly build: SessionEvalSummaryBuilder, notify: () => void = () => {}, epoch: string = randomUUID()) {
    this.notify = notify
    this.epoch = epoch
  }

  setNotify(notify: () => void): void { this.notify = notify }

  snapshot(sessions: { id: string; path: string }[]): Map<string, SessionEvalProjection> {
    const live = new Set(sessions.map((session) => session.id))
    for (const id of this.entries.keys()) if (!live.has(id)) this.entries.delete(id)
    const out = new Map<string, SessionEvalProjection>()
    for (const session of sessions) {
      let entry = this.entries.get(session.id)
      if (!entry) {
        entry = {
          id: session.id,
          path: session.path,
          generation: 0,
          phase: 'loading',
          scheduled: null,
          running: null,
          observerHolds: new Set(),
        }
        this.entries.set(session.id, entry)
      } else entry.path = session.path
      entry.observerHolds = new Set([...this.observerHolds]
        .filter(([, target]) => this.matches(entry!, target))
        .map(([observer]) => observer))
      if (entry.observerHolds.size) entry.phase = 'updating'
      if ((entry.phase === 'loading' || entry.phase === 'updating')
        && entry.observerHolds.size === 0
        && entry.running !== entry.generation && entry.scheduled !== entry.generation) entry.scheduled = entry.generation
      out.set(session.id, this.project(entry))
    }
    queueMicrotask(() => this.startBatch())
    return out
  }

  invalidate(target: ProjectionTarget = 'all'): number {
    let changed = 0
    for (const entry of this.entries.values()) {
      if (target !== 'all' && target.id !== entry.id && target.path !== entry.path) continue
      entry.generation++
      entry.phase = 'updating'
      entry.scheduled = null
      changed++
    }
    return changed
  }

  holdObserver(observer: string, target: ProjectionTarget = 'all'): boolean {
    if (this.observerHolds.has(observer)) return false
    this.observerHolds.set(observer, target)
    for (const entry of this.entries.values()) {
      if (!this.matches(entry, target)) continue
      entry.observerHolds.add(observer)
      entry.generation++
      entry.phase = 'updating'
      entry.scheduled = null
    }
    return true
  }

  releaseObserver(observer: string): boolean {
    if (!this.observerHolds.delete(observer)) return false
    for (const entry of this.entries.values()) {
      if (!entry.observerHolds.delete(observer)) continue
      entry.generation++
      entry.phase = 'updating'
      entry.scheduled = null
    }
    for (const check of [...this.observerWaiters]) check()
    return true
  }

  isObserverHeld(id: string, path: string): boolean {
    const entry = this.entries.get(id)
    if (entry?.observerHolds.size) return true
    return [...this.observerHolds.values()].some((target) => this.matches({ id, path }, target))
  }

  waitUntilObservable(id: string, path: string, timeoutMs: number): Promise<boolean> {
    if (!this.isObserverHeld(id, path)) return Promise.resolve(true)
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (observable: boolean) => {
        if (timer) clearTimeout(timer)
        this.observerWaiters.delete(check)
        resolve(observable)
      }
      const check = () => {
        if (!this.isObserverHeld(id, path)) finish(true)
      }
      this.observerWaiters.add(check)
      timer = setTimeout(() => finish(false), Math.max(0, timeoutMs))
      timer.unref?.()
      check()
    })
  }

  get(id: string): SessionEvalProjection | null {
    const entry = this.entries.get(id)
    return entry ? this.project(entry) : null
  }

  async idle(): Promise<void> {
    await Promise.resolve()
    while (this.batch) await this.batch
  }

  accept(id: string, generation: number, revision: string, value: SessionEvalSummary): boolean {
    const entry = this.entries.get(id)
    if (!entry || entry.generation !== generation || entry.observerHolds.size) return false
    const changed = entry.phase !== 'ready' || entry.current?.revision !== revision
    entry.current = { generation, revision, value }
    entry.phase = 'ready'
    entry.scheduled = null
    if (changed) this.notify()
    return true
  }

  private project(entry: ProjectionEntry): SessionEvalProjection {
    const stable = entry.current
    return {
      epoch: this.epoch,
      generation: entry.generation,
      phase: entry.phase,
      ...(entry.phase === 'ready' && stable
        ? { revision: stable.revision, value: stable.value }
        : stable ? { lastKnown: stable } : {}),
    }
  }

  private matches(entry: { id: string; path: string }, target: ProjectionTarget): boolean {
    return target === 'all' || target.id === entry.id || target.path === entry.path
  }

  private startBatch(): void {
    if (this.batch) return
    const hasScheduled = () => [...this.entries.values()].some((entry) => entry.scheduled != null && entry.running == null)
    if (!hasScheduled()) return
    this.batch = (async () => {
      let publish = false
      while (hasScheduled()) {
        const jobs = [...this.entries.values()].filter((entry) => entry.scheduled != null && entry.running == null)
        const changed = await Promise.all(jobs.map((entry) => this.runEntry(entry)))
        publish = publish || changed.some(Boolean)
      }
      if (publish) this.notify()
    })().finally(() => {
      this.batch = null
      if (hasScheduled()) this.startBatch()
    })
  }

  private async runEntry(entry: ProjectionEntry): Promise<boolean> {
    const generation = entry.scheduled!
    entry.scheduled = null
    entry.running = generation
    let result: SummaryBuildResult
    try { result = await this.build(entry.id, entry.path) }
    catch (error) {
      console.warn(`spec-eval: session summary build failed for ${entry.id}: ${error instanceof Error ? error.message : String(error)}`)
      result = { kind: 'missing' }
    }
    entry.running = null
    if (this.entries.get(entry.id) !== entry || entry.generation !== generation) return false
    if (result.kind === 'unstable') {
      entry.generation++
      entry.phase = 'updating'
      entry.scheduled = null
      this.notify()
      return false
    }
    if (result.kind === 'missing') {
      entry.phase = 'error'
      return true
    }
    entry.current = { generation, revision: result.revision, value: result.summary }
    entry.phase = 'ready'
    return true
  }
}

async function buildSummaryAttempt(id: string, _path: string): Promise<SummaryBuildResult> {
  const payload = await reviewPayload(id)
  if (!payload) return { kind: 'missing' }
  const wtPath = worktreePathForBranch(payload.branch)
  const ctxPath = wtPath ?? repoRoot()
  const before = await sessionEvalContentRevision(ctxPath)
  const cacheKey = `${id}\0${before}`
  const cached = summaryByContent.get(cacheKey)
  if (cached) {
    const after = await sessionEvalContentRevision(ctxPath)
    return before === after
      ? { kind: 'stable', revision: after, summary: cached }
      : { kind: 'unstable' }
  }
  const model = await buildSessionEvalModel(id, payload, wtPath, true)
  const after = await sessionEvalContentRevision(ctxPath)
  if (before !== after) return { kind: 'unstable' }
  const summary = sessionEvalSummary(model.nodes)
  // Keep one content-addressed stable value per session. Revisions, not elapsed time, decide reuse.
  for (const key of summaryByContent.keys()) if (key.startsWith(`${id}\0`)) summaryByContent.delete(key)
  summaryByContent.set(cacheKey, summary)
  return { kind: 'stable', revision: after, summary }
}

const summaryByContent = new Map<string, SessionEvalSummary>()
const projectionCache = new SessionEvalProjectionCache(buildSummaryAttempt)
const OBSERVER_RECOVERY_TIMEOUT_MS = 10_000

async function awaitObservableInputs(id: string, path: string): Promise<void> {
  if (await projectionCache.waitUntilObservable(id, path, OBSERVER_RECOVERY_TIMEOUT_MS)) return
  throw new SessionEvalUnavailableError('session eval inputs remain temporarily unobservable')
}

export function setSessionEvalProjectionNotify(notify: () => void): void { projectionCache.setNotify(notify) }
export function sessionEvalProjections(sessions: { id: string; path: string }[]): Map<string, SessionEvalProjection> {
  return projectionCache.snapshot(sessions)
}
export function invalidateSessionEvalProjections(target: 'all' | { id?: string; path?: string } = 'all'): number {
  return projectionCache.invalidate(target)
}
export function holdSessionEvalProjectionObserver(
  observer: string,
  target: 'all' | { id?: string; path?: string } = 'all',
): boolean {
  return projectionCache.holdObserver(observer, target)
}
export function releaseSessionEvalProjectionObserver(observer: string): boolean {
  return projectionCache.releaseObserver(observer)
}
export async function awaitSessionEvalProjectionIdle(): Promise<void> { await projectionCache.idle() }

export async function buildSessionEvals(id: string): Promise<SessionEvals | null> {
  // A full model is demand-only. It fences itself against both the content fingerprint and the graph cache's
  // generation, and only publishes its summary when it is still the newest observed generation.
  for (;;) {
    await projectionCache.idle()
    const payload = await reviewPayload(id)
    if (!payload) return null
    const wtPath = worktreePathForBranch(payload.branch)
    const ctxPath = wtPath ?? repoRoot()
    await awaitObservableInputs(id, ctxPath)
    const known = projectionCache.get(id)
    const generation = known?.generation ?? 0
    const before = await sessionEvalContentRevision(ctxPath)
    const model = await buildSessionEvalModel(id, payload, wtPath, false)
    const after = await sessionEvalContentRevision(ctxPath)
    const current = projectionCache.get(id)
    if (before !== after || projectionCache.isObserverHeld(id, ctxPath)
      || (current && current.generation !== generation)) {
      if (before !== after) projectionCache.invalidate({ id })
      continue
    }
    const summary = sessionEvalSummary(model.nodes)
    const cacheKey = `${id}\0${after}`
    for (const key of summaryByContent.keys()) if (key.startsWith(`${id}\0`)) summaryByContent.delete(key)
    summaryByContent.set(cacheKey, summary)
    if (current) projectionCache.accept(id, generation, after, summary)
    return {
      ...model,
      summary,
      evalRevision: { epoch: projectionCache.epoch, generation, content: after },
    }
  }
}
