// drift-replay benchmark — replay spexcode's own git history and score three drift-block policies
// against frozen LLM-judged ground truth. One command: npx tsx spec-eval/bench/drift-replay.ts
//
// Event = (node, spec-version window, commit touching the governed file). At that commit the gate
// decides block / no-block. Policies:
//   A1  one-drift-blocks           — every window commit blocks
//   A3  count>=3 (retired product) — the 3rd+ accumulated window commit blocks
//   B   anchor-hit (current)       — blocks iff the commit's hunks intersect the anchored unit,
//                                    extracted from the file AS OF that commit (spec-cli/src/anchors.ts);
//                                    an unanchored node NEVER blocks (the shipped semantics)
//   B'  anchor-hit, unanchored=always — same on anchored nodes; an unanchored node's every event blocks
//
// Two label tracks:
//   behavioral — the commit also versioned this node's spec.md (the fused ritual commit): the author's
//                own contemporaneous judgment that the contract moved. Automatic, full-population, noisy.
//   LLM truth  — drift-truth.json: 148 stratified events, 3 blind judges each (strict / behavioral /
//                auditor lens), majority vote. Frozen — scoring stays comparable across reruns.
//
// Anchor roster: drift-anchors.json (96 governed nodes; `anchor: null` = whole-file nodes, excluded
// from policy scoring; `pending: true` = anchor chosen but NOT yet in .spec because it hits live
// unresolved drift — the roster, not .spec, is this benchmark's input, so those still replay).
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tsAstExtractor, anchorHitCommits } from '../../spec-cli/src/anchors.js'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const BENCH = join(ROOT, 'spec-eval/bench')
const git = (args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

const roster: { node: string; codePath: string; anchor: string | null }[] = JSON.parse(readFileSync(join(BENCH, 'drift-anchors.json'), 'utf8'))
const truth: { pop: Record<string, number>; rows: { id: string; cell: string; truth: boolean }[] } = JSON.parse(readFileSync(join(BENCH, 'drift-truth.json'), 'utf8'))

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

type Ev = { id: string; node: string; anchored: boolean; specTouched: boolean; anchorHit: boolean; idx: number }
const events: Ev[] = []
const seen = new Set<string>()
for (const r of roster) {
  const specPath = specPathOf.get(r.node)
  if (!specPath) continue
  // spec version commits, oldest first, pure renames excluded (a rename is not a version)
  const versions: string[] = []
  for (const block of git(['log', '--follow', '--format=%x01%H', '--name-status', '--reverse', '--', specPath]).split('\x01').filter(Boolean)) {
    const [hash, ...rest] = block.trim().split('\n')
    if (/^R100\t/.test(rest.find((l) => /^[AMR]/.test(l)) ?? '')) continue
    versions.push(hash.trim())
  }
  if (!versions.length) continue
  const vset = new Set(versions)
  for (let i = 0; i < versions.length; i++) {
    const to = i + 1 < versions.length ? versions[i + 1] : 'HEAD'
    let win: string[] = []
    try { win = git(['rev-list', '--reverse', '--no-merges', `${versions[i]}..${to}`, '--', r.codePath]).trim().split('\n').filter(Boolean) } catch { continue }
    if (!win.length) continue
    const hits = r.anchor ? new Set((await anchorHitCommits(ROOT, win, r.codePath, r.anchor, x)).map((h) => h.commit)) : new Set<string>()
    win.forEach((c, k) => {
      const id = `${r.node}@${c.slice(0, 8)}`
      if (seen.has(id)) return
      seen.add(id)
      events.push({ id, node: r.node, anchored: !!r.anchor, specTouched: vset.has(c), anchorHit: hits.has(c), idx: k + 1 })
    })
  }
}

// ---- behavioral track (full population, live) ----
const bB = (e: Ev) => e.anchorHit
const bBp = (e: Ev) => (e.anchored ? e.anchorHit : true)
const neg = events.filter((e) => !e.specTouched), pos = events.filter((e) => e.specTouched)
const pct = (a: number, b: number) => ((100 * a) / b).toFixed(1) + '%'
console.log(`\nreplayed ${events.length} drift events on ${new Set(events.map((e) => e.node)).size} nodes (${events.filter((e) => e.anchored).length} on anchored nodes)`)
console.log('\nbehavioral track (label = commit also versioned the spec):')
console.log(`  code-only events blocked   A1 100.0% · A3 ${pct(neg.filter((e) => e.idx >= 3).length, neg.length)} · B ${pct(neg.filter(bB).length, neg.length)} · B' ${pct(neg.filter(bBp).length, neg.length)}   (n=${neg.length})`)
console.log(`  fused events caught        A1 100.0% · A3 ${pct(pos.filter((e) => e.idx >= 3).length, pos.length)} · B ${pct(pos.filter(bB).length, pos.length)} · B' ${pct(pos.filter(bBp).length, pos.length)}   (n=${pos.length})`)

// ---- LLM-truth track (frozen sample, frozen stratum weights) ----
const byId = new Map(events.map((e) => [e.id, e]))
const nCell: Record<string, number> = {}
const joined = truth.rows.filter((t) => byId.has(t.id))
for (const t of joined) nCell[t.cell] = (nCell[t.cell] || 0) + 1
const w = (t: { cell: string }) => truth.pop[t.cell] / nCell[t.cell]
const W = joined.reduce((a, t) => a + w(t), 0)
function score(name: string, blocks: (e: Ev) => boolean) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const t of joined) {
    const e = byId.get(t.id)!, b = blocks(e), ww = w(t)
    if (b && t.truth) tp += ww; else if (b && !t.truth) fp += ww; else if (!b && t.truth) fn += ww; else tn += ww
  }
  console.log(`  ${name}  blocks ${pct(tp + fp, W)} · precision ${pct(tp, tp + fp)} · recall ${pct(tp, tp + fn)} · false blocks ${fp.toFixed(0)}/${(fp + tn).toFixed(0)}`)
  return { fp, fn }
}
console.log(`\nLLM-truth track (${joined.length}/${truth.rows.length} judged events matched; population-weighted to ${W.toFixed(0)}):`)
score("A1 one-drift-blocks     ", () => true)
score("A3 count>=3 (retired)   ", (e) => e.idx >= 3)
score("B  anchor-hit (current) ", bB)
score("B' anchor-hit+un=always ", bBp)
// anchored-only subtable (the report's original main table — comparability with round 1)
{
  const sub = joined.filter((t) => byId.get(t.id)!.anchored)
  const subW = sub.reduce((a, t) => a + w(t), 0)
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const t of sub) { const e = byId.get(t.id)!, b = bB(e), ww = w(t); b && t.truth ? tp += ww : b && !t.truth ? fp += ww : !b && t.truth ? fn += ww : tn += ww }
  console.log(`  (anchored-only B: blocks ${pct(tp + fp, subW)} · precision ${pct(tp, tp + fp)} · recall ${pct(tp, tp + fn)} · false blocks ${fp.toFixed(0)}/${(fp + tn).toFixed(0)})`)
}
if (joined.length < truth.rows.length * 0.95) {
  console.error(`\nWARN: ${truth.rows.length - joined.length} judged events no longer replay (history rewrite?) — scores may not be comparable`)
  process.exit(1)
}
