import { dirname } from 'node:path'
import { git, gitA, repoRoot, driftIndex, historyIndex, type ReviewDiffFile } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { mainBranch } from '../../spec-cli/src/layout.js'
import { reviewPayload } from '../../spec-cli/src/sessions.js'
import { evalTimeline, evalContext, readBlobByHash, type EvalEntry } from './evaltab.js'
import { isUiPath } from './cli.js'

// ---- the model ----

type ScoreState = 'pass' | 'fail' | 'stalePass' | 'staleFail' | 'empty' | null

// one yatsu reading rendered for the proof: the latest measurement of one scenario, with its evidence
// resolved to inline bytes (an image data-URI, or transcript text) so the document is self-contained.
export type ProofReading = {
  scenario: string
  expected: string
  verdict?: EvalEntry['verdict']
  fresh: boolean
  staleAxes: string[]
  score: ScoreState
  evaluator: string
  ts: string
  evidence:
    | { kind: 'image'; dataUri: string }
    | { kind: 'transcript'; text: string }
    | { kind: 'miss' }
    | { kind: 'none' }
}

// patch ''/old·new null = nothing to show (added → no old, deleted → no new), past the enrichment cap (omitted), or too large (truncated)
export type ProofFile = ReviewDiffFile & {
  patch: string
  oldText: string | null
  newText: string | null
  truncated: boolean
  omitted: boolean
}

// one changed spec node: its diff slice (the files this node owns that the session touched) joined with its
// measured loss (latest reading per scenario). A frontend node with no yatsu.md is an honest blind spot.
export type ProofNode = {
  id: string
  title: string
  hue: number
  desc: string
  files: ProofFile[]
  additions: number
  deletions: number
  hasYatsu: boolean
  uncoveredFrontend: boolean
  score: ScoreState
  readings: ProofReading[]
}

export type ProofGate = { label: string; ok: boolean; detail: string }

export type ProofModel = {
  id: string
  node: string | null
  branch: string | null
  title: string                  // DERIVED headline (the node, else the branch) — no agent-authored claim
  generatedAt: string
  ahead: number
  dirtyNonRuntime: number
  gates: ProofGate[]
  score: { passed: number; total: number; fresh: number }   // the yatsu summary across all nodes
  nodes: ProofNode[]
  otherFiles: ProofFile[]        // changed files no spec node claims
}

// null when no session has that id (route → 404).
export async function buildProofModel(id: string): Promise<ProofModel | null> {
  const payload = await reviewPayload(id)
  if (!payload) return null
  const specs = await loadSpecs()
  const specById = new Map(specs.map((s) => [s.id, s]))
  // root the eval context at the SESSION's worktree (its branch's readings/freshness), not the backend checkout which would show main's; specs stay backend-shared (paths/titles/hues), only readings + drift are per-worktree
  const wtPath = worktreePathForBranch(payload.branch)
  const ctxRoot = wtPath ?? repoRoot()
  const ctx = evalContext(ctxRoot, specs, await driftIndex(ctxRoot), await historyIndex(ctxRoot))

  // enrich each changed file with its unified diff + full before/after content (derived from the session
  // worktree at the merge-base ↔ HEAD), so the proof can drill summary → diff → whole-file comparison with no
  // extra fetch. Capped at MAX_ENRICHED_FILES so a huge changeset can't bloat the page; the rest keep their
  // row but say so (omitted), never silently blank.
  const base = wtPath ? (await gitA(['-C', wtPath, 'merge-base', mainBranch(), 'HEAD'])).trim() : ''
  const enriched = new Map<string, ProofFile>()
  let budget = MAX_ENRICHED_FILES
  for (const f of payload.diff) {
    if (wtPath && base && budget > 0) { enriched.set(f.path, await enrichFile(wtPath, base, f)); budget-- }
    else enriched.set(f.path, { ...f, patch: '', oldText: null, newText: null, truncated: false, omitted: !!(wtPath && base) })
  }

  // group the session's real changes (merge-base diff) by the spec node that owns each file.
  const byNode = new Map<string, ProofFile[]>()
  const otherFiles: ProofFile[] = []
  for (const f of payload.diff) {
    const nid = nodeForFile(f.path, specs, payload.node)
    const pf = enriched.get(f.path)!
    if (nid) { const arr = byNode.get(nid) ?? []; arr.push(pf); byNode.set(nid, arr) }
    else otherFiles.push(pf)
  }
  // the session's primary node always appears, even if it has no file in the diff yet.
  if (payload.node && specById.has(payload.node) && !byNode.has(payload.node)) byNode.set(payload.node, [])

  const nodes: ProofNode[] = []
  let passed = 0, total = 0, fresh = 0
  for (const [nid, files] of byNode) {
    const spec = specById.get(nid)
    const tl = await evalTimeline(nid, ctx)
    const latest = latestPerScenario(tl.readings)
    const readings = await Promise.all(latest.map(toProofReading))
    for (const r of latest) {
      total++
      if (r.fresh) fresh++
      if (r.fresh && r.verdict?.status === 'pass') passed++
    }
    nodes.push({
      id: nid,
      title: spec?.title ?? nid,
      hue: spec?.hue ?? 210,
      desc: spec?.desc ?? '',
      files,
      additions: files.reduce((a, f) => a + f.additions, 0),
      deletions: files.reduce((a, f) => a + f.deletions, 0),
      hasYatsu: tl.hasYatsu,
      uncoveredFrontend: !tl.hasYatsu && (spec?.code ?? []).some(isUiPath),
      score: nodeScore(tl.hasYatsu, latest),
      readings,
    })
  }
  // measured nodes first, then by amount changed — the strongest evidence and the biggest change lead.
  nodes.sort((a, b) => (b.readings.length - a.readings.length) || ((b.additions + b.deletions) - (a.additions + a.deletions)))

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

// the gate checklist, derived from the cockpit payload's gates (the SAME numbers `spex review` prints).
function gateRows(p: NonNullable<Awaited<ReturnType<typeof reviewPayload>>>): ProofGate[] {
  const g = p.gates
  return [
    { label: 'typecheck', ok: g.typecheck.ok, detail: g.typecheck.ok ? 'clean' : `${g.typecheck.errorCount} error(s)` },
    { label: 'lint', ok: g.lint.errorCount === 0, detail: `${g.lint.errorCount} error(s), ${g.lint.warningCount} warning(s)` },
    { label: 'merge', ok: !g.conflictsWithMain, detail: g.conflictsWithMain ? 'conflicts with main' : 'no conflict' },
    { label: 'ahead', ok: p.ahead > 0, detail: `${p.ahead} commit(s) ahead of main` },
    { label: 'committed', ok: p.dirtyNonRuntime === 0, detail: p.dirtyNonRuntime === 0 ? 'nothing uncommitted' : `${p.dirtyNonRuntime} uncommitted file(s)` },
  ]
}

// gitA returns '' for a missing path — exactly the added/deleted (and best-effort rename) side; each side capped to MAX_FILE_BYTES
const MAX_ENRICHED_FILES = 60
const MAX_FILE_BYTES = 200_000
async function enrichFile(wtPath: string, base: string, f: ReviewDiffFile): Promise<ProofFile> {
  const run = (args: string[]) => gitA(['-C', wtPath, '-c', 'core.quotePath=false', ...args])
  const [patchRaw, oldRaw, newRaw] = await Promise.all([
    run(['diff', '-M', `${base}..HEAD`, '--', f.path]),
    f.status === 'added' ? Promise.resolve('') : run(['show', `${base}:${f.path}`]),
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
// data-URI; a transcript → its text; the cache miss / no-capture states pass through. yatsu owns the bytes
// (the content-addressed cache) — the proof only asks for them by hash.
async function toProofReading(r: EvalEntry): Promise<ProofReading> {
  const base = {
    scenario: r.scenario, expected: r.expected, verdict: r.verdict, fresh: r.fresh,
    staleAxes: r.staleAxes, score: readingScore(r), evaluator: r.evaluator, ts: r.ts,
  }
  if (r.blobState !== 'present' || !r.blob) return { ...base, evidence: { kind: r.blobState === 'miss' ? 'miss' : 'none' } }
  const blob = readBlobByHash(r.blob)
  if (!blob.ok) return { ...base, evidence: { kind: 'miss' } }
  if (blob.mime.startsWith('image/')) return { ...base, evidence: { kind: 'image', dataUri: `data:${blob.mime};base64,${blob.bytes.toString('base64')}` } }
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
function nodeScore(hasYatsu: boolean, latest: EvalEntry[]): ScoreState {
  if (!hasYatsu) return null
  if (!latest.length) return 'empty'
  if (latest.some((r) => r.fresh && verdictMark(r) === 'cross')) return 'fail'
  const stale = latest.filter((r) => !r.fresh && verdictMark(r))
  if (stale.length) return stale.some((r) => verdictMark(r) === 'cross') ? 'staleFail' : 'stalePass'
  if (latest.some((r) => !verdictMark(r))) return 'empty'
  return 'pass'
}

// ---- file → node mapping ----

// which spec node owns a changed file: a file inside a node's directory (its spec.md / yatsu.md / sidecar)
// belongs to the NEAREST such node; otherwise the node whose governed `code:` claims it (exact path,
// directory prefix, or `*` glob — the same matching `spex yatsu scan --changed` uses). A shared file is
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

function renderReading(r: ProofReading): string {
  const ev = r.evidence
  const body =
    ev.kind === 'image' ? `<img class="shot" src="${ev.dataUri}" alt="${esc(r.scenario)}">`
    : ev.kind === 'transcript' ? `<pre class="transcript">${esc(ev.text)}</pre>`
    : ev.kind === 'miss' ? `<div class="noev">⌀ miss original file — the evidence bytes were pruned</div>`
    : `<div class="noev">attested without a capture</div>`
  const stale = r.fresh ? '' : `<span class="stale" title="${esc(r.staleAxes.join(', '))} changed since the reading">stale</span>`
  const note = r.verdict?.note ? `<div class="rnote"><b>note</b> ${esc(r.verdict.note)}</div>` : ''
  return `<div class="reading">
    <div class="rhead">
      ${scoreBadge(r.score, r.fresh ? undefined : `stale: ${r.staleAxes.join(', ')}`)}
      <span class="scenario">${esc(r.scenario)}</span>
      ${verdictBadge(r.verdict)}
      ${stale}
      <span class="rmeta">${esc(r.evaluator)} · ${esc(r.ts)}</span>
    </div>
    ${r.expected ? `<div class="expected"><b>expected</b> ${esc(r.expected)}</div>` : ''}
    ${note}
    <figure class="evidence">${body}</figure>
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

function renderFile(f: ProofFile): string {
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

function renderNode(n: ProofNode): string {
  const stat = `<span class="diffstat"><span class="add">+${n.additions}</span> <span class="del">−${n.deletions}</span> · ${n.files.length} file(s)</span>`
  const fileList = n.files.length ? `<div class="files">${n.files.map(renderFile).join('')}</div>` : ''
  let proof: string
  if (n.readings.length) proof = n.readings.map(renderReading).join('')
  else if (n.uncoveredFrontend) proof = `<div class="blindspot">⚠ a frontend node with no yatsu.md — no loss signal measured. Give it a scenario so this change can be proven.</div>`
  else if (n.hasYatsu) proof = `<div class="blindspot">declares scenarios but has no reading yet — measure with <code>spex yatsu eval ${esc(n.id)}</code></div>`
  else proof = `<div class="noev">no measurable surface (no yatsu.md)</div>`
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
    <div class="readings">${proof}</div>
  </article>`
}

export function renderProofHtml(m: ProofModel): string {
  const idShort = m.id.slice(0, 8)
  const ribbon = [
    ...m.gates.map((g) => `<span class="chip ${g.ok ? 'ok' : 'bad'}" title="${esc(g.detail)}">${g.ok ? '✓' : '✗'} ${esc(g.label)}</span>`),
    m.score.total ? `<span class="chip ${m.score.passed === m.score.total ? 'ok' : 'warn'}" title="scenarios fresh-passing (of those measured); ${m.score.fresh}/${m.score.total} fresh">★ ${m.score.passed}/${m.score.total} passing</span>` : `<span class="chip warn" title="no yatsu readings on the changed nodes">★ no measured loss</span>`,
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
<title>proof · ${esc(m.title)}</title>
<style>${STYLE}</style>
</head><body>
<main class="proof">
  <header class="masthead">
    <div class="eyebrow">SpexCode · review proof</div>
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
  <footer>Generated by <code>spex review proof ${esc(idShort)}</code> — the optimizer's measured loss, presented for the merge decision. A spec is the loss; commits are the optimizer; yatsu is the evaluation.</footer>
</main>
</body></html>`
}

// the document's inline stylesheet — dark, matching the board's palette and the yatsu score colours, so the
// proof reads as one surface with the dashboard. Self-contained (no external font/asset).
const STYLE = `
:root{--bg:#0b0e14;--panel:#11161f;--panel2:#0e131b;--ink:#c9d4e3;--dim:#7c899c;--line:#1e2733;--accent:#4cc2a0;--green:#3fb950;--red:#f85149;--grey:#6e7b8c;--amber:#d29922}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
code{background:#0006;padding:.05em .35em;border-radius:4px;font-size:.88em;color:#aee1d2}
.proof{max-width:920px;margin:0 auto;padding:40px 24px 80px}
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
.readings{margin-top:8px}
.reading{margin-top:14px;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)}
.rhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.scenario{font-weight:600;color:#dde7f1}
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
.noev,.blindspot{margin-top:10px;padding:10px 12px;border-radius:8px;font-size:13px;color:var(--dim);background:#0a0e15;border:1px dashed var(--line)}
.blindspot{color:var(--amber);border-color:#3a3320}
.gates{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.gates li{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--panel)}
.gates li:last-child{border-bottom:0}
.gmark{font-weight:700}.gates li.ok .gmark{color:var(--green)}.gates li.bad .gmark{color:var(--red)}
.glabel{font-weight:600;width:120px;color:#dbe6f2}.gdetail{color:var(--dim);font:12px/1 ui-monospace,monospace}
footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);color:var(--dim);font-size:12px;text-align:center}
`
