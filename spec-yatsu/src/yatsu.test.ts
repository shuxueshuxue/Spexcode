import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseScenarios } from './yatsu.js'
import { readReadings, appendReading, latestPerScenario, type Reading } from './sidecar.js'
import { changedSince, staleAxes } from './freshness.js'
import { putBlob, listBlobs, gc, resolveBlob, MISS_BLOB, isStrayBlob } from './cache.js'
import { manualDriver, evaluatorTag, parseEvaluator, driverFor } from './drivers.js'
import type { DriftIndex } from '../../spec-cli/src/git.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'yatsu-test-'))

// ---- yatsu.md scenario parsing ----

test('parseScenarios: run-based and steps-based scenarios in a frontmatter list', () => {
  const md = `---
scenarios:
  - name: login-works
    driver: manual
    target: /login
    run: tests/login.spec.ts
  - name: logout-redirects
    driver: computer-use
    target: /logout
    steps:
      - click the logout button
      - assert the page is /login
---
body text is ignored by the parser
`
  const sc = parseScenarios(md)
  assert.equal(sc.length, 2)
  assert.deepEqual(sc[0], { name: 'login-works', driver: 'manual', target: '/login', run: 'tests/login.spec.ts' })
  assert.deepEqual(sc[1], { name: 'logout-redirects', driver: 'computer-use', target: '/logout', steps: ['click the logout button', 'assert the page is /login'] })
})

test('parseScenarios: no frontmatter / no scenarios key → empty', () => {
  assert.deepEqual(parseScenarios('# just a heading\n'), [])
  assert.deepEqual(parseScenarios('---\ntitle: x\n---\nbody\n'), [])
})

test('parseScenarios: driver defaults to manual, quotes stripped', () => {
  const sc = parseScenarios(`---
scenarios:
  - name: "quoted name"
    target: a surface
---`)
  assert.equal(sc.length, 1)
  assert.equal(sc[0].name, 'quoted name')
  assert.equal(sc[0].driver, 'manual')
})

// ---- sidecar round-trip ----

test('sidecar: append + read round-trips readings exactly', () => {
  const f = join(tmp(), 'yatsu.evals.ndjson')
  const a: Reading = { scenario: 's1', codeSha: 'abc123', blob: 'deadbeef', evaluator: 'manual@1', ts: '2026-01-01T00:00:00.000Z' }
  const b: Reading = { scenario: 's2', codeSha: 'def456', blob: null, evaluator: 'manual@1', ts: '2026-01-02T00:00:00.000Z' }
  appendReading(f, a)
  appendReading(f, b)
  assert.deepEqual(readReadings(f), [a, b])
})

test('sidecar: missing file reads as empty; malformed lines are skipped', () => {
  const f = join(tmp(), 'nope.ndjson')
  assert.deepEqual(readReadings(f), [])
  const g = join(tmp(), 'partial.ndjson')
  writeFileSync(g, '{"scenario":"ok","codeSha":"x","blob":null,"evaluator":"manual@1","ts":"t"}\nnot json\n\n')
  const rs = readReadings(g)
  assert.equal(rs.length, 1)
  assert.equal(rs[0].scenario, 'ok')
})

test('sidecar: latestPerScenario keeps the last line per scenario', () => {
  const f = join(tmp(), 'y.ndjson')
  appendReading(f, { scenario: 's', codeSha: 'old', blob: null, evaluator: 'manual@1', ts: 't1' })
  appendReading(f, { scenario: 's', codeSha: 'new', blob: 'b', evaluator: 'manual@1', ts: 't2' })
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
  const sc = { name: 's', driver: 'manual', target: '/' }
  assert.deepEqual(staleAxes(reading, sc, ['src/x.ts'], '.spec/n/yatsu.md', idx), ['code'])
})

test('staleAxes: scenario axis — the yatsu.md moved since the reading', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'], '.spec/n/yatsu.md': ['c3'] })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'manual@1', ts: 't' }
  const sc = { name: 's', driver: 'manual', target: '/' }
  assert.deepEqual(staleAxes(reading, sc, ['src/x.ts'], '.spec/n/yatsu.md', idx), ['scenario'])
})

test('staleAxes: evaluator axis — the driver version moved since the reading', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'], '.spec/n/yatsu.md': ['c1'] })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'manual@0', ts: 't' }
  const sc = { name: 's', driver: 'manual', target: '/' }   // manualDriver is version 1 ⇒ manual@1 ≠ manual@0
  assert.deepEqual(staleAxes(reading, sc, ['src/x.ts'], '.spec/n/yatsu.md', idx), ['evaluator'])
})

test('staleAxes: fully fresh reading → no axes', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'], '.spec/n/yatsu.md': ['c1'] })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: evaluatorTag(manualDriver), ts: 't' }
  const sc = { name: 's', driver: 'manual', target: '/' }
  assert.deepEqual(staleAxes(reading, sc, ['src/x.ts'], '.spec/n/yatsu.md', idx), [])
})

test('staleAxes: unknown driver skips the evaluator axis (no invented staleness)', () => {
  const idx = fakeIndex({ 'src/x.ts': ['c1'], '.spec/n/yatsu.md': ['c1'] })
  const reading: Reading = { scenario: 's', codeSha: 'c1', blob: null, evaluator: 'ghost@9', ts: 't' }
  const sc = { name: 's', driver: 'ghost', target: '/' }   // no such driver registered
  assert.deepEqual(staleAxes(reading, sc, ['src/x.ts'], '.spec/n/yatsu.md', idx), [])
})

// ---- drivers ----

test('drivers: tag round-trips, registry resolves manual + defaults', () => {
  assert.equal(evaluatorTag(manualDriver), 'manual@1')
  assert.deepEqual(parseEvaluator('manual@2'), { name: 'manual', version: 2 })
  assert.equal(driverFor('manual'), manualDriver)
  assert.equal(driverFor(undefined), manualDriver)        // default
  assert.equal(driverFor('playwright'), undefined)        // scripted browser drivers retired — manual is the only producer
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

test('cache: resolveBlob — path present, MISS when gone, empty for no image', () => {
  const dir = tmp()
  const sha = putBlob(Buffer.from('img'), dir)
  assert.equal(resolveBlob(sha, dir), join(dir, sha))
  assert.equal(resolveBlob('0'.repeat(64), dir), MISS_BLOB)   // recorded but never stored
  assert.equal(resolveBlob(null, dir), '')                    // pixel-less reading
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
