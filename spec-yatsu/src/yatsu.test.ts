import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseScenarios, validateScenarios } from './yatsu.js'
import { readReadings, appendReading, latestPerScenario, type Reading } from './sidecar.js'
import { changedSince, staleAxes } from './freshness.js'
import { putBlob, listBlobs, gc, resolveBlob, MISS_BLOB, isStrayBlob } from './cache.js'
import { evaluatorTag, parseEvaluator, isEvaluatorStale } from './evaluator.js'
import type { DriftIndex } from '../../spec-cli/src/git.js'

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

// ---- yatsu.md schema validation (the loud twin of parseScenarios: scan reports it, the gate rejects it) ----

test('validateScenarios: a well-formed yatsu.md is valid (no errors)', () => {
  assert.deepEqual(validateScenarios(`---
scenarios:
  - name: login-works
    description: log in with valid creds
    expected: lands on the dashboard
    test: tests/login.spec.ts
  - name: logout-redirects
    description: log out
    expected: back on /login
---
body`), [])
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
  const b: Reading = { scenario: 's2', codeSha: 'def456', blob: 'feed', blobKind: 'transcript', evaluator: 'manual@1', verdict: { status: 'note', note: 'off by a pixel' }, ts: '2026-01-02T00:00:00.000Z' }
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

// ---- freshness / drift (synthetic DriftIndex — the same shape git.ts builds) ----

// commits newest→oldest: c3 (pos 0), c2 (pos 1), c1 (pos 2).
function fakeIndex(fileCommits: Record<string, string[]>): DriftIndex {
  return {
    pos: new Map([['c3', 0], ['c2', 1], ['c1', 2]]),
    fileCommits: new Map(Object.entries(fileCommits)),
    acks: new Map(),
    specNodes: new Map(),
  }
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
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'manual@1', ts: 't' }
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx), ['code'])
})

test('staleAxes: scenario axis — the yatsu.md moved since the reading', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'], '.spec/n/yatsu.md': ['c3'] })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'manual@1', ts: 't' }
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx), ['scenario'])
})

test('staleAxes: evaluator axis — the evaluator version moved since the reading', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'], '.spec/n/yatsu.md': ['c1'] })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'manual@0', ts: 't' }  // manual is version 1 ⇒ manual@1 ≠ manual@0
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx), ['evaluator'])
})

test('staleAxes: fully fresh reading → no axes', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'], '.spec/n/yatsu.md': ['c1'] })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: evaluatorTag(), ts: 't' }
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx), [])
})

test('staleAxes: unknown evaluator invents no staleness on the evaluator axis', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'], '.spec/n/yatsu.md': ['c1'] })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'ghost@9', ts: 't' }  // no such evaluator
  assert.deepEqual(staleAxes(reading, ['src/x.ts'], '.spec/n/yatsu.md', idx), [])
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
