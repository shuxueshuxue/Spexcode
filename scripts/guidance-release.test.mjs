import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  GITHUB_RELEASE_ASSET_KIND,
  GUIDANCE_RELEASE_MANIFEST_NAME,
  GUIDANCE_RELEASE_SCHEMA,
  createGuidanceReleaseManifest,
} from './guidance-release.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const producer = join(root, 'scripts', 'guidance-release.mjs')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('release manifest binds producer provenance and exact catalog bytes', () => {
  const catalogBytes = Buffer.from(JSON.stringify({
    revision: 'revision-123',
    sourceRevision: 'revision-123',
    catalogSchema: 'spexcode.guidance-catalog/v1',
    payloadName: 'guidance-catalog.json',
  }) + '\n')
  const manifest = createGuidanceReleaseManifest({
    catalogBytes,
    repository: 'spexcode/example',
    release: 'guidance-revision-123',
    revision: 'revision-123',
  })
  assert.deepEqual(manifest, {
    schema: GUIDANCE_RELEASE_SCHEMA,
    producer: {
      repository: 'spexcode/example',
      release: 'guidance-revision-123',
      revision: 'revision-123',
    },
    catalog: {
      schema: 'spexcode.guidance-catalog/v1',
      name: 'guidance-catalog.json',
      bytes: catalogBytes.byteLength,
      sha256: digest(catalogBytes),
      retrieval: {
        kind: GITHUB_RELEASE_ASSET_KIND,
        repository: 'spexcode/example',
        release: 'guidance-revision-123',
        asset: 'guidance-catalog.json',
      },
    },
  })
  assert.throws(() => createGuidanceReleaseManifest({
    catalogBytes,
    repository: 'spexcode/example',
    release: 'guidance-revision-123',
    revision: 'different-revision',
  }), /catalog revision must equal/)
})

test('product producer emits the real catalog beside its sealed manifest', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'spex-guidance-release-'))
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    execFileSync(process.execPath, [producer,
      '--out-dir', outDir,
      '--repository', 'spexcode/example',
      '--release', `guidance-${revision}`,
      '--revision', revision,
    ], { cwd: root, encoding: 'utf8' })
    const catalogPath = join(outDir, 'guidance-catalog.json')
    const manifestPath = join(outDir, GUIDANCE_RELEASE_MANIFEST_NAME)
    const catalogBytes = readFileSync(catalogPath)
    const catalog = JSON.parse(catalogBytes)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.schema, GUIDANCE_RELEASE_SCHEMA)
    assert.equal(manifest.producer.revision, revision)
    assert.equal(manifest.catalog.schema, catalog.catalogSchema)
    assert.equal(manifest.catalog.name, catalog.payloadName)
    assert.equal(manifest.catalog.bytes, catalogBytes.byteLength)
    assert.equal(manifest.catalog.sha256, digest(catalogBytes))
    assert.deepEqual(manifest.catalog.retrieval, {
      kind: GITHUB_RELEASE_ASSET_KIND,
      repository: 'spexcode/example',
      release: `guidance-${revision}`,
      asset: catalog.payloadName,
    })
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('workflow allows a gated manual bootstrap and validates immutable release assets on rerun', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'guidance-release.yml'), 'utf8')
  const pushFilter = [
    '  push:',
    '    branches: [main]',
    '    paths:',
    "      - '.spec/spexcode/.plugins/**'",
    "      - 'spec-cli/bin/spex.mjs'",
    "      - 'spec-cli/src/guidance-catalog.ts'",
    "      - 'spec-cli/src/git.ts'",
    "      - 'spec-cli/src/guide.ts'",
    "      - 'spec-cli/src/help.ts'",
    "      - 'spec-cli/src/specs.ts'",
    "      - 'scripts/guidance-release.mjs'",
  ].join('\n')
  assert.match(workflow, /^on:\n  workflow_dispatch:\n  push:\n/m)
  assert.ok(workflow.includes(pushFilter))
  assert.match(workflow, /if: vars\.SPEXCODE_GUIDANCE_RELEASE_PUBLISH == 'true'/)
  assert.match(workflow, /gh release view/)
  assert.match(workflow, /gh release download/)
  assert.match(workflow, /cmp --/)
  assert.match(workflow, /--json isDraft/)
  assert.match(workflow, /--latest=false/)
  assert.doesNotMatch(workflow, /--clobber/)
  assert.doesNotMatch(workflow, /\bdeploy\b/i)
  assert.doesNotMatch(workflow, /https?:\/\//i)
})
