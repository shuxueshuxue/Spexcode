// drift-replay benchmark — replay spexcode's own git history and score four drift-block policies
// against frozen LLM-judged ground truth. One command: npx tsx spec-eval/bench/drift-replay.ts
// Flags: --emit-audit-queue (regenerate human-audit-queue.json) · --update-baseline (rewrite drift-baseline.json)
//
// TARGET DISTINCTION (what this benchmark measures vs what it does not):
//   Y1 (measured here)  — per-event: did THIS commit's diff touch the spec's stated contract?
//                         A localizer/decision-quality label. All P/R tables below are Y1.
//   Y2 (runtime target) — per-state: is the spec STALE NOW and in need of review? Y1 and Y2 part
//                         ways on spec-first sequences and acks; the episode section below is the
//                         Y2 groundwork (staleness episodes + exposure), not yet a scored track.
//   Nothing in a replay is a CAUSAL claim about what a gate changes in behavior — replay scores
//   decisions against labels; behavioral effects need a prospective experiment.
//
// Event = (node, spec-version window, commit touching the governed file). At that commit the gate
// decides. Policies:
//   A1  one-drift-blocks           — every window commit blocks
//   A3  count>=3 (retired product) — the 3rd+ accumulated window commit blocks
//   B   anchor-hit (current)       — blocks iff the commit's hunks intersect the anchored unit,
//                                    extracted from the file AS OF that commit (spec-cli/src/anchors.ts);
//                                    an unanchored node NEVER blocks (the shipped semantics)
//   B'  anchor-hit, unanchored=always — same on anchored nodes; an unanchored node's every event blocks
// Every non-blocked drift event still surfaces as the product's advisory drift WARN, so each event
// lands in exactly one action channel per policy: block or warn (silent is structurally empty —
// a policy that also gates the advisory channel would be needed to populate it).
//
// Two label tracks:
//   behavioral — the commit also versioned this node's spec.md (the fused ritual commit): the author's
//                own contemporaneous judgment that the contract moved. Automatic, full-population, noisy.
//   LLM truth  — drift-truth.json: 227 stratified events, 3 blind judges each (strict / behavioral /
//                auditor lens), majority vote. Frozen — scoring stays comparable across reruns.
//   HUMAN audit — human-audit-queue.json: a blinded, deterministic 40-row stratified sample awaiting
//                HUMAN labels (this run only verifies the file; it must never be machine-filled).
//
// Anchor roster: drift-anchors.json (96 governed nodes; `anchor: null` = whole-file nodes, excluded
// from anchor-hit scoring; `pending: true` = anchor chosen but NOT yet in .spec because it hits live
// unresolved drift — the roster, not .spec, is this benchmark's input, so those still replay).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { tsAstExtractor, anchorHitCommits } from '../../spec-cli/src/anchors.js'
import { runPressureTrack } from './pressure-track.js'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const BENCH = join(ROOT, 'spec-eval/bench')
const git = (args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

const roster: { node: string; codePath: string; anchor: string | null }[] = JSON.parse(readFileSync(join(BENCH, 'drift-anchors.json'), 'utf8'))
const truth: { pop: Record<string, number>; rows: { id: string; cell: string; specTouched: boolean; truth: boolean }[] } = JSON.parse(readFileSync(join(BENCH, 'drift-truth.json'), 'utf8'))

const x = tsAstExtractor(ROOT)
const ready = x.ready()
if (ready !== true) { console.error(ready); process.exit(1) }

// node id -> spec.md path (dir basename is the id)
const specPathOf = new Map<string, string>()
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (e === 'spec.md') specPathOf.set(basename(dirname(p)), p.slice(ROOT.length + 1))
  }
}
walk(join(ROOT, '.spec'))

// one HEAD walk: commit -> { unix time, Session trailer (first value) or null }
const meta = new Map<string, { ts: number; session: string | null }>()
for (const line of git(['log', '--format=%H\x01%ct\x01%(trailers:key=Session,valueonly,separator=%x2C)', 'HEAD']).split('\n')) {
  const [h, ts, s] = line.split('\x01')
  if (h) meta.set(h, { ts: +ts, session: s?.split(',')[0]?.trim() || null })
}
const headTs = meta.get(git(['rev-parse', 'HEAD']).trim())?.ts ?? 0
// Spec-OK ack commits per node (the ack is an episode resolution: the human declared the spec still valid)
const acksOf = new Map<string, { sha: string; ts: number }[]>()
for (const line of git(['log', '--format=%H\x01%ct\x01%(trailers:key=Spec-OK,valueonly,separator=%x2C)', 'HEAD']).split('\n')) {
  const [h, ts, vals] = line.split('\x01')
  if (!h || !vals) continue
  for (const v of vals.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!acksOf.has(v)) acksOf.set(v, [])
    acksOf.get(v)!.push({ sha: h, ts: +ts })
  }
}
const ancMemo = new Map<string, boolean>()
const isAnc = (a: string, b: string): boolean => { // a is ancestor of (or equal to) b
  const k = a + b
  const hit = ancMemo.get(k)
  if (hit !== undefined) return hit
  let r: boolean
  try { execFileSync('git', ['-C', ROOT, 'merge-base', '--is-ancestor', a, b]); r = true } catch { r = false }
  ancMemo.set(k, r)
  return r
}

type Ev = {
  id: string; node: string; sha: string; anchored: boolean; specTouched: boolean; anchorHit: boolean
  idx: number; winStart: string; winClose: string | null; winSpecPath: string
}
const events: Ev[] = []
const seen = new Set<string>()
for (const r of roster) {
  const specPath = specPathOf.get(r.node)
  if (!specPath) continue
  // spec version commits, oldest first, pure renames excluded (a rename is not a version);
  // each version also records the spec.md PATH as of that commit (for `git show` on old trees)
  const versions: { sha: string; path: string }[] = []
  for (const block of git(['log', '--follow', '--format=%x01%H', '--name-status', '--reverse', '--', specPath]).split('\x01').filter(Boolean)) {
    const [hash, ...rest] = block.trim().split('\n')
    const stat = rest.find((l) => /^[AMR]/.test(l)) ?? ''
    if (/^R100\t/.test(stat)) continue
    const parts = stat.split('\t')
    versions.push({ sha: hash.trim(), path: (parts[0]?.startsWith('R') ? parts[2] : parts[1]) || specPath })
  }
  if (!versions.length) continue
  const vset = new Set(versions.map((v) => v.sha))
  for (let i = 0; i < versions.length; i++) {
    const to = i + 1 < versions.length ? versions[i + 1].sha : 'HEAD'
    let win: string[] = []
    try { win = git(['rev-list', '--reverse', '--no-merges', `${versions[i].sha}..${to}`, '--', r.codePath]).trim().split('\n').filter(Boolean) } catch { continue }
    if (!win.length) continue
    const hits = r.anchor ? new Set((await anchorHitCommits(ROOT, win, r.codePath, r.anchor, x)).map((h) => h.commit)) : new Set<string>()
    win.forEach((c, k) => {
      const id = `${r.node}@${c.slice(0, 8)}`
      if (seen.has(id)) return
      seen.add(id)
      events.push({
        id, node: r.node, sha: c, anchored: !!r.anchor, specTouched: vset.has(c), anchorHit: hits.has(c), idx: k + 1,
        winStart: versions[i].sha, winClose: i + 1 < versions.length ? versions[i + 1].sha : null, winSpecPath: versions[i].path,
      })
    })
  }
}

console.log(`\nreplayed ${events.length} drift events on ${new Set(events.map((e) => e.node)).size} nodes (${events.filter((e) => e.anchored).length} on anchored nodes)`)
console.log('\n== Y1 localizer track — per-event label: did THIS commit touch the spec contract ==')
console.log('   (decision quality against per-commit labels; NOT the runtime target "spec stale now" (Y2),')
console.log('    and NOT a causal claim about gate effects — see docs/drift-anchor-benchmark.md)')

// ---- behavioral sub-track (full population, live) ----
const bB = (e: Ev) => e.anchorHit
const bBp = (e: Ev) => (e.anchored ? e.anchorHit : true)
const neg = events.filter((e) => !e.specTouched), pos = events.filter((e) => e.specTouched)
const pct = (a: number, b: number) => ((100 * a) / b).toFixed(1) + '%'
console.log('\nbehavioral sub-track (label = commit also versioned the spec):')
console.log(`  code-only events blocked   A1 100.0% · A3 ${pct(neg.filter((e) => e.idx >= 3).length, neg.length)} · B ${pct(neg.filter(bB).length, neg.length)} · B' ${pct(neg.filter(bBp).length, neg.length)}   (n=${neg.length})`)
console.log(`  fused events caught        A1 100.0% · A3 ${pct(pos.filter((e) => e.idx >= 3).length, pos.length)} · B ${pct(pos.filter(bB).length, pos.length)} · B' ${pct(pos.filter(bBp).length, pos.length)}   (n=${pos.length})`)

// ---- LLM-truth sub-track (frozen sample, frozen stratum weights) ----
const byId = new Map(events.map((e) => [e.id, e]))
const nCell: Record<string, number> = {}
const joined = truth.rows.filter((t) => byId.has(t.id))
for (const t of joined) nCell[t.cell] = (nCell[t.cell] || 0) + 1
const w = (t: { cell: string }) => truth.pop[t.cell] / nCell[t.cell]
const W = joined.reduce((a, t) => a + w(t), 0)
const POLICIES: { key: string; name: string; blocks: (e: Ev) => boolean }[] = [
  { key: 'A1', name: 'A1 one-drift-blocks     ', blocks: () => true },
  { key: 'A3', name: 'A3 count>=3 (retired)   ', blocks: (e) => e.idx >= 3 },
  { key: 'B', name: 'B  anchor-hit (current) ', blocks: bB },
  { key: 'Bp', name: "B' anchor-hit+un=always ", blocks: bBp },
]
function prOf(rows: typeof joined, blocks: (e: Ev) => boolean) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const t of rows) {
    const b = blocks(byId.get(t.id)!), ww = w(t)
    if (b && t.truth) tp += ww; else if (b && !t.truth) fp += ww; else if (!b && t.truth) fn += ww; else tn += ww
  }
  return { tp, fp, fn, tn }
}
console.log(`\nLLM-truth sub-track (${joined.length}/${truth.rows.length} judged events matched; population-weighted to ${W.toFixed(0)}):`)
const metrics: Record<string, { p: number; r: number }> = {}
for (const pol of POLICIES) {
  const { tp, fp, fn, tn } = prOf(joined, pol.blocks)
  metrics[pol.key] = { p: +(tp / (tp + fp)).toFixed(4), r: +(tp / (tp + fn)).toFixed(4) }
  console.log(`  ${pol.name}  blocks ${pct(tp + fp, W)} · precision ${pct(tp, tp + fp)} · recall ${pct(tp, tp + fn)} · false blocks ${fp.toFixed(0)}/${(fp + tn).toFixed(0)}`)
}
// anchored-only subtable (the report's original main table — comparability with round 1)
{
  const sub = joined.filter((t) => byId.get(t.id)!.anchored)
  const subW = sub.reduce((a, t) => a + w(t), 0)
  const { tp, fp, fn, tn } = prOf(sub, bB)
  metrics.B_anchored = { p: +(tp / (tp + fp)).toFixed(4), r: +(tp / (tp + fn)).toFixed(4) }
  console.log(`  (anchored-only B: blocks ${pct(tp + fp, subW)} · precision ${pct(tp, tp + fp)} · recall ${pct(tp, tp + fn)} · false blocks ${fp.toFixed(0)}/${(fp + tn).toFixed(0)})`)
}

// ---- action channels: block / warn / silent per policy on the same frozen truth ----
// Every event takes exactly ONE action per policy (no double-counting): non-blocked drift events
// carry the product's advisory drift WARN, so silent stays structurally empty under all four
// policies — populating it would require a policy that gates the advisory channel too.
console.log('\naction channels on frozen truth (each event lands in exactly one channel per policy):')
console.log('  policy                     block%   blockP   warn%   warnP   warn-capture   silent')
const channelMetrics: Record<string, { blockP: number | null; warnP: number | null; warnCapture: number }> = {}
let channelPartitionOk = true
for (const pol of POLICIES) {
  let bw = 0, bt = 0, ww_ = 0, wt = 0, nB = 0, nW = 0
  for (const t of joined) {
    const e = byId.get(t.id)!, ww2 = w(t)
    if (pol.blocks(e)) { nB++; bw += ww2; if (t.truth) bt += ww2 } else { nW++; ww_ += ww2; if (t.truth) wt += ww2 }
  }
  if (nB + nW !== joined.length) channelPartitionOk = false
  const totalTrue = bt + wt
  channelMetrics[pol.key] = {
    blockP: bw ? +(bt / bw).toFixed(4) : null, warnP: ww_ ? +(wt / ww_).toFixed(4) : null,
    warnCapture: totalTrue ? +(wt / totalTrue).toFixed(4) : 0,
  }
  console.log(`  ${pol.name}  ${pct(bw, W).padStart(6)} ${bw ? pct(bt, bw).padStart(8) : '     n/a'} ${pct(ww_, W).padStart(7)} ${ww_ ? pct(wt, ww_).padStart(7) : '    n/a'} ${pct(wt, totalTrue).padStart(14)}        0`)
}
console.log('  (warn-capture = share of TRUE contract changes relegated to the advisory channel — the')
console.log('   cost B pays for its low block rate; blockP is the tables’ precision, repeated for contrast)')

// ---- staleness episodes (Y2 groundwork): deterministic regroup of LABELED events ----
// Episode = onset (first KNOWN-true contract-touching, non-fused commit in a window) .. resolution
// (the window-closing spec version, or an intervening Spec-OK ack naming the node). An onset is
// SOUND only when every earlier event in the window is labeled (so "first" is a fact, not a guess);
// windows with an unlabeled prefix are reported unresolvable — never guessed. Exposure R1 = distinct
// FOREIGN sessions (Session trailer differs from the onset commit's) among the episode's later
// governed-file commits — a git-only LOWER bound: trailerless commits count as 'unattributed'.
type Episode = {
  node: string; onset: string; onsetTs: number; resolution: { kind: 'version' | 'ack' | 'open'; sha: string | null }
  dwellCommits: number; dwellDays: number; r1: number; unattributed: number
}
const labeledTruth = new Map(joined.map((t) => [t.id, t.truth]))
const winKeys = [...new Set(joined.map((t) => { const e = byId.get(t.id)!; return `${e.node}\x01${e.winStart}` }))].sort()
const episodes: Episode[] = []
let winNoEpisode = 0, winGapped = 0, winWithEpisode = 0
const gapReasons: string[] = []
for (const key of winKeys) {
  const [node, winStart] = key.split('\x01')
  const evs = events.filter((e) => e.node === node && e.winStart === winStart)
  let i = 0, gotEpisode = false, gapped = false
  while (i < evs.length) {
    let onset = -1, gap = false
    for (let j = i; j < evs.length; j++) {
      const t = labeledTruth.get(evs[j].id)
      if (t === undefined) { gap = true; break }
      if (t && !evs[j].specTouched) { onset = j; break }
    }
    if (onset === -1) {
      if (gap) { gapped = true; gapReasons.push(`${node}@${winStart.slice(0, 8)}: unlabeled event before any known onset (${evs.length - i} events unresolved)`) }
      break
    }
    gotEpisode = true
    const oe = evs[onset], oMeta = meta.get(oe.sha)
    // resolution: the earliest intervening ack (descendant of onset, inside the window), else the closing version
    const acks = (acksOf.get(node) ?? [])
      .filter((a) => a.sha !== oe.sha && isAnc(oe.sha, a.sha) && (!oe.winClose || (a.sha !== oe.winClose && isAnc(a.sha, oe.winClose))))
      .sort((a, b) => a.ts - b.ts)
    const ack = acks[0]
    let end: number, res: Episode['resolution'], resTs: number
    if (ack) {
      res = { kind: 'ack', sha: ack.sha }; resTs = ack.ts
      end = onset
      for (let j = onset + 1; j < evs.length; j++) if (isAnc(evs[j].sha, ack.sha)) end = j; else break
    } else if (oe.winClose) {
      res = { kind: 'version', sha: oe.winClose }; resTs = meta.get(oe.winClose)?.ts ?? 0
      end = evs.length - 1
    } else {
      res = { kind: 'open', sha: null }; resTs = headTs
      end = evs.length - 1
    }
    const sessions = new Set<string>()
    let unattributed = 0
    for (let j = onset + 1; j <= end; j++) {
      const s = meta.get(evs[j].sha)?.session
      if (!s) unattributed++
      else if (s !== oMeta?.session) sessions.add(s)
    }
    episodes.push({
      node, onset: oe.sha, onsetTs: oMeta?.ts ?? 0, resolution: res,
      dwellCommits: end - onset + 1, dwellDays: oMeta ? +((resTs - oMeta.ts) / 86400).toFixed(1) : -1,
      r1: sessions.size, unattributed,
    })
    if (res.kind !== 'ack') break
    i = end + 1
  }
  if (gotEpisode) winWithEpisode++
  if (gapped) winGapped++
  else if (!gotEpisode) winNoEpisode++
}
console.log(`\nstaleness episodes (Y2 groundwork; labeled events only, deterministic — see header for the soundness rule):`)
console.log(`  windows holding judged events: ${winKeys.length} · sound episodes found: ${episodes.length} (in ${winWithEpisode} windows) · fully-labeled no-episode windows: ${winNoEpisode} · unresolvable (unlabeled prefix): ${winGapped}`)
for (const ep of episodes.sort((a, b) => a.node.localeCompare(b.node) || a.onsetTs - b.onsetTs)) {
  const r = ep.resolution.kind === 'open' ? 'open@HEAD' : `${ep.resolution.kind}:${ep.resolution.sha!.slice(0, 8)}`
  console.log(`    ${ep.node.padEnd(24)} onset ${ep.onset.slice(0, 8)} → ${r.padEnd(16)} dwell ${String(ep.dwellCommits).padStart(3)} commits / ${String(ep.dwellDays).padStart(6)} days · R1 foreign-sessions ${ep.r1}${ep.unattributed ? ` (+${ep.unattributed} unattributed)` : ''}`)
}
if (winGapped) {
  console.log('  unresolvable windows (honest boundary — the stratified sample labels cells, not window prefixes):')
  for (const r of gapReasons) console.log(`    · ${r}`)
}
console.log('  R1 is a LOWER bound on reliance: only foreign Session-trailer commits to the governed file count;')
console.log('  trailerless commits are listed as unattributed, and spec READS outside commits are invisible to git.')

// ---- human audit queue: blinded, deterministic, awaiting HUMAN labels ----
// 40 rows stratified by frozen population share (largest remainder), ordered inside each cell by
// sha256(id) — no randomness, byte-identical on every regeneration. The file carries ONLY blinded
// context (spec body as of the window start + the commit's governed-file diff); truth, votes, cell,
// and both policy signals stay out. This run verifies the committed file; it must NEVER be filled
// by a model — filled rows rejoin drift-truth.json by id to calibrate the LLM judges.
const AUDIT_PATH = join(BENCH, 'human-audit-queue.json')
const AUDIT_N = 40
function buildAuditQueue() {
  const cells = Object.keys(truth.pop).sort()
  const popTotal = cells.reduce((a, c) => a + truth.pop[c], 0)
  const exact = cells.map((c) => ({ c, x: (AUDIT_N * truth.pop[c]) / popTotal }))
  const quota = new Map(exact.map(({ c, x }) => [c, Math.floor(x)]))
  let left = AUDIT_N - [...quota.values()].reduce((a, b) => a + b, 0)
  for (const { c } of exact.sort((a, b) => (b.x - Math.floor(b.x)) - (a.x - Math.floor(a.x)))) {
    if (left <= 0) break
    quota.set(c, quota.get(c)! + 1); left--
  }
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
  const rows: object[] = []
  for (const c of cells) {
    const pick = joined.filter((t) => t.cell === c).sort((a, b) => sha256(a.id).localeCompare(sha256(b.id))).slice(0, quota.get(c))
    for (const t of pick) {
      const e = byId.get(t.id)!
      rows.push({
        id: t.id, node: e.node, commit: e.sha, codePath: roster.find((r) => r.node === e.node)!.codePath,
        spec: { path: e.winSpecPath, asOf: e.winStart },
        show: { spec: `git show ${e.winStart.slice(0, 12)}:${e.winSpecPath}`, diff: `git show ${e.sha.slice(0, 12)} -- ${roster.find((r) => r.node === e.node)!.codePath}` },
        humanVerdict: null, humanNote: null,
      })
    }
  }
  rows.sort((a: any, b: any) => a.id.localeCompare(b.id))
  return JSON.stringify({
    purpose: 'HUMAN audit of the frozen LLM truth — 40 blinded rows. A HUMAN reads, per row, the spec body as of `spec.asOf` and the commit’s diff to the governed file (the two `show` commands), then sets humanVerdict to true (the diff changes behavior the spec’s stated contract covers) or false, plus an optional humanNote. Do not consult the current .spec tree, the truth file, or whether the commit touched spec.md. A model must NEVER fill these fields — machine-filled rows void the audit; this file is not human validation until the fields are filled by a person.',
    generatedFrom: 'drift-truth.json (deterministic stratified sample; regenerate with --emit-audit-queue)',
    rejoin: 'answers rejoin drift-truth.json by id to calibrate the LLM judges',
    rows,
  }, null, 1) + '\n'
}
const auditNow = buildAuditQueue()
let auditOk = true, auditMsg = ''
if (process.argv.includes('--emit-audit-queue')) {
  writeFileSync(AUDIT_PATH, auditNow)
  auditMsg = `human-audit-queue.json regenerated (${AUDIT_N} rows)`
} else if (!existsSync(AUDIT_PATH)) {
  auditOk = false; auditMsg = 'human-audit-queue.json MISSING — generate it with --emit-audit-queue and commit it'
} else {
  const committed = readFileSync(AUDIT_PATH, 'utf8')
  // determinism: byte-identical regeneration — except human-filled verdict/note fields, which the
  // check masks back to null (filling the queue must not break the gate; changing sampling must)
  const masked = committed.replace(/"humanVerdict": (true|false)/g, '"humanVerdict": null').replace(/"humanNote": "(?:[^"\\]|\\.)*"/g, '"humanNote": null')
  if (masked !== auditNow) { auditOk = false; auditMsg = 'human-audit-queue.json DIVERGES from deterministic regeneration — sampling or context changed; regenerate with --emit-audit-queue and say why in the commit reason' }
  else if (/"(truth|votes|cell|anchorHit|specTouched|idx)"/.test(committed)) { auditOk = false; auditMsg = 'human-audit-queue.json LEAKS label fields — the queue must stay blinded' }
  else {
    const filled = (committed.match(/"humanVerdict": (true|false)/g) ?? []).length
    auditMsg = `human-audit-queue.json verified: ${AUDIT_N} blinded rows, deterministic, no label leakage · human-filled ${filled}/${AUDIT_N}${filled ? '' : ' (PENDING — not yet human validation)'}`
  }
}
console.log(`\nhuman audit queue: ${auditMsg}`)

// ---- parent-summary pressure track (Y2-adjacent groundwork; descriptive, ancestry-only) ----
// A separate measurement surface: child spec content versions pressing their summary parent's body.
// Lives in pressure-track.ts; its property assertions join the acceptance gates below. --emit-audit-queue
// regenerates BOTH blinded human queues.
const pressure = runPressureTrack({ ROOT, BENCH, git, emitQueue: process.argv.includes('--emit-audit-queue') })

// ---- acceptance gates (machine-checkable; any failure exits nonzero) ----
console.log('\nacceptance gates:')
let failed = false
const gate = (ok: boolean, msg: string) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed = true }
gate(joined.length === truth.rows.length, `all judged rows matched (${joined.length}/${truth.rows.length})`)
gate(channelPartitionOk, 'action channels partition every judged event (block+warn+silent = judged, per policy)')
gate(auditOk, 'audit queue deterministic + blinded')
gate(winWithEpisode + winNoEpisode + winGapped >= winKeys.length, 'every judged window classified (episode / no-episode / unresolvable)')
for (const g of pressure.gates) gate(g.ok, g.msg)

// baseline: frozen-truth metrics must not move silently — any drift is a scorer/engine change and
// needs a deliberate --update-baseline with the reason in the same commit. (Behavioral-track and
// episode numbers legitimately move as HEAD advances, so only frozen-truth metrics are gated.)
const BASELINE_PATH = join(BENCH, 'drift-baseline.json')
const current = { llmTruth: metrics, channels: channelMetrics }
if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 1) + '\n')
  console.log('  drift-baseline.json updated')
} else if (existsSync(BASELINE_PATH)) {
  const base = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  const drifts: string[] = []
  const cmp = (path: string, a: any, b: any) => {
    if (a === null || b === null) { if (a !== b) drifts.push(`${path}: ${a} -> ${b}`); return }
    if (typeof a === 'number') { if (Math.abs(a - (b ?? NaN)) > 1e-9) drifts.push(`${path}: ${a} -> ${b}`); return }
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) cmp(`${path}.${k}`, a?.[k], b?.[k])
  }
  cmp('llmTruth', base.llmTruth, current.llmTruth)
  cmp('channels', base.channels, current.channels)
  for (const d of drifts) console.log(`  BASELINE DRIFT ${d}`)
  gate(drifts.length === 0, 'frozen-truth metrics match drift-baseline.json')
} else {
  gate(false, 'drift-baseline.json missing — record it with --update-baseline')
}
if (failed) { console.error('\nacceptance gates FAILED'); process.exit(1) }
console.log('\nall gates passed ✓')
