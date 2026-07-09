import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseScenarios, validateScenarios, yatsuNodes, yatsuNodesAsync, resolveYatsuNode } from './yatsu.js'
import { readReadings, readSidecar, appendReading, appendRetraction, latestPerScenario, evidenceOf, type Reading } from './sidecar.js'
import { changedSince, staleAxes } from './freshness.js'
import { putBlob, listBlobs, gc, resolveBlob, MISS_BLOB, isStrayBlob } from './cache.js'
import { evaluatorTag, parseEvaluator, isEvaluatorStale } from './evaluator.js'
import type { DriftIndex } from '../../spec-cli/src/git.js'
import type { ScenarioIndex } from './scenariofresh.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'yatsu-test-'))

// ---- yatsu.md scenario parsing (name + description + expected + optional test) ----

test('parseScenarios: single-line fields, optional test path', () => {
  const md = `---
scenarios:
  - name: login-works
    description: log in with valid creds
    expected: lands on the dashboard
    test: tests/login.spec.ts
  - name: logout-redirects
    description: log out
    expected: back on /login
---
body text is ignored by the parser
`
  const sc = parseScenarios(md)
  assert.equal(sc.length, 2)
  assert.deepEqual(sc[0], { name: 'login-works', description: 'log in with valid creds', expected: 'lands on the dashboard', test: 'tests/login.spec.ts' })
  assert.deepEqual(sc[1], { name: 'logout-redirects', description: 'log out', expected: 'back on /login' })
})

test('parseScenarios: block scalars — | keeps newlines, > folds to spaces', () => {
  const md = `---
scenarios:
  - name: prose
    description: |
      first line
      second line
    expected: >-
      one logical
      sentence folded
    test: e2e/prose.spec.ts
---`
  const sc = parseScenarios(md)
  assert.equal(sc.length, 1)
  assert.equal(sc[0].description, 'first line\nsecond line')
  assert.equal(sc[0].expected, 'one logical sentence folded')
  assert.equal(sc[0].test, 'e2e/prose.spec.ts')
})

test('parseScenarios: no frontmatter / no scenarios key → empty', () => {
  assert.deepEqual(parseScenarios('# just a heading\n'), [])
  assert.deepEqual(parseScenarios('---\ntitle: x\n---\nbody\n'), [])
})

test('parseScenarios: quotes stripped, missing fields default to empty strings', () => {
  const sc = parseScenarios(`---
scenarios:
  - name: "quoted name"
    description: a surface
---`)
  assert.equal(sc.length, 1)
  assert.equal(sc[0].name, 'quoted name')
  assert.equal(sc[0].expected, '')
  assert.equal(sc[0].test, undefined)
})

test('parseScenarios: optional code list — flow list, comma-separated, and a single path', () => {
  const sc = parseScenarios(`---
scenarios:
  - name: flow
    description: a
    expected: b
    code: [src/x.ts, src/y.ts]
  - name: csv
    description: a
    expected: b
    code: src/x.ts, src/z.ts
  - name: one
    description: a
    expected: b
    code: src/only.ts
  - name: none
    description: a
    expected: b
---`)
  assert.deepEqual(sc[0].code, ['src/x.ts', 'src/y.ts'])
  assert.deepEqual(sc[1].code, ['src/x.ts', 'src/z.ts'])
  assert.deepEqual(sc[2].code, ['src/only.ts'])
  assert.equal(sc[3].code, undefined)   // absent → inherits the node's whole code: list, not []
})

test('parseScenarios: code as a YAML block sequence (like spec.md), not just inline', () => {
  const sc = parseScenarios(`---
scenarios:
  - name: block
    description: a
    expected: b
    code:
      - src/x.ts
      - src/y.ts
  - name: after
    description: a
    expected: b
---`)
  assert.deepEqual(sc[0].code, ['src/x.ts', 'src/y.ts'])   // block-sequence items collected, not dropped
  assert.equal(sc[1].name, 'after')                        // the next scenario item still parses
  assert.equal(sc[1].code, undefined)
})

test('validateScenarios: `code` is an allowed optional field, not an unknown-key error', () => {
  assert.deepEqual(validateScenarios(`---
scenarios:
  - name: s
    description: a
    expected: b
    tags: cli
    code: src/x.ts
---`), [])
})

// ---- yatsu.md schema validation (the loud twin of parseScenarios: scan reports it, the gate rejects it) ----

test('validateScenarios: a well-formed yatsu.md is valid (no errors)', () => {
  assert.deepEqual(validateScenarios(`---
scenarios:
  - name: login-works
    description: log in with valid creds
    expected: lands on the dashboard
    tags: [frontend-e2e, desktop]
    test: tests/login.spec.ts
  - name: logout-redirects
    description: log out
    expected: back on /login
    tags: frontend-e2e
---
body`, ['frontend-e2e', 'backend-api', 'cli', 'desktop', 'mobile']), [])
})

test('validateScenarios: tags are required (≥1) and must be drawn from the library', () => {
  const lib = ['frontend-e2e', 'backend-api', 'cli']
  // no tags → required-field error naming `tags`
  const missing = validateScenarios(`---
scenarios:
  - name: untagged
    description: a
    expected: b
---`, lib)
  assert.ok(missing.some((e) => /scenario 'untagged': missing required field `tags`/.test(e)), missing.join(' | '))
  // a tag outside the library → rejected, with the repair (use existing / add to library)
  const outside = validateScenarios(`---
scenarios:
  - name: typo
    description: a
    expected: b
    tags: [frontend-e2e, fronend-e2e]
---`, lib)
  assert.ok(outside.some((e) => /tag `fronend-e2e` is not in the configured tag library/.test(e)), outside.join(' | '))
  assert.ok(outside.some((e) => /add `fronend-e2e` to lint\.scenarioTags/.test(e)), outside.join(' | '))
  // every tag in-library → no error
  assert.deepEqual(validateScenarios(`---
scenarios:
  - name: ok
    description: a
    expected: b
    tags: backend-api, cli
---`, lib), [])
})

test('parseScenarios: tags — flow list, comma form, and a single tag', () => {
  const sc = parseScenarios(`---
scenarios:
  - name: flow
    description: a
    expected: b
    tags: [frontend-e2e, desktop]
  - name: one
    description: a
    expected: b
    tags: backend-api
  - name: none
    description: a
    expected: b
---`)
  assert.deepEqual(sc[0].tags, ['frontend-e2e', 'desktop'])
  assert.deepEqual(sc[1].tags, ['backend-api'])
  assert.equal(sc[2].tags, undefined)   // absent → no tags key (validateScenarios flags it required)
})

test('validateScenarios: no frontmatter / no scenarios key / empty list each fail loud', () => {
  assert.match(validateScenarios('# just a body\n')[0], /no frontmatter/)
  assert.match(validateScenarios('---\ntitle: x\n---\nbody')[0], /no `scenarios:` key/)
  assert.match(validateScenarios('---\nscenarios:\n---\nbody')[0], /declares no scenarios/)
})

test('validateScenarios: a missing required field is named (by scenario name when present, else index)', () => {
  const errs = validateScenarios(`---
scenarios:
  - name: has-no-expected
    description: a surface
  - description: nameless and incomplete
---`)
  assert.ok(errs.some((e) => /scenario 'has-no-expected': missing required field `expected`/.test(e)), errs.join(' | '))
  // the second item has no name → referenced by index, and flagged for the missing name too
  assert.ok(errs.some((e) => /scenario #2: missing required field `name`/.test(e)), errs.join(' | '))
})

test('validateScenarios: a typo\'d field key is rejected (not silently swallowed)', () => {
  const errs = validateScenarios(`---
scenarios:
  - name: typo
    descripton: misspelled key
    expected: something
---`)
  // the unknown key is named, AND `description` reads as missing (the typo never landed it)
  assert.ok(errs.some((e) => /unknown field `descripton`/.test(e)), errs.join(' | '))
  assert.ok(errs.some((e) => /missing required field `description`/.test(e)), errs.join(' | '))
})

test('validateScenarios: duplicate scenario names collide (they key the sidecar)', () => {
  const errs = validateScenarios(`---
scenarios:
  - name: dup
    description: first
    expected: a
  - name: dup
    description: second
    expected: b
---`)
  assert.ok(errs.some((e) => /duplicate scenario name 'dup'/.test(e)), errs.join(' | '))
})

test('validateScenarios vs parseScenarios: the lenient reader drops a nameless item the validator flags', () => {
  const md = `---
scenarios:
  - description: nameless
    expected: x
---`
  assert.equal(parseScenarios(md).length, 0)                 // lenient: silently dropped
  assert.ok(validateScenarios(md).some((e) => /missing required field `name`/.test(e)))  // strict: loud
})

// ---- sidecar round-trip ----

test('sidecar: append + read round-trips readings exactly (incl. verdict + blobKind)', () => {
  const f = join(tmp(), 'yatsu.evals.ndjson')
  const a: Reading = { scenario: 's1', codeSha: 'abc123', blob: 'deadbeef', blobKind: 'image', evaluator: 'manual@1', verdict: { status: 'pass' }, ts: '2026-01-01T00:00:00.000Z' }
  const b: Reading = { scenario: 's2', codeSha: 'def456', blob: 'feed', blobKind: 'transcript', evaluator: 'manual@1', verdict: { status: 'fail', note: 'off by a pixel' }, ts: '2026-01-02T00:00:00.000Z' }
  appendReading(f, a)
  appendReading(f, b)
  assert.deepEqual(readReadings(f), [a, b])
})

test('sidecar: missing file reads as empty; malformed lines are skipped; legacy (no verdict) survives', () => {
  const f = join(tmp(), 'nope.ndjson')
  assert.deepEqual(readReadings(f), [])
  const g = join(tmp(), 'partial.ndjson')
  writeFileSync(g, '{"scenario":"ok","codeSha":"x","blob":null,"evaluator":"manual@1","ts":"t"}\nnot json\n\n')
  const rs = readReadings(g)
  assert.equal(rs.length, 1)
  assert.equal(rs[0].scenario, 'ok')
  assert.equal(rs[0].verdict, undefined)   // a legacy reading has no verdict and still parses
})

test('sidecar: latestPerScenario keeps the last line per scenario', () => {
  const f = join(tmp(), 'y.ndjson')
  appendReading(f, { scenario: 's', codeSha: 'old', blob: null, evaluator: 'manual@1', verdict: { status: 'fail' }, ts: 't1' })
  appendReading(f, { scenario: 's', codeSha: 'new', blob: 'b', blobKind: 'image', evaluator: 'manual@1', verdict: { status: 'pass' }, ts: 't2' })
  const latest = latestPerScenario(readReadings(f))
  assert.equal(latest.size, 1)
  assert.equal(latest.get('s')!.codeSha, 'new')
})

// ---- retraction: the sanctioned inverse of a filing — an appended event, never a deleted line ----

test('sidecar: a retraction drops its target from the effective view; the previous reading is latest again', () => {
  const f = join(tmp(), 'y.ndjson')
  appendReading(f, { scenario: 's', codeSha: 'good', blob: null, evaluator: 'manual@1', verdict: { status: 'pass' }, ts: 't1' })
  appendReading(f, { scenario: 's', codeSha: 'junk', blob: null, evaluator: 'manual@1', verdict: { status: 'fail' }, ts: 't2' })
  appendRetraction(f, { retracts: 't2', scenario: 's', note: 'botched smoke run', ts: 't3' })
  const eff = readReadings(f)
  assert.equal(eff.length, 1)
  assert.equal(latestPerScenario(eff).get('s')!.codeSha, 'good')   // the undo restored the prior latest
  // the raw view keeps both the junk line AND the retraction event — the trace, not a deletion
  const raw = readSidecar(f)
  assert.equal(raw.readings.length, 2)
  assert.deepEqual(raw.retractions, [{ retracts: 't2', scenario: 's', note: 'botched smoke run', ts: 't3' }])
})

test('sidecar: retracting every reading returns the scenario to unmeasured (empty effective view)', () => {
  const f = join(tmp(), 'y.ndjson')
  appendReading(f, { scenario: 's', codeSha: 'a', blob: null, evaluator: 'manual@1', verdict: { status: 'pass' }, ts: 't1' })
  appendRetraction(f, { retracts: 't1', scenario: 's', ts: 't2' })
  assert.deepEqual(readReadings(f), [])
})

test('sidecar: a retraction is scoped by (scenario, ts) — a same-ts reading in another scenario survives, an unmatched one is inert', () => {
  const f = join(tmp(), 'y.ndjson')
  appendReading(f, { scenario: 'a', codeSha: 'x', blob: null, evaluator: 'manual@1', verdict: { status: 'pass' }, ts: 't1' })
  appendReading(f, { scenario: 'b', codeSha: 'y', blob: null, evaluator: 'manual@1', verdict: { status: 'pass' }, ts: 't1' })
  appendRetraction(f, { retracts: 't1', scenario: 'a', ts: 't2' })
  appendRetraction(f, { retracts: 'never-filed', scenario: 'b', ts: 't3' })   // matches nothing → inert
  const eff = readReadings(f)
  assert.equal(eff.length, 1)
  assert.equal(eff[0].scenario, 'b')
})

test('sidecar: a retraction line has no evaluator, so a legacy reader treats it as neither reading nor poison', () => {
  // an old readReadings required an `evaluator` string per line — a retraction (deliberately without one)
  // must never surface as a reading there. The new raw parser routes it by its `retracts` field instead.
  const f = join(tmp(), 'y.ndjson')
  appendRetraction(f, { retracts: 't0', scenario: 's', ts: 't1' })
  const raw = readSidecar(f)
  assert.equal(raw.readings.length, 0)
  assert.equal(raw.retractions.length, 1)
  assert.ok(!('evaluator' in raw.retractions[0]))
})

// ---- multi-evidence: the evidence LIST + its scalar→list bridge ----

test('sidecar: evidenceOf — a list rides verbatim, a legacy scalar reads as one entry, empty is empty', () => {
  // the new list shape is authoritative
  assert.deepEqual(
    evidenceOf({ evidence: [{ hash: 'aa', kind: 'image' }, { hash: 'bb', kind: 'video' }] }),
    [{ hash: 'aa', kind: 'image' }, { hash: 'bb', kind: 'video' }],
  )
  // a legacy scalar reading normalizes to a one-entry list so it still renders (absent kind → image)
  assert.deepEqual(evidenceOf({ blob: 'cc', blobKind: 'video' }), [{ hash: 'cc', kind: 'video' }])
  assert.deepEqual(evidenceOf({ blob: 'dd' }), [{ hash: 'dd', kind: 'image' }])
  // no evidence at all → empty list (a note-only reading)
  assert.deepEqual(evidenceOf({ blob: null }), [])
  assert.deepEqual(evidenceOf({}), [])
})

test('sidecar: a mixed reading (N images + a video + timeline) round-trips its whole evidence list', () => {
  const f = join(tmp(), 'yatsu.evals.ndjson')
  const r: Reading = {
    scenario: 'loop', codeSha: 'abc123',
    evidence: [{ hash: 'img1', kind: 'image' }, { hash: 'img2', kind: 'image' }, { hash: 'clip', kind: 'video' }],
    timelineBlob: 'tl', evaluator: 'manual@1', verdict: { status: 'pass' }, ts: '2026-07-03T00:00:00.000Z',
  }
  appendReading(f, r)
  assert.deepEqual(readReadings(f), [r])
  // every evidence hash + the timeline is walkable (clean's --keep-latest reference set)
  const refs = new Set([...evidenceOf(r).map((e) => e.hash), r.timelineBlob!])
  assert.deepEqual([...refs].sort(), ['clip', 'img1', 'img2', 'tl'])
})

// ---- freshness / drift (synthetic indices — the same shapes git.ts builds) ----

// linear chain c1 <- c2 <- c3 (c3 = tip): "newer than X" = not reachable from X.
function fakeIndex(fileCommits: Record<string, string[]>): DriftIndex {
  return {
    ord: new Map([['c3', 0], ['c2', 1], ['c1', 2]]),
    parents: new Map([['c3', ['c2']], ['c2', ['c1']], ['c1', []]]),
    anc: new Map(),
    fileCommits: new Map(Object.entries(fileCommits)),
    acks: new Map(),
    specNodes: new Map(),
  }
}

// the per-scenario change-commit index the scenario axis reads ([[scenariofresh]]): per yatsu path, per
// scenario NAME, the commits where THAT scenario's block moved (rename-followed; a pure reparent leaves its
// content identical so it records NO commit). A sibling's edit is a DIFFERENT name's entry, so it never
// enters this scenario's list — the per-scenario independence the old file-granular axis lacked.
function fakeScenario(commits: Record<string, Record<string, string[]>>): ScenarioIndex {
  const m: ScenarioIndex = new Map()
  for (const [path, byName] of Object.entries(commits)) m.set(path, new Map(Object.entries(byName)))
  return m
}

test('changedSince: true when a newer commit touched the path, false otherwise', () => {
  const idx = fakeIndex({ 'a.ts': ['c3', 'c1'], 'b.ts': ['c1'] })
  assert.equal(changedSince(idx, 'c1', 'a.ts'), true)   // c3 is newer than c1
  assert.equal(changedSince(idx, 'c3', 'a.ts'), false)  // nothing newer than c3
  assert.equal(changedSince(idx, 'c1', 'b.ts'), false)  // b.ts last touched at c1 itself
})

test('changedSince: an unknown sinceSha is treated as stale (can\'t prove fresh)', () => {
  const idx = fakeIndex({ 'a.ts': ['c1'] })
  assert.equal(changedSince(idx, 'unknown', 'a.ts'), true)
})

test('staleAxes: code axis — a governed file moved since the reading', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c3', 'c1'], '.spec/n/yatsu.md': ['c1'] })
  const scidx = fakeScenario({ '.spec/n/yatsu.md': { s: [] } })  // scenario 's' unchanged since c1
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'manual@1', ts: 't' }
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx, scidx), ['code'])
})

// the rename-safe scenario axis: a CONTENT edit to THIS scenario's block stales; a pure `git mv` reparent
// (content identical → no change-commit recorded) does NOT — matching how a reparented spec node stays fresh.
test('staleAxes: scenario axis is content-based — a content edit stales, a pure reparent does not', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'] })  // code fresh on both
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'manual@1', ts: 't' }
  const edited = fakeScenario({ '.spec/n/yatsu.md': { s: ['c3'] } })   // 's' block moved at c3 (> c1)
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx, edited), ['scenario'])
  const reparented = fakeScenario({ '.spec/n/yatsu.md': { s: [] } })  // pure rename → no content change for 's'
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx, reparented), [])
})

// the fix's unit-level proof: the axis is PER-scenario, not per-file. Editing a sibling scenario in the same
// yatsu.md (the file moved at c3) must NOT stale THIS reading — only 's''s own block moving does.
test('staleAxes: scenario axis is per-scenario — a sibling\'s edit never stales this reading', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'] })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'manual@1', ts: 't' }
  const siblingEdit = fakeScenario({ '.spec/n/yatsu.md': { other: ['c3'], s: [] } })  // c3 edited 'other', not 's'
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx, siblingEdit), [])
})

test('staleAxes: evaluator axis — the evaluator version moved since the reading', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'] })
  const scidx = fakeScenario({ '.spec/n/yatsu.md': { s: [] } })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'manual@0', ts: 't' }  // manual is version 1 ⇒ manual@1 ≠ manual@0
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx, scidx), ['evaluator'])
})

test('staleAxes: fully fresh reading → no axes', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'] })
  const scidx = fakeScenario({ '.spec/n/yatsu.md': { s: [] } })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: evaluatorTag(), ts: 't' }
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx, scidx), [])
})

test('staleAxes: unknown evaluator invents no staleness on the evaluator axis', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'] })
  const scidx = fakeScenario({ '.spec/n/yatsu.md': { s: [] } })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'ghost@9', ts: 't' }  // no such evaluator
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx, scidx), [])
})

// ---- evaluator tag (metadata only — no executor) ----

test('evaluator: tag round-trips, defaults to manual, version tracks the registry', () => {
  assert.equal(evaluatorTag(), 'manual@1')
  assert.equal(evaluatorTag('manual'), 'manual@1')
  assert.equal(evaluatorTag('stranger'), 'stranger@1')   // unknown name still tags (version 1)
  assert.deepEqual(parseEvaluator('manual@2'), { name: 'manual', version: 2 })
})

test('evaluator: isEvaluatorStale — behind version is stale, current is fresh, unknown invents none', () => {
  assert.equal(isEvaluatorStale('manual@0'), true)     // behind the current manual version
  assert.equal(isEvaluatorStale('manual@1'), false)    // current
  assert.equal(isEvaluatorStale('ghost@9'), false)     // unknown evaluator — no invented staleness
})

// ---- cache (content-addressed blob store + GC) ----

test('cache: putBlob is content-addressed + idempotent; getBlob round-trips', () => {
  const dir = tmp()
  const bytes = Buffer.from('pixels')
  const sha1 = putBlob(bytes, dir)
  const sha2 = putBlob(Buffer.from('pixels'), dir)
  assert.equal(sha1, sha2)                       // same content → same name
  assert.match(sha1, /^[0-9a-f]{64}$/)
  assert.deepEqual(listBlobs(dir), [sha1])       // written once
})

test('cache: resolveBlob — path present, MISS when gone, empty for no evidence', () => {
  const dir = tmp()
  const sha = putBlob(Buffer.from('img'), dir)
  assert.equal(resolveBlob(sha, dir), join(dir, sha))
  assert.equal(resolveBlob('0'.repeat(64), dir), MISS_BLOB)   // recorded but never stored
  assert.equal(resolveBlob(null, dir), '')                    // evidence-less reading
})

test('cache: gc drops everything not in the keep set', () => {
  const dir = tmp()
  const a = putBlob(Buffer.from('a'), dir)
  const b = putBlob(Buffer.from('b'), dir)
  const removed = gc(new Set([a]), dir)
  assert.deepEqual(removed, [b].filter((x) => x !== a))
  assert.deepEqual(listBlobs(dir), [a])
  // --all shape: keep nothing
  assert.deepEqual(gc(new Set(), dir).sort(), [a])
  assert.deepEqual(listBlobs(dir), [])
})

test('cache: isStrayBlob recognises a 64-hex basename or a yatsu-blobs path', () => {
  assert.equal(isStrayBlob('.spec/n/' + 'a'.repeat(64)), true)
  assert.equal(isStrayBlob('some/yatsu-blobs/whatever.png'), true)
  assert.equal(isStrayBlob('spec-yatsu/src/cache.ts'), false)
  assert.equal(isStrayBlob('.spec/n/yatsu.evals.ndjson'), false)
})

// ---- canonical ids on a leaf collision + the loud resolver ([[yatsu-core]] / [[id-url-safe]]) ----

const YMD = `---
scenarios:
  - name: loop
    tags: [cli]
    description: d
    expected: e
---
`
const SPEC = '---\ntitle: t\n---\n# t\n'

// a .spec tree where three nodes share the leaf 'web-remote-control'; only some carry a yatsu.md
function collisionTree(): string {
  const root = tmp()
  const mk = (rel: string, yatsu: boolean) => {
    const dir = join(root, '.spec', rel)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'spec.md'), SPEC)
    if (yatsu) writeFileSync(join(dir, 'yatsu.md'), YMD)
  }
  mk('proj', false)
  mk('proj/shared/remote/web-remote-control', true)
  mk('proj/desktop/web-remote-control', true)
  mk('proj/mobile/web-remote-control', true)
  mk('proj/solo-node', true)
  return root
}

test('yatsuNodes: leaf-colliding nodes carry the CANONICAL disambiguated id, not the bare leaf', async () => {
  const root = collisionTree()
  const ids = yatsuNodes(root).map((n) => n.id)
  assert.deepEqual(ids, ['desktop_web-remote-control', 'mobile_web-remote-control', 'remote_web-remote-control', 'solo-node'])
  // async twin mints identically
  assert.deepEqual((await yatsuNodesAsync(root)).map((n) => n.id), ids)
})

test('yatsuNodes: the mint universe is ALL spec nodes — a colliding leaf disambiguates even when only ONE of them measures', () => {
  const root = tmp()
  const mk = (rel: string, yatsu: boolean) => {
    const dir = join(root, '.spec', rel)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'spec.md'), SPEC)
    if (yatsu) writeFileSync(join(dir, 'yatsu.md'), YMD)
  }
  mk('proj', false)
  mk('proj/a/thing', true)    // measures
  mk('proj/b/thing', false)   // collides but has no yatsu.md
  assert.deepEqual(yatsuNodes(root).map((n) => n.id), ['a_thing'])
})

test('resolveYatsuNode: exact canonical id wins; unique bare leaf is a convenience; ambiguous leaf fails LOUD listing candidates', () => {
  const nodes = yatsuNodes(collisionTree())
  const exact = resolveYatsuNode(nodes, 'desktop_web-remote-control')
  assert.ok(exact.ok && exact.node.dir.endsWith('desktop/web-remote-control'))
  const solo = resolveYatsuNode(nodes, 'solo-node')   // non-colliding leaf IS its id
  assert.ok(solo.ok)
  const amb = resolveYatsuNode(nodes, 'web-remote-control')
  assert.ok(!amb.ok && amb.ambiguous)
  for (const c of ['desktop_web-remote-control', 'mobile_web-remote-control', 'remote_web-remote-control']) {
    assert.ok(!amb.ok && amb.error.includes(c), `candidates list ${c}`)
  }
  const missing = resolveYatsuNode(nodes, 'nope')
  assert.ok(!missing.ok && !missing.ambiguous)
})
