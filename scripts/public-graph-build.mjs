#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dashboard = join(root, 'spec-dashboard')
const output = join(dashboard, 'dist-public')
const registryPath = join(root, 'public-graphs', 'registry.json')
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
const publicationId = (() => {
  const args = process.argv.slice(2)
  if (!args.length) return 'spexcode'
  if (args.length === 2 && args[0] === '--publication') return string(args[1], 'publication id')
  fail('usage: node scripts/public-graph-build.mjs [--publication <id>]')
})()
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
run('npm', ['run', 'build', '--', '--outDir', 'dist-public'], {
  cwd: dashboard,
  env: {
    ...process.env,
    VITE_PUBLIC_GRAPH_ONLY: '1',
    VITE_PUBLIC_GRAPH_SOURCE: '/public-graph.json',
    VITE_PUBLIC_GRAPH_DOCUMENT_SOURCE: '/specs',
  },
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
