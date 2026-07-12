// The anchor-extractor benchmark ([[extractor-bench]]): score every extractor in the roster against the
// frozen corpus + committed truth, print the comparison table (name P/R + range accuracy per language
// class and slice), and gate against baseline.json — any aggregate metric regressing exits nonzero.
//   npx tsx spec-eval/bench/run.ts [--update-baseline] [--json]
// Slices: 'all' = every truth unit (incl. typeOnly + class methods); 'value-only' excludes typeOnly
// (interface/type — anchoring drift to a type is a design question, kept visible as its own column).
// Match rule (fixed for score comparability): name equal AND |start-Δ| ≤ 1 = true positive; a matched
// unit's range is OK when |end-Δ| ≤ 2. Negative controls are force-fed to every extractor regardless of
// claims(): returned units count as false positives; a throw is the correct refusal.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Unit, ExtractorLike } from './seed-r5b.js'

const BENCH = dirname(fileURLToPath(import.meta.url))
const SPEC_CLI = join(BENCH, '../../spec-cli')

// ---- roster: the WIRING POINT to the language seam ----
// spec-cli/src/anchors.ts (the code-anchor seam) exports pure extractors; when present, the roster is its
// registry rows plus the JS_LANG_R5B reference row fed to heuristicExtractor. Until it merges, fall back
// to the bundled seed so the pipeline stays runnable. Only a MISSING anchors module falls back — a broken
// one rethrows (a syntax error must fail the bench loudly, not silently score the seed).
async function roster(): Promise<{ list: ExtractorLike[]; wired: boolean }> {
  try {
    // variable specifier: the module may legitimately not exist yet — keep tsc from resolving it
    const seam = '../../spec-cli/src/anchors.js'
    const a: any = await import(seam)
    const list: ExtractorLike[] = [...a.extractors(SPEC_CLI)]
    if (a.heuristicExtractor && a.JS_LANG_R5B && !list.some((x: ExtractorLike) => x.id === a.JS_LANG_R5B.id))
      list.push(a.heuristicExtractor(a.JS_LANG_R5B))
    return { list, wired: true }
  } catch (e: any) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && /anchors/.test(e?.message ?? '')) {
      const { seedR5b } = await import('./seed-r5b.js')
      return { list: [seedR5b], wired: false }
    }
    throw e
  }
}

const extOf = (path: string) => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : ''
}

type Tally = { tp: number; fp: number; fn: number; rangeOk: number; rangeChecked: number }
const tally = (): Tally => ({ tp: 0, fp: 0, fn: 0, rangeOk: 0, rangeChecked: 0 })
const add = (a: Tally, b: Tally) => { for (const k of Object.keys(a) as (keyof Tally)[]) a[k] += b[k] }

function score(truthUnits: (Unit & { tier?: string })[], found: Unit[], slice: string): Tally {
  const truth = truthUnits.filter((u) => slice === 'all' || !u.typeOnly)
  const foundByName = new Map(found.map((u) => [u.name, u]))
  const t = tally()
  for (const u of truth) {
    const f = foundByName.get(u.name)
    if (f && Math.abs(f.start - u.start) <= 1) {
      t.tp++; t.rangeChecked++
      if (Math.abs(f.end - u.end) <= 2) t.rangeOk++
    } else t.fn++
  }
  t.fp = found.filter((f) => !truth.some((u) => u.name === f.name)).length
  return t
}

const SLICES = ['all', 'value-only'] as const
const CLASSES = ['backend-ts', 'jsx', 'plain-js', 'control'] as const
const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : 'n/a')
const ratio = (a: number, b: number) => (b ? a / b : 1)

const truth = JSON.parse(readFileSync(join(BENCH, 'truth.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(BENCH, 'corpus/manifest.json'), 'utf8'))
const snapOf = new Map<string, string>(manifest.entries.map((e: any) => [e.file, e.snap]))

const { list, wired } = await roster()
console.log(`extractor-bench · corpus frozen at ${manifest.frozenAt} · ${truth.length} files · roster: ${list.map((x) => x.id).join(', ')}${wired ? '' : '  [SEED — spec-cli/src/anchors.ts not merged yet; wiring point idle]'}`)

type Agg = Record<string, Record<string, Tally>> // slice -> cls -> tally
const results: { id: string; agg: Agg; notes: string[] }[] = []
for (const x of list) {
  const ready = x.ready()
  if (ready !== true) { console.log(`\n${x.id}: NOT READY — ${ready}`); continue }
  const agg: Agg = {}
  for (const s of SLICES) { agg[s] = {}; for (const c of CLASSES) agg[s][c] = tally() }
  const notes: string[] = []
  for (const entry of truth) {
    const ext = extOf(entry.file)
    const isControl = entry.cls === 'control'
    if (!isControl && !x.claims(ext)) continue
    if (isControl && x.claims(ext)) notes.push(`claims control ext '${ext}' (${entry.file}) — extension gate leak`)
    const text = readFileSync(join(BENCH, 'corpus', snapOf.get(entry.file)!), 'utf8')
    let found: Unit[] = []
    try { found = x.extract(text, entry.file) } catch { /* a throw is the correct refusal; found stays [] */ }
    for (const s of SLICES) add(agg[s][entry.cls], score(entry.units, found, s))
  }
  results.push({ id: x.id, agg, notes })
}

// ---- table ----
for (const r of results) {
  console.log(`\n${r.id}`)
  console.log('  slice      | class      |      P |      R | rangeOK | truth')
  for (const s of SLICES) {
    const all = tally()
    for (const c of CLASSES) {
      const t = r.agg[s][c]
      add(all, t)
      if (t.tp + t.fn + t.fp === 0) continue
      console.log(`  ${s.padEnd(10)} | ${c.padEnd(10)} | ${pct(t.tp, t.tp + t.fp).padStart(6)} | ${pct(t.tp, t.tp + t.fn).padStart(6)} | ${pct(t.rangeOk, t.rangeChecked).padStart(7)} | ${t.tp + t.fn}`)
    }
    console.log(`  ${s.padEnd(10)} | ${'ALL'.padEnd(10)} | ${pct(all.tp, all.tp + all.fp).padStart(6)} | ${pct(all.tp, all.tp + all.fn).padStart(6)} | ${pct(all.rangeOk, all.rangeChecked).padStart(7)} | ${all.tp + all.fn}`)
  }
  for (const n of r.notes) console.log(`  ⚠ ${n}`)
}

// ---- baseline gate: any aggregate metric regressing fails the run ----
const baselinePath = join(BENCH, 'baseline.json')
const metricsOf = (r: (typeof results)[number]) => {
  const out: Record<string, { p: number; r: number; range: number }> = {}
  for (const s of SLICES) {
    const all = tally()
    for (const c of CLASSES) add(all, r.agg[s][c])
    out[s] = {
      p: +ratio(all.tp, all.tp + all.fp).toFixed(4),
      r: +ratio(all.tp, all.tp + all.fn).toFixed(4),
      range: +ratio(all.rangeOk, all.rangeChecked).toFixed(4),
    }
  }
  return out
}
const current: Record<string, ReturnType<typeof metricsOf>> = {}
for (const r of results) current[r.id] = metricsOf(r)

if (process.argv.includes('--json')) console.log('\n' + JSON.stringify(current, null, 1))

if (process.argv.includes('--update-baseline')) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 1) + '\n')
  console.log(`\nbaseline.json updated (${Object.keys(current).join(', ')})`)
} else if (existsSync(baselinePath)) {
  const base = JSON.parse(readFileSync(baselinePath, 'utf8'))
  let regressed = false
  for (const id of Object.keys(base)) if (!current[id]) console.log(`\nbaseline row '${id}' is not in the roster anymore — stale; drop it with --update-baseline`)
  for (const [id, slices] of Object.entries(current)) {
    if (!base[id]) { console.log(`\n${id}: NEW row (no baseline) — record it with --update-baseline`); continue }
    for (const s of SLICES) for (const k of ['p', 'r', 'range'] as const) {
      const was = base[id]?.[s]?.[k]
      if (typeof was === 'number' && slices[s][k] < was - 1e-9) {
        console.log(`\nREGRESSION ${id} ${s}.${k}: ${was} -> ${slices[s][k]}`)
        regressed = true
      }
    }
  }
  if (regressed) { console.log('score regressed vs baseline.json — a deliberate trade-off must update the baseline in the same change'); process.exit(1) }
  console.log('\nbaseline: no regression ✓')
} else {
  console.log('\nno baseline.json yet — record the first with --update-baseline')
}
