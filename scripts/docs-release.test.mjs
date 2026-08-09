import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DOCS_RELEASE_MANIFEST_NAME,
  DOCS_RELEASE_SCHEMA,
  GITHUB_RELEASE_ASSET_KIND,
  createDocsReleaseManifest,
} from './docs-release.mjs'
import { REFERENCE_SNAPSHOT_PAYLOAD_NAME, REFERENCE_SNAPSHOT_SCHEMA } from './reference-snapshot.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const producer = join(root, 'scripts', 'docs-release.mjs')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

function catalogBytes(revision) {
  return Buffer.from(JSON.stringify({
    revision,
    sourceRevision: revision,
    catalogSchema: 'spexcode.guidance-catalog/v1',
    payloadName: 'guidance-catalog.json',
  }) + '\n')
}

function referenceBytes(revision) {
  return Buffer.from(JSON.stringify({
    schema: REFERENCE_SNAPSHOT_SCHEMA,
    revision,
    sourceRevision: revision,
    payloadName: REFERENCE_SNAPSHOT_PAYLOAD_NAME,
  }) + '\n')
}

test('docs release manifest binds one producer identity to exact Guidance and Reference assets', () => {
  const revision = 'revision-123'
  const catalog = catalogBytes(revision)
  const reference = referenceBytes(revision)
  const manifest = createDocsReleaseManifest({
    catalogBytes: catalog,
    referenceBytes: reference,
    repository: 'spexcode/example',
    release: 'docs-revision-123',
    revision,
  })
  assert.equal(manifest.schema, DOCS_RELEASE_SCHEMA)
  assert.deepEqual(manifest.producer, { repository: 'spexcode/example', release: 'docs-revision-123', revision })
  for (const [name, bytes, schema, payloadName] of [
    ['catalog', catalog, 'spexcode.guidance-catalog/v1', 'guidance-catalog.json'],
    ['reference', reference, REFERENCE_SNAPSHOT_SCHEMA, REFERENCE_SNAPSHOT_PAYLOAD_NAME],
  ]) {
    assert.deepEqual(manifest[name], {
      schema,
      name: payloadName,
      bytes: bytes.byteLength,
      sha256: digest(bytes),
      retrieval: {
        kind: GITHUB_RELEASE_ASSET_KIND,
        repository: 'spexcode/example',
        release: 'docs-revision-123',
        asset: payloadName,
      },
    })
  }
  assert.throws(() => createDocsReleaseManifest({
    catalogBytes: catalog,
    referenceBytes: referenceBytes('other-revision'),
    repository: 'spexcode/example',
    release: 'docs-revision-123',
    revision,
  }), /reference revision must equal/)
})

test('product producer emits the real catalog and Reference snapshot beside one sealed manifest', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'spex-docs-release-'))
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    execFileSync(process.execPath, [producer,
      '--out-dir', outDir,
      '--repository', 'spexcode/example',
      '--release', `docs-${revision}`,
      '--revision', revision,
    ], { cwd: root, encoding: 'utf8' })
    assert.deepEqual(readdirSync(outDir).sort(), [DOCS_RELEASE_MANIFEST_NAME, 'guidance-catalog.json', REFERENCE_SNAPSHOT_PAYLOAD_NAME].sort())
    const catalog = readFileSync(join(outDir, 'guidance-catalog.json'))
    const reference = readFileSync(join(outDir, REFERENCE_SNAPSHOT_PAYLOAD_NAME))
    const manifest = JSON.parse(readFileSync(join(outDir, DOCS_RELEASE_MANIFEST_NAME), 'utf8'))
    assert.equal(manifest.schema, DOCS_RELEASE_SCHEMA)
    assert.equal(manifest.producer.revision, revision)
    assert.equal(manifest.catalog.bytes, catalog.byteLength)
    assert.equal(manifest.catalog.sha256, digest(catalog))
    assert.equal(manifest.reference.bytes, reference.byteLength)
    assert.equal(manifest.reference.sha256, digest(reference))
    const snapshot = JSON.parse(reference)
    assert.equal(snapshot.schema, REFERENCE_SNAPSHOT_SCHEMA)
    assert.equal(snapshot.revision, revision)
    assert.equal(snapshot.payloadName, REFERENCE_SNAPSHOT_PAYLOAD_NAME)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('workflow allows a gated manual bootstrap and validates immutable docs release assets on rerun', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'docs-release.yml'), 'utf8')
  assert.match(workflow, /^on:\n  workflow_dispatch:\n  push:\n/m)
  assert.match(workflow, /if: vars\.SPEXCODE_DOCS_RELEASE_PUBLISH == 'true'/)
  assert.match(workflow, /docs-release\.mjs/)
  assert.match(workflow, /gh release view/)
  assert.match(workflow, /gh release download/)
  assert.match(workflow, /cmp --/)
  assert.match(workflow, /--json isDraft/)
  assert.match(workflow, /--latest=false/)
  assert.doesNotMatch(workflow, /--clobber/)
  assert.doesNotMatch(workflow, /\bdeploy\b/i)
  assert.doesNotMatch(workflow, /https?:\/\//i)
})
