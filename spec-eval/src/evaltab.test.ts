import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { putBlob, MISS_BLOB } from './cache.js'
import { evalTimeline, readBlobByHash } from './evaltab.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'evaltab-test-'))

// magic-number prefixes the MIME sniffer keys off of.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46])
const TRANSCRIPT = Buffer.from('not an image at all — a transcript', 'utf8')
const BINARY = Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff])   // has a NUL → not text
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])   // EBML magic → video/webm
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])   // size + 'ftyp' + brand → video/mp4

// ---- readBlobByHash: serve / miss / invalid ----

test('readBlobByHash: a present PNG blob serves its bytes with an image/png MIME', () => {
  const dir = tmp()
  const sha = putBlob(PNG, dir)
  const r = readBlobByHash(sha, dir)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.deepEqual(r.bytes, PNG)
    assert.equal(r.mime, 'image/png')
  }
})

test('readBlobByHash: JPEG, transcript text, and binary bytes sniff to their right MIME', () => {
  const dir = tmp()
  assert.equal((readBlobByHash(putBlob(JPEG, dir), dir) as { mime: string }).mime, 'image/jpeg')
  assert.equal((readBlobByHash(putBlob(TRANSCRIPT, dir), dir) as { mime: string }).mime, 'text/plain; charset=utf-8')
  assert.equal((readBlobByHash(putBlob(BINARY, dir), dir) as { mime: string }).mime, 'application/octet-stream')
})

test('readBlobByHash: a WebM and an MP4 clip sniff to a playable video MIME', () => {
  const dir = tmp()
  assert.equal((readBlobByHash(putBlob(WEBM, dir), dir) as { mime: string }).mime, 'video/webm')
  assert.equal((readBlobByHash(putBlob(MP4, dir), dir) as { mime: string }).mime, 'video/mp4')
})

test('readBlobByHash: a well-formed hash with no cached bytes is a MISS', () => {
  const dir = tmp()
  const r = readBlobByHash('a'.repeat(64), dir)   // 64-hex but never stored
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.reason, 'miss')
    assert.equal(r.message, MISS_BLOB)
  }
})

test('readBlobByHash: a malformed hash is rejected as invalid (never a miss)', () => {
  for (const bad of ['', 'xyz', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    const r = readBlobByHash(bad, tmp())
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'invalid')
  }
})

test('evalTimeline primes off-history content fallback without probing reachable readings', async () => {
  const root = tmp()
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const commit = (message: string) => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD') }
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'eval@example.test')
    git('config', 'user.name', 'Eval')
    mkdirSync(join(root, '.spec/n'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, '.spec/n/spec.md'), '---\ntitle: n\ncode: src/x.ts\n---\n# n\n')
    writeFileSync(join(root, '.spec/n/eval.md'), '---\nscenarios:\n  - name: s\n    description: measure\n    expected: stable\n    tags: [cli]\n---\n')
    writeFileSync(join(root, 'src/x.ts'), 'export const value = 0\n')
    const base = commit('base')
    git('branch', 'anchor')
    git('checkout', '-q', 'anchor')
    writeFileSync(join(root, 'src/x.ts'), 'export const value = 1\n')
    const anchor = commit('anchor measurement')
    git('checkout', '-q', '-b', 'current', base)
    writeFileSync(join(root, 'src/x.ts'), 'export const value = 2\n')
    commit('current change')

    const sidecarPath = join(root, '.spec/n/evals.ndjson')
    writeFileSync(sidecarPath, JSON.stringify({ scenario: 's', codeSha: anchor, blob: null, ts: '2026-07-26T00:00:00Z' }) + '\n')
    const idx = {
      ord: new Map([['current', 0]]), parents: new Map([['current', []]]),
      fileEvents: new Map(), acks: new Map(), specNodes: new Map(), anc: new Map(),
    }
    const node = {
      id: 'n', dir: join(root, '.spec/n'), evalPath: '.spec/n/eval.md', sidecarPath,
      scenarios: [{ name: 's', description: 'measure', expected: 'stable', tags: ['cli'] }],
    }
    const timeline = await evalTimeline('n', {
      root,
      specs: [{ path: '.spec/n/spec.md', code: ['src/x.ts'] }],
      idx,
      hidx: {} as any,
      scidx: new Map(),
      ynodes: [node],
      remarks: new Map(),
    } as any)
    assert.deepEqual(timeline.readings[0].staleAxes, ['code'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
