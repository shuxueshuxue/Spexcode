import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REFERENCE_SNAPSHOT_PAYLOAD_NAME,
  REFERENCE_SNAPSHOT_SCHEMA,
  createReferenceSnapshot,
  serializeReferenceSnapshot,
} from './reference-snapshot.mjs'

export const DOCS_RELEASE_SCHEMA = 'spexcode.docs-release/v1'
export const DOCS_RELEASE_MANIFEST_NAME = 'docs-release.json'
export const GITHUB_RELEASE_ASSET_KIND = 'github-release-asset'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function fail(message) {
  throw new Error(`docs-release: ${message}`)
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string`)
  return value
}

function assetName(value, name) {
  const asset = required(value, name)
  if (asset === '.' || asset === '..' || asset.includes('/') || asset.includes('\\')) fail(`${name} must be one file name`)
  return asset
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parsePayload(bytes, label) {
  try {
    const value = JSON.parse(bytes.toString('utf8'))
    if (!value || typeof value !== 'object') fail(`${label} must be a JSON object`)
    return value
  } catch (error) {
    fail(`${label} is not JSON: ${error.message}`)
  }
}

function assetDeclaration({ bytes, payload, producer, revision, label }) {
  if (payload.revision !== revision || payload.sourceRevision !== revision)
    fail(`${label} revision must equal ${revision}`)
  const name = assetName(payload.payloadName, `${label}.payloadName`)
  return {
    schema: required(payload[label === 'catalog' ? 'catalogSchema' : 'schema'], `${label} schema`),
    name,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    retrieval: {
      kind: GITHUB_RELEASE_ASSET_KIND,
      repository: producer.repository,
      release: producer.release,
      asset: name,
    },
  }
}

function assertRetrievalIdentity(asset, producer, label) {
  if (asset.retrieval.kind !== GITHUB_RELEASE_ASSET_KIND) fail(`${label} retrieval kind is unsupported`)
  if (asset.retrieval.repository !== producer.repository) fail(`${label} retrieval repository disagrees with producer`)
  if (asset.retrieval.release !== producer.release) fail(`${label} retrieval release disagrees with producer`)
  if (asset.retrieval.asset !== asset.name) fail(`${label} retrieval asset disagrees with payload name`)
}

export function createDocsReleaseManifest({ catalogBytes, referenceBytes, repository, release, revision }) {
  const producer = {
    repository: required(repository, 'repository'),
    release: required(release, 'release'),
    revision: required(revision, 'revision'),
  }
  const catalogPayload = parsePayload(catalogBytes, 'catalog')
  const referencePayload = parsePayload(referenceBytes, 'reference snapshot')
  const catalog = assetDeclaration({
    bytes: catalogBytes,
    payload: catalogPayload,
    producer,
    revision: producer.revision,
    label: 'catalog',
  })
  const reference = assetDeclaration({
    bytes: referenceBytes,
    payload: referencePayload,
    producer,
    revision: producer.revision,
    label: 'reference',
  })
  if (catalog.schema !== 'spexcode.guidance-catalog/v1') fail(`unsupported catalog schema ${catalog.schema}`)
  if (reference.schema !== REFERENCE_SNAPSHOT_SCHEMA) fail(`unsupported reference schema ${reference.schema}`)
  if (catalog.name !== 'guidance-catalog.json') fail(`unsupported catalog asset ${catalog.name}`)
  if (reference.name !== REFERENCE_SNAPSHOT_PAYLOAD_NAME) fail(`unsupported reference asset ${reference.name}`)
  if (catalog.name === reference.name) fail('catalog and reference asset names must differ')
  assertRetrievalIdentity(catalog, producer, 'catalog')
  assertRetrievalIdentity(reference, producer, 'reference')
  return { schema: DOCS_RELEASE_SCHEMA, producer, catalog, reference }
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  return result.stdout.trim()
}

function assertCommittedRevision(revision) {
  const head = git(['rev-parse', 'HEAD'])
  if (head !== revision) fail(`revision ${revision} does not match HEAD ${head}`)
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'])
  if (dirty) fail('refusing to produce a release from a dirty checkout')
}

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (!['--out-dir', '--repository', '--release', '--revision'].includes(flag)) fail(`unknown argument ${flag}`)
    if (values[flag]) fail(`${flag} may appear only once`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) fail(`${flag} expects a value`)
    values[flag] = value
  }
  return {
    outDir: required(values['--out-dir'], '--out-dir'),
    repository: required(values['--repository'], '--repository'),
    release: required(values['--release'], '--release'),
    revision: required(values['--revision'], '--revision'),
  }
}

function exportCatalog(destination) {
  const temporary = join(destination, `.guidance-catalog.${process.pid}.tmp`)
  if (existsSync(temporary)) fail(`temporary output already exists at ${temporary}`)
  const result = spawnSync(process.execPath, [join(root, 'spec-cli', 'bin', 'spex.mjs'), 'guidance', '--out', temporary], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) fail(`catalog export failed: ${(result.stderr || result.stdout).trim()}`)
  try {
    return readFileSync(temporary)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function emitDocsRelease({ outDir, repository, release, revision }) {
  assertCommittedRevision(revision)
  const destination = resolve(outDir)
  mkdirSync(destination, { recursive: true })
  const catalogPath = join(destination, 'guidance-catalog.json')
  const referencePath = join(destination, REFERENCE_SNAPSHOT_PAYLOAD_NAME)
  const manifestPath = join(destination, DOCS_RELEASE_MANIFEST_NAME)
  if (existsSync(catalogPath) || existsSync(referencePath) || existsSync(manifestPath)) fail('refusing to replace an existing release asset')
  const catalogBytes = exportCatalog(destination)
  const referenceBytes = serializeReferenceSnapshot(createReferenceSnapshot({ root, revision }))
  const manifest = createDocsReleaseManifest({ catalogBytes, referenceBytes, repository, release, revision })
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(catalogPath, catalogBytes, { flag: 'wx' })
  writeFileSync(referencePath, referenceBytes, { flag: 'wx' })
  writeFileSync(manifestPath, manifestBytes, { flag: 'wx' })
  return { catalogPath, referencePath, manifestPath, manifest }
}

function main() {
  const result = emitDocsRelease(parseArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify({ catalog: result.catalogPath, reference: result.referencePath, manifest: result.manifestPath }, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
