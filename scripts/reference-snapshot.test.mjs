import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  REFERENCE_SNAPSHOT_PAYLOAD_NAME,
  REFERENCE_SNAPSHOT_SCHEMA,
  createReferenceSnapshot,
  serializeReferenceSnapshot,
} from './reference-snapshot.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const renderer = join(root, 'scripts', 'reference-snapshot.mjs')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('Reference snapshot deterministically renders the complete current spec tree with provenance and navigation', () => {
  const first = createReferenceSnapshot({ revision })
  const second = createReferenceSnapshot({ revision })
  assert.deepEqual(first, second)
  assert.equal(first.schema, REFERENCE_SNAPSHOT_SCHEMA)
  assert.equal(first.payloadName, REFERENCE_SNAPSHOT_PAYLOAD_NAME)
  assert.equal(first.revision, revision)
  assert.equal(first.sourceRevision, revision)
  assert.equal(first.provenance.sourceRoot, '.spec/spexcode')
  assert.ok(first.provenance.pageCount > 200)
  assert.equal(first.provenance.pageCount, first.pages.length)
  assert.equal(first.nav.path, 'index.md')
  assert.equal(first.nav.title, 'spexcode')
  assert.equal(first.pages.map((page) => page.path).join('\n'), [...first.pages].map((page) => page.path).sort().join('\n'))
  assert.ok(first.pages.some((page) => page.source.path.endsWith('/reference-snapshot/spec.md')))
  for (const page of first.pages) {
    assert.match(page.path, /^(?:[.a-z0-9-]+\/)*index\.md$/)
    assert.match(page.sha256, /^[0-9a-f]{64}$/)
    assert.match(page.source.sha256, /^[0-9a-f]{64}$/)
    assert.equal(page.bytes, Buffer.byteLength(page.content, 'utf8'))
    assert.equal(page.sha256, digest(Buffer.from(page.content, 'utf8')))
    assert.equal(page.source.revision, revision)
    assert.ok(page.content.includes(`- Source: \`${page.source.path}\``))
  }
  const { bundleHash, ...payload } = first
  assert.equal(bundleHash, digest(Buffer.from(JSON.stringify(payload), 'utf8')))
  assert.deepEqual(serializeReferenceSnapshot(first), serializeReferenceSnapshot(second))
  assert.ok(first.pages.some((page) => page.path.startsWith('dot-plugins/')))
})

test('Reference snapshot command writes one fresh self-contained payload', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spex-reference-snapshot-'))
  const output = join(directory, REFERENCE_SNAPSHOT_PAYLOAD_NAME)
  try {
    execFileSync(process.execPath, [renderer, '--out', output, '--revision', revision], { cwd: root, encoding: 'utf8' })
    const payload = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(payload.schema, REFERENCE_SNAPSHOT_SCHEMA)
    assert.equal(payload.payloadName, REFERENCE_SNAPSHOT_PAYLOAD_NAME)
    assert.equal(payload.revision, revision)
    assert.throws(() => execFileSync(process.execPath, [renderer, '--out', output, '--revision', revision], { cwd: root, encoding: 'utf8' }), /Command failed/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
