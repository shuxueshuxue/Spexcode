import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { putBlob, MISS_BLOB } from './cache.js'
import { readBlobByHash } from './evaltab.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'evaltab-test-'))

// magic-number prefixes the MIME sniffer keys off of.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46])
const TXT = Buffer.from('not an image at all', 'utf8')

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

test('readBlobByHash: JPEG and unknown bytes sniff to their right MIME', () => {
  const dir = tmp()
  assert.equal((readBlobByHash(putBlob(JPEG, dir), dir) as { mime: string }).mime, 'image/jpeg')
  assert.equal((readBlobByHash(putBlob(TXT, dir), dir) as { mime: string }).mime, 'application/octet-stream')
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
