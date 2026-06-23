import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git, repoRoot, driftIndex, type ReviewDiffFile } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { RUNTIME_DIR } from '../../spec-cli/src/layout.js'
import { reviewPayload } from '../../spec-cli/src/sessions.js'
import { evalTimeline, evalContext, readBlobByHash, type EvalEntry } from './evaltab.js'
import { isUiPath } from './cli.js'

// @@@ review proof - the agent's REVIEW STATE, marshaled. When a session proposes merge, this is the engine
// that turns its standing claim into a self-contained, beautiful PROOF OF WORK: the optimizer presenting its
// measured loss at the moment a human decides. It JOINS three things the system already knows —
// [[manager-cockpit]]'s reviewPayload (the diff + the merge gates), each changed node's [[yatsu-eval-tab]]
// timeline (the measured loss + its evidence), and the agent's thin `.session/proof.md` manifest (an
// authored headline + narrative) — and renders ONE HTML document with the yatsu evidence inlined as
// data-URIs ([[yatsu-core]]'s cache), so the page stands alone as a plain file. It lives in spec-yatsu
// because a proof IS the marshaled evaluation; it runs ONLY on the backend (the CLI and dashboard fetch the
// bytes it renders — one engine, thin faces).

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

// one changed spec node: its diff slice (the files this node owns that the session touched) joined with its
// measured loss (latest reading per scenario). A frontend node with no yatsu.md is an honest blind spot.
export type ProofNode = {
  id: string
  title: string
  hue: number
  desc: string
  files: ReviewDiffFile[]
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
  claim: string
  narrativeHtml: string          // rendered from the manifest's markdown body ('' when none authored)
  hasManifest: boolean
  generatedAt: string
  ahead: number
  dirtyNonRuntime: number
  gates: ProofGate[]
  score: { passed: number; total: number; fresh: number }   // the yatsu summary across all nodes
  nodes: ProofNode[]
  otherFiles: ReviewDiffFile[]   // changed files no spec node claims
}

// @@@ buildProofModel - assemble the proof for one session. reviewPayload does the cockpit reads (diff +
// gates + the standing proposal/note); we map its diff onto spec nodes, fold each node's eval timeline (the
// SAME engine the eval tab rides), resolve the evidence bytes for inlining, and read the agent's manifest.
// null when no session has that id (the route answers 404).
export async function buildProofModel(id: string): Promise<ProofModel | null> {
  const payload = await reviewPayload(id)
  if (!payload) return null
  const specs = await loadSpecs()
  const specById = new Map(specs.map((s) => [s.id, s]))
  // @@@ root at the SESSION worktree, not the backend - the session's readings, evidence, and git freshness
  // live on ITS branch in ITS worktree; reading them from the backend's own checkout would show main's
  // readings (the wrong loss) and mis-judge freshness across branches. So the eval context is rooted at the
  // session worktree (the same `-C wt.path` reviewPayload already uses for the diff/gates). specs stay from
  // the backend (the node paths/titles/hues are branch-shared); only the readings + drift are per-worktree.
  const wtPath = worktreePathForBranch(payload.branch)
  const ctxRoot = wtPath ?? repoRoot()
  const ctx = evalContext(ctxRoot, specs, await driftIndex(ctxRoot))

  // group the session's real changes (merge-base diff) by the spec node that owns each file.
  const byNode = new Map<string, ReviewDiffFile[]>()
  const otherFiles: ReviewDiffFile[] = []
  for (const f of payload.diff) {
    const nid = nodeForFile(f.path, specs, payload.node)
    if (nid) { const arr = byNode.get(nid) ?? []; arr.push(f); byNode.set(nid, arr) }
    else otherFiles.push(f)
  }
  // the session's primary node always appears, even if it has no file in the diff yet (a pure narrative).
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

  const manifest = wtPath ? parseManifest(readManifest(wtPath)) : { claim: null, narrative: '', present: false }
  const claim = manifest.claim || payload.proposal.note || `Review proof — ${payload.node || payload.branch || id}`

  return {
    id,
    node: payload.node,
    branch: payload.branch,
    claim,
    narrativeHtml: manifest.narrative ? mdToHtml(manifest.narrative) : '',
    hasManifest: manifest.present,
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
// directory prefix, or `*` glob — the same matching `spex yatsu scan --changed` uses). A shared hub file is
// claimed by MANY nodes; when the session has a primary node that also claims it, attribute it THERE so a
// node/<id> session's stake in cli.ts/index.ts groups under its own node, not whichever sibling sorts first.
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

// ---- the agent's manifest (.session/proof.md) ----

// the proof's scaffold — what `spex review proof --scaffold` drops into a worktree for the agent to fill.
export const PROOF_TEMPLATE = `---
claim: <one line — what this session delivers, the headline of your proof>
---

<!-- The body is free markdown. Make the case that the work is correct, pointing at the
     yatsu evidence the proof shows below it. Measure your nodes (spex yatsu eval) — the
     evidence gallery is built from those readings. This file is optional; delete it to
     fall back to your proposal note. -->

## what & why

## the proof
`

const MANIFEST_NAME = 'proof.md'
// always the new runtime-dir layout (`.session/proof.md`) — the manifest is a NEW concept with no legacy
// flat sidecar, so it adopts the folder unconditionally (unlike runtimePath's prompt/launch fallbacks).
export const manifestPath = (wtDir: string) => join(wtDir, RUNTIME_DIR, MANIFEST_NAME)
function readManifest(wtDir: string): string {
  const p = manifestPath(wtDir)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

// LENIENT by design (not the strict yatsu.md validator): pull an optional `claim` from the frontmatter and
// take the rest as the free-markdown narrative. An empty string → no manifest (present:false).
function parseManifest(src: string): { claim: string | null; narrative: string; present: boolean } {
  if (!src.trim()) return { claim: null, narrative: '', present: false }
  let claim: string | null = null
  let body = src
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (m) {
    for (const line of m[1].split('\n')) {
      const cm = line.match(/^\s*claim:\s*(.*)$/)
      if (cm) { claim = cm[1].trim().replace(/^["']|["']$/g, '') || null }
    }
    body = m[2]
  }
  // drop HTML comments (the template's guidance) and trim.
  const narrative = body.replace(/<!--[\s\S]*?-->/g, '').trim()
  return { claim, narrative, present: true }
}

// ---- worktree resolution (no sessions.ts edit: read git's own worktree list) ----

// the worktree path whose checked-out branch matches — so the backend can read that session's manifest
// without findWorktree. `git worktree list --porcelain` emits `worktree <path>` then `branch refs/heads/<b>`.
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

// ---- a tiny, safe markdown → HTML for the narrative ----

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
// inline rules applied AFTER escaping: `code`, **bold**, *italic*, [text](url) with a safe-scheme guard.
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => /^(https?:|\/|#)/.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>` : t)
}
// block-level: headings, unordered lists, and paragraphs separated by blank lines. Deliberately small.
function mdToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let para: string[] = [], list: string[] = []
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = [] } }
  const flushList = () => { if (list.length) { out.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`); list = [] } }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    const li = line.match(/^\s*[-*]\s+(.*)$/)
    if (h) { flushPara(); flushList(); const lvl = Math.min(h[1].length + 1, 5); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`) }
    else if (li) { flushPara(); list.push(li[1]) }
    else if (!line.trim()) { flushPara(); flushList() }
    else { flushList(); para.push(line.trim()) }
  }
  flushPara(); flushList()
  return out.join('\n')
}

// ---- the renderer ----

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
  const stale = r.fresh ? '' : `<span class="stale" title="${esc(r.staleAxes.join(', '))} moved since the reading">stale</span>`
  const note = r.verdict?.status === 'note' && r.verdict.note ? `<div class="rnote"><b>note</b> ${esc(r.verdict.note)}</div>` : ''
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

function renderNode(n: ProofNode): string {
  const stat = `<span class="diffstat"><span class="add">+${n.additions}</span> <span class="del">−${n.deletions}</span> · ${n.files.length} file(s)</span>`
  const fileList = n.files.length
    ? `<ul class="files">${n.files.map((f) => `<li><span class="fstatus ${esc(f.status)}">${esc(f.status)}</span> <span class="fpath">${esc(f.path)}</span> <span class="fnum"><span class="add">+${f.additions}</span> <span class="del">−${f.deletions}</span></span></li>`).join('')}</ul>`
    : ''
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

// @@@ renderProofHtml - the PURE renderer: a ProofModel → one self-contained HTML document. All evidence is
// already inlined in the model (data-URIs / text), so the page needs no further fetch and works saved to disk,
// emailed, or inside the dashboard's overlay. The styling matches the board's dark vocabulary and the yatsu
// score colours; node accents use each node's hue.
export function renderProofHtml(m: ProofModel): string {
  const idShort = m.id.slice(0, 8)
  const ribbon = [
    ...m.gates.map((g) => `<span class="chip ${g.ok ? 'ok' : 'bad'}" title="${esc(g.detail)}">${g.ok ? '✓' : '✗'} ${esc(g.label)}</span>`),
    m.score.total ? `<span class="chip ${m.score.passed === m.score.total ? 'ok' : 'warn'}" title="scenarios fresh-passing (of those measured); ${m.score.fresh}/${m.score.total} fresh">★ ${m.score.passed}/${m.score.total} passing</span>` : `<span class="chip warn" title="no yatsu readings on the changed nodes">★ no measured loss</span>`,
  ].join('')
  const gates = m.gates.map((g) => `<li class="${g.ok ? 'ok' : 'bad'}"><span class="gmark">${g.ok ? '✓' : '✗'}</span><span class="glabel">${esc(g.label)}</span><span class="gdetail">${esc(g.detail)}</span></li>`).join('')
  const otherBlock = m.otherFiles.length
    ? `<article class="node other"><div class="nhead"><span class="ntitle">other files</span><span class="nid">unclaimed by any node</span></div>
       <ul class="files">${m.otherFiles.map((f) => `<li><span class="fstatus ${esc(f.status)}">${esc(f.status)}</span> <span class="fpath">${esc(f.path)}</span> <span class="fnum"><span class="add">+${f.additions}</span> <span class="del">−${f.deletions}</span></span></li>`).join('')}</ul></article>`
    : ''
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>proof · ${esc(m.claim)}</title>
<style>${STYLE}</style>
</head><body>
<main class="proof">
  <header class="masthead">
    <div class="eyebrow">SpexCode · review proof</div>
    <h1 class="claim">${esc(m.claim)}</h1>
    <div class="meta">session <code>${esc(idShort)}</code>${m.branch ? ` · <code>${esc(m.branch)}</code>` : ''}${m.node ? ` · node <code>${esc(m.node)}</code>` : ''} · ${m.nodes.length} node(s) · <span class="ts">${esc(m.generatedAt)}</span></div>
    <div class="ribbon">${ribbon}</div>
  </header>
  ${m.narrativeHtml ? `<section class="narrative">${m.narrativeHtml}</section>` : (m.hasManifest ? '' : `<section class="narrative muted">No proof narrative authored — this proof is derived from the diff, the measured loss, and the gates. The agent can enrich it: <code>spex review proof --scaffold</code> then fill <code>.session/proof.md</code>.</section>`)}
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
.narrative{margin-top:26px;padding:22px 26px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:12px;background:var(--panel)}
.narrative.muted{color:var(--dim);border-left-color:var(--grey);font-size:14px}
.narrative h2{margin:18px 0 8px;font-size:13px;color:var(--accent);text-transform:none;letter-spacing:0}
.narrative h3,.narrative h4{margin:14px 0 6px;color:#dbe6f2;font-size:15px}
.narrative p{margin:10px 0}.narrative ul{margin:8px 0 8px 4px;padding-left:18px}.narrative li{margin:3px 0}
.narrative a{color:var(--accent)}
.node{margin:14px 0;padding:18px 20px;border:1px solid var(--line);border-radius:12px;background:var(--panel);border-left:3px solid hsl(var(--hue,210),55%,55%)}
.node.other{border-left-color:var(--grey)}
.nhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.huedot{width:11px;height:11px;border-radius:3px;background:hsl(var(--hue,210),60%,55%);flex:none}
.ntitle{font-weight:700;color:#e7eef7;font-size:16px}
.nid{font:12px/1 ui-monospace,monospace;color:var(--dim)}
.ndesc{margin:8px 0 4px;color:var(--dim);font-size:13px}
.diffstat{margin-left:auto;font:12px/1 ui-monospace,monospace;color:var(--dim)}
.add{color:var(--green)}.del{color:var(--red)}
.files{list-style:none;margin:12px 0 0;padding:0;border-top:1px solid var(--line)}
.files li{display:flex;align-items:center;gap:10px;padding:5px 0;font:12px/1.4 ui-monospace,monospace;border-bottom:1px solid #0c1117}
.fstatus{flex:none;width:84px;color:var(--dim);text-transform:uppercase;font-size:10px;letter-spacing:.06em}
.fstatus.added{color:var(--green)}.fstatus.deleted{color:var(--red)}.fstatus.modified{color:var(--amber)}
.fpath{color:#aebccd;overflow:hidden;text-overflow:ellipsis}.fnum{margin-left:auto}
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
