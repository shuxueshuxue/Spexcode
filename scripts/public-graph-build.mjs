#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dashboard = join(root, 'spec-dashboard')
const output = join(dashboard, 'dist-public')
// @@@ the registry is DATA, the refusal is the product - this script enforces the invariant that a hostname
// is never derived from a checkout or branch name, which needs a registry to refuse against. WHICH
// publications exist is one deployment's fact, so --registry lets a deployment supply its own list instead
// of editing this repository to publish a second repository. The default names SpexCode's own publication.
const DEFAULT_REGISTRY = join(root, 'scripts', 'public-graph-registry.json')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const fail = (message) => { throw new Error(`public graph registry: ${message}`) }
const string = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`)
  return value
}
const { publicationId, registryPath } = (() => {
  const args = process.argv.slice(2)
  let id = 'spexcode'
  let registry = DEFAULT_REGISTRY
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] === '--publication') { id = string(args[at + 1], 'publication id'); at += 1; continue }
    if (args[at] === '--registry') { registry = resolve(string(args[at + 1], 'registry path')); at += 1; continue }
    fail('usage: node scripts/public-graph-build.mjs [--publication <id>] [--registry <path>]')
  }
  return { publicationId: id, registryPath: registry }
})()
if (!existsSync(registryPath)) fail(`registry ${registryPath} does not exist`)
const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
if (registry?.schema !== 'spexcode.public-spec-host-registry/v1' || !Array.isArray(registry.publications)) {
  fail('registry schema is invalid')
}
const publication = registry.publications.find((entry) => entry?.id === publicationId)
if (!publication) fail(`unknown publication ${JSON.stringify(publicationId)}`)
string(publication.hostname, 'hostname')
string(publication.repository?.slug, 'repository slug')
string(publication.repository?.url, 'repository url')
string(publication.about?.title, 'about title')
string(publication.about?.summary, 'about summary')
if (!Array.isArray(publication.about?.facts) || !publication.about.facts.length) fail('about facts must be a non-empty label/value array')
for (const fact of publication.about.facts) {
  string(fact?.label, 'about fact label')
  string(fact?.value, 'about fact value')
}

mkdirSync(output, { recursive: true })
// The payload sources are left to public-mode.js's relative defaults — one place decides, and relative is
// what lets the same artifact be served from a domain root or from a path prefix.
run('npm', ['run', 'build', '--', '--outDir', 'dist-public', '--base', './'], {
  cwd: dashboard,
  env: { ...process.env, VITE_PUBLIC_GRAPH_ONLY: '1' },
})
run(process.execPath, ['spec-cli/bin/spex.mjs', 'graph', '--public', '--out', join(output, 'public-graph.json'), '--content-dir', join(output, 'specs')])
const payload = JSON.parse(readFileSync(join(output, 'public-graph.json'), 'utf8'))
if (payload.schema !== 'spexcode.public-spec-graph/v1' || !payload.revision || !Array.isArray(payload.nodes)) {
  throw new Error('public graph build emitted an invalid snapshot')
}
const documents = readdirSync(join(output, 'specs')).filter((name) => name.endsWith('.json')).sort()
if (documents.length !== payload.nodes.length) {
  throw new Error(`public graph build emitted ${documents.length} documents for ${payload.nodes.length} nodes`)
}
const graphBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`)
writeFileSync(join(output, 'public-graph.json'), graphBytes)
const archiveName = `${publication.id}.spec.zip`
const archivePath = join(output, archiveName)
// Git archive reads the same committed revision named by the graph index. The public download deliberately
// contains only .spec/spexcode, never runtime issue/session state from the top-level .spec directory.
run('git', ['archive', '--format=zip', '--prefix=.spec/', `--output=${archivePath}`, `${payload.revision}:.spec/spexcode`])
const archiveBytes = readFileSync(archivePath)
const graph = { path: 'public-graph.json', bytes: graphBytes.byteLength, sha256: sha256(graphBytes) }
const documentAssets = documents.map((name) => {
  const bytes = readFileSync(join(output, 'specs', name))
  return { path: `specs/${name}`, bytes: bytes.byteLength, sha256: sha256(bytes) }
})
const archive = { path: archiveName, name: archiveName, bytes: archiveBytes.byteLength, sha256: sha256(archiveBytes) }
const metadata = {
  schema: 'spexcode.public-spec-site/v1',
  publication: {
    id: publication.id,
    hostname: publication.hostname,
    repository: publication.repository,
  },
  about: publication.about,
  release: { revision: payload.revision, graph, archive },
}
const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)
writeFileSync(join(output, 'public-graph-meta.json'), metadataBytes)
const manifest = {
  schema: 'spexcode.public-spec-release/v1',
  revision: payload.revision,
  publication: { id: publication.id, hostname: publication.hostname, repository: publication.repository },
  graph,
  metadata: { path: 'public-graph-meta.json', bytes: metadataBytes.byteLength, sha256: sha256(metadataBytes) },
  archive,
  documents: documentAssets,
}
writeFileSync(join(output, 'public-spec-release.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`public graph: ${payload.nodes.length} nodes at ${payload.revision}`)
