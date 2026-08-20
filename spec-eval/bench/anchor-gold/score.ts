// Anchor gold scorer. The corpus is language-neutral: a production Extractor is supplied at runtime.
// Run with `npx tsx spec-eval/bench/anchor-gold/score.ts`; use --strict in CI once every language row is wired.
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

type Unit = { name: string; kind: string; start: number; end: number; typeOnly?: boolean }
type Extractor = {
  id: string
  claims?: (ext: string) => boolean
  ready?: () => true | string | Promise<true | string>
  extract: (content: string, filename: string) => Unit[] | Promise<Unit[]>
}
type Entry = { id: string; language: string; filename: string; snapshot: string; parse: 'ok' | 'fail' }
type Truth = { id: string; units: Unit[]; parse?: 'ok' | 'fail'; ambiguity?: Record<string, number> }

const HERE = resolve(fileURLToPath(import.meta.url), '..')
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const corpusDir = resolve(HERE, 'corpus')
const manifest = JSON.parse(readFileSync(resolve(HERE, 'manifest.json'), 'utf8')) as { languages: string[]; entries: Entry[] }
const truthDoc = JSON.parse(readFileSync(resolve(HERE, 'truth.json'), 'utf8')) as { entries: Truth[] }
const truthById = new Map(truthDoc.entries.map((entry) => [entry.id, entry]))

function option(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

function extension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1) : ''
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a'
}

function counts(units: Unit[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const unit of units) result.set(unit.name, (result.get(unit.name) ?? 0) + 1)
  return result
}

// Names are scored as a multiset so duplicate declarations cannot be hidden by Map(name -> unit).
function scoreUnits(expected: Unit[], found: Unit[]) {
  const remaining = new Map<string, Unit[]>()
  for (const unit of found) remaining.set(unit.name, [...(remaining.get(unit.name) ?? []), unit])
  let tp = 0
  let exactRange = 0
  for (const unit of expected) {
    const candidates = remaining.get(unit.name)
    if (!candidates?.length) continue
    const index = candidates.findIndex((candidate) => candidate.start === unit.start && candidate.end === unit.end)
    const chosen = index >= 0 ? candidates.splice(index, 1)[0] : candidates.shift()!
    tp++
    if (chosen.start === unit.start && chosen.end === unit.end) exactRange++
  }
  return { tp, fp: found.length - tp, fn: expected.length - tp, exactRange, matched: tp }
}

async function loadExtractors(): Promise<{ extractors: Extractor[]; source: string }> {
  const requested = option('--module')
  const source = requested ? (isAbsolute(requested) ? requested : resolve(process.cwd(), requested)) : resolve(ROOT, 'packages/spec-core/src/anchors.ts')
  try {
    const mod: any = await import(pathToFileURL(source).href)
    if (typeof mod.extractors === 'function') return { extractors: await mod.extractors(ROOT), source }
    if (typeof mod.extract === 'function') return { extractors: [{ id: mod.id ?? 'custom', extract: mod.extract, claims: () => true }], source }
    if (mod.default && typeof mod.default.extract === 'function') return { extractors: [mod.default], source }
    throw new Error(`module ${source} exports neither extractors() nor extract()`)
  } catch (error: any) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && !requested) {
      return { extractors: [], source }
    }
    throw error
  }
}

const { extractors, source } = await loadExtractors()
console.log(`anchor-gold · ${manifest.entries.length} frozen cases · ${manifest.languages.join(', ')} · module=${source}`)
if (!extractors.length) console.log('UNWIRED: no extractor module was available; corpus validation still ran')
const strict = process.argv.includes('--strict')

const manifestIds = new Set<string>()
for (const entry of manifest.entries) {
  if (manifestIds.has(entry.id)) throw new Error(`duplicate manifest id ${entry.id}`)
  manifestIds.add(entry.id)
  if (!truthById.has(entry.id)) throw new Error(`missing truth row for ${entry.id}`)
  if (entry.parse !== 'ok' && entry.parse !== 'fail') throw new Error(`invalid parse expectation for ${entry.id}`)
  readFileSync(resolve(corpusDir, entry.snapshot))
}
for (const entry of truthDoc.entries) if (!manifestIds.has(entry.id)) throw new Error(`truth row has no manifest entry: ${entry.id}`)

const totals = new Map<string, { tp: number; fp: number; fn: number; exact: number; matched: number; ambiguity: number; ambiguityTotal: number; syntax: number; syntaxTotal: number; unsupported: number }>()
for (const language of manifest.languages) totals.set(language, { tp: 0, fp: 0, fn: 0, exact: 0, matched: 0, ambiguity: 0, ambiguityTotal: 0, syntax: 0, syntaxTotal: 0, unsupported: 0 })
let failures = 0

for (const entry of manifest.entries) {
  const truth = truthById.get(entry.id)
  if (!truth) throw new Error(`missing truth row for ${entry.id}`)
  const metrics = totals.get(entry.language)!
  const x = extractors.find((candidate) => candidate.claims?.(extension(entry.filename)) ?? true)
  if (!x) {
    metrics.unsupported++
    continue
  }
  const ready = await (x.ready?.() ?? true)
  if (ready !== true) {
    console.log(`${entry.id}: NOT READY (${ready})`)
    metrics.unsupported++
    continue
  }
  const content = readFileSync(resolve(corpusDir, entry.snapshot), 'utf8')
  let found: Unit[] = []
  let threw = false
  try { found = await x.extract(content, entry.filename) } catch { threw = true }
  if (entry.parse === 'fail') {
    metrics.syntaxTotal++
    if (threw) metrics.syntax++
    else { if (strict) failures++; console.log(`${entry.id}: BAD-SYNTAX expected extractor failure, got units=${found.length}`) }
    continue
  }
  if (threw) { if (strict) failures++; console.log(`${entry.id}: unexpected parse failure`) ; continue }
  const scored = scoreUnits(truth.units, found)
  metrics.tp += scored.tp; metrics.fp += scored.fp; metrics.fn += scored.fn
  metrics.exact += scored.exactRange; metrics.matched += scored.matched
  if (strict && (scored.fp || scored.fn || scored.exactRange !== scored.matched)) {
    failures++
    console.log(`${entry.id}: UNITS expected=${JSON.stringify(truth.units)} found=${JSON.stringify(found)}`)
  }
  const expectedAmbiguity = truth.ambiguity ?? {}
  const foundCounts = counts(found)
  const ambiguityNames = Object.keys(expectedAmbiguity)
  if (ambiguityNames.length) {
    metrics.ambiguityTotal++
    const pass = ambiguityNames.every((name) => foundCounts.get(name) === expectedAmbiguity[name])
    if (pass) metrics.ambiguity++
    else { if (strict) failures++; console.log(`${entry.id}: AMBIGUITY expected ${JSON.stringify(expectedAmbiguity)} found ${JSON.stringify(Object.fromEntries(foundCounts))}`) }
  }
}

console.log('\nlanguage       precision  recall  exactRange  ambiguity  badSyntax  unsupported')
for (const language of manifest.languages) {
  const m = totals.get(language)!
  console.log(`${language.padEnd(14)} ${pct(m.tp, m.tp + m.fp).padStart(9)} ${pct(m.tp, m.tp + m.fn).padStart(7)} ${pct(m.exact, m.matched).padStart(11)} ${m.ambiguityTotal ? `${m.ambiguity}/${m.ambiguityTotal}`.padStart(10) : '       n/a'} ${m.syntaxTotal ? `${m.syntax}/${m.syntaxTotal}`.padStart(10) : '       n/a'} ${String(m.unsupported).padStart(11)}`)
}

if (strict) {
  const missing = [...totals.entries()].filter(([, m]) => m.unsupported).map(([language]) => language)
  if (missing.length) { console.log(`\nstrict: missing extractor claims for ${missing.join(', ')}`); failures++ }
}
console.log(failures ? `\nanchor-gold: ${failures} failure(s)` : '\nanchor-gold: pass')
if (failures) process.exitCode = 1
