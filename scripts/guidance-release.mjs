import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const GUIDANCE_RELEASE_SCHEMA = 'spexcode.guidance-release/v1'
export const GUIDANCE_RELEASE_MANIFEST_NAME = 'guidance-release.json'
export const GITHUB_RELEASE_ASSET_KIND = 'github-release-asset'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function fail(message) {
  throw new Error(`guidance-release: ${message}`)
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

export function createGuidanceReleaseManifest({ catalogBytes, repository, release, revision }) {
  const producer = {
    repository: required(repository, 'repository'),
    release: required(release, 'release'),
    revision: required(revision, 'revision'),
  }
  let catalog
  try {
    catalog = JSON.parse(catalogBytes.toString('utf8'))
  } catch (error) {
    fail(`catalog is not JSON: ${error.message}`)
  }
  if (!catalog || typeof catalog !== 'object') fail('catalog must be a JSON object')
  if (catalog.revision !== producer.revision || catalog.sourceRevision !== producer.revision)
    fail(`catalog revision must equal ${producer.revision}`)
  const name = assetName(catalog.payloadName, 'catalog.payloadName')
  const schema = required(catalog.catalogSchema, 'catalog.catalogSchema')
  return {
    schema: GUIDANCE_RELEASE_SCHEMA,
    producer,
    catalog: {
      schema,
      name,
      bytes: catalogBytes.byteLength,
      sha256: sha256(catalogBytes),
      retrieval: {
        kind: GITHUB_RELEASE_ASSET_KIND,
        repository: producer.repository,
        release: producer.release,
        asset: name,
      },
    },
  }
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

export function emitGuidanceRelease({ outDir, repository, release, revision }) {
  assertCommittedRevision(revision)
  const destination = resolve(outDir)
  mkdirSync(destination, { recursive: true })
  const temporaryCatalog = join(destination, `.guidance-catalog.${process.pid}.tmp`)
  if (existsSync(temporaryCatalog)) fail(`temporary output already exists at ${temporaryCatalog}`)
  const catalogResult = spawnSync(process.execPath, [join(root, 'spec-cli', 'bin', 'spex.mjs'), 'guidance', '--out', temporaryCatalog], {
    cwd: root,
    encoding: 'utf8',
  })
  if (catalogResult.status !== 0) fail(`catalog export failed: ${(catalogResult.stderr || catalogResult.stdout).trim()}`)
  const catalogBytes = readFileSync(temporaryCatalog)
  const manifest = createGuidanceReleaseManifest({ catalogBytes, repository, release, revision })
  const catalogPath = join(destination, manifest.catalog.name)
  const manifestPath = join(destination, GUIDANCE_RELEASE_MANIFEST_NAME)
  if (existsSync(catalogPath) || existsSync(manifestPath)) fail('refusing to replace an existing release asset')
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(catalogPath, catalogBytes, { flag: 'wx' })
  writeFileSync(manifestPath, manifestBytes, { flag: 'wx' })
  return { catalogPath, manifestPath, manifest }
}

function main() {
  const result = emitGuidanceRelease(parseArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify({ catalog: result.catalogPath, manifest: result.manifestPath }, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
