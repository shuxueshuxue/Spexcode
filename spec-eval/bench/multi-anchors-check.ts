// multi-anchor roster check gate — validates spec-eval/bench/drift-multi-anchors.json without
// touching any truth/queue/baseline file. One command: npx tsx spec-eval/bench/multi-anchors-check.ts
//
// The roster is a BLINDED ANNOTATION artifact (see its `purpose`): per anchored seed node, 1–3 named
// units in the SAME base file that the spec body semantically requires. This gate makes the roster
// reproducible and honest:
//   - structure: entries sorted by node, unique; node exists in drift-anchors.json with a non-null
//     anchor and the SAME codePath (one base path per node); 1..3 selectors; selector 0 IS the seed
//     anchor; symbols unique; no bare/scoped mixing (`X` together with `X.y` double-counts a range)
//   - resolution: every selector resolves through the product extractor against the file blob at the
//     recorded sourceOid — dead, ambiguous, or typeOnly units FAIL LOUD (the annotation is pinned to
//     its oid, so this check is deterministic forever)
//   - blindness: no label/outcome field may appear in the file (truth, votes, verdicts, policy bits)
//   - determinism: canonical re-serialization is byte-identical to the committed file
//   - HEAD drift: a selector dead/ambiguous at current HEAD is REPORTED (re-annotation worklist),
//     never a failure — evolution past the pinned oid is expected, silence about it is not.
// Any hard failure exits nonzero.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tsAstExtractor, resolveAnchor, extOf, type Unit } from '../../spec-cli/src/anchors.js'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const BENCH = join(ROOT, 'spec-eval/bench')
const git = (args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

type Entry = { node: string; codePath: string; selectors: { symbol: string; reason: string }[]; sourceOid: string; specOid: string }
type Roster = { purpose: string; seedRoster: string; frozenAt: string; entries: Entry[] }

const rosterPath = join(BENCH, 'drift-multi-anchors.json')
const rawBytes = readFileSync(rosterPath, 'utf8')
const roster: Roster = JSON.parse(rawBytes)
const seed: { node: string; codePath: string; anchor: string | null }[] = JSON.parse(readFileSync(join(BENCH, 'drift-anchors.json'), 'utf8'))
const seedBy = new Map(seed.map((r) => [r.node, r]))

const x = tsAstExtractor(ROOT)
const ready = x.ready()
if (ready !== true) { console.error(ready); process.exit(1) }

let failures = 0
const fail = (msg: string) => { console.error(`✗ ${msg}`); failures++ }
const headWarnings: string[] = []

// blindness: the roster must carry no label/outcome fields
if (/"(truth|votes|verdict|humanVerdict|anchorHit|specTouched|idx|cell|blocks?|precision|recall)"\s*:/.test(rawBytes))
  fail('roster carries a label/outcome field — the annotation must stay blinded')

// determinism: canonical re-serialization must be byte-identical
if (JSON.stringify(roster, null, 1) + '\n' !== rawBytes)
  fail('roster is not in canonical serialization (JSON.stringify(_, null, 1) + newline) — regenerate deterministically')

const sortedNodes = [...roster.entries.map((e) => e.node)].sort((a, b) => a.localeCompare(b))
if (roster.entries.some((e, i) => e.node !== sortedNodes[i])) fail('entries are not sorted by node')
if (new Set(roster.entries.map((e) => e.node)).size !== roster.entries.length) fail('duplicate node entries')

const unitsOf = (oidOrRef: string, path: string): Unit[] | string => {
  let text: string
  try { text = git(['cat-file', 'blob', oidOrRef]) } catch { return `blob ${oidOrRef} unreadable` }
  try { return x.extract(text, path) } catch (e: any) { return `unparseable: ${e?.message ?? e}` }
}

for (const e of roster.entries) {
  const s = seedBy.get(e.node)
  if (!s) { fail(`${e.node}: not in the seed roster ${roster.seedRoster}`); continue }
  if (!s.anchor) { fail(`${e.node}: seed roster has no anchor (whole-file node) — not eligible`); continue }
  if (s.codePath !== e.codePath) { fail(`${e.node}: codePath ${e.codePath} != seed ${s.codePath} (one base path)`); continue }
  if (!x.claims(extOf(e.codePath))) { fail(`${e.node}: extractor does not claim ${e.codePath}`); continue }
  const syms = e.selectors.map((sel) => sel.symbol)
  if (syms.length < 1 || syms.length > 3) fail(`${e.node}: ${syms.length} selectors (must be 1..3)`)
  if (new Set(syms).size !== syms.length) fail(`${e.node}: duplicate selectors`)
  if (syms[0] !== s.anchor) fail(`${e.node}: selector 0 '${syms[0]}' is not the seed anchor '${s.anchor}'`)
  for (const a of syms) for (const b of syms) if (a !== b && b.startsWith(a + '.')) fail(`${e.node}: bare/scoped mix — '${a}' with '${b}'`)
  if (e.selectors.some((sel) => !sel.reason?.trim())) fail(`${e.node}: a selector has no reason`)

  const pinned = unitsOf(e.sourceOid, e.codePath)
  if (typeof pinned === 'string') { fail(`${e.node}: pinned source ${pinned}`); continue }
  for (const sym of syms) {
    const r = resolveAnchor(pinned, sym)
    if ('dead' in r) fail(`${e.node}#${sym}: DEAD at pinned sourceOid ${e.sourceOid.slice(0, 12)}`)
    else if ('ambiguous' in r) fail(`${e.node}#${sym}: AMBIGUOUS (${r.ambiguous}) at pinned sourceOid`)
    else if (r.ok.typeOnly) fail(`${e.node}#${sym}: typeOnly unit — not anchorable`)
  }

  // HEAD drift report (informative, never a failure)
  let headOid = ''
  try { headOid = git(['rev-parse', `HEAD:${e.codePath}`]).trim() } catch { headWarnings.push(`${e.node}: ${e.codePath} gone at HEAD`); continue }
  if (headOid === e.sourceOid) continue
  const now = unitsOf(headOid, e.codePath)
  if (typeof now === 'string') { headWarnings.push(`${e.node}: HEAD version ${now}`); continue }
  for (const sym of syms) {
    const r = resolveAnchor(now, sym)
    if ('dead' in r) headWarnings.push(`${e.node}#${sym}: dead at HEAD (file moved past pinned oid — re-annotate before scoring)`)
    else if ('ambiguous' in r) headWarnings.push(`${e.node}#${sym}: ambiguous at HEAD`)
  }
}

const multi = roster.entries.filter((e) => e.selectors.length > 1).length
console.log(`multi-anchor roster: ${roster.entries.length} entries, ${roster.entries.reduce((a, e) => a + e.selectors.length, 0)} selectors (${multi} multi-unit), frozenAt ${roster.frozenAt.slice(0, 12)}`)
if (headWarnings.length) {
  console.log(`HEAD drift (informative — the annotation stays pinned to its sourceOid):`)
  for (const w of headWarnings) console.log(`  · ${w}`)
}
if (failures) { console.error(`\nmulti-anchor check FAILED (${failures})`); process.exit(1) }
console.log('all multi-anchor checks passed ✓')
