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
